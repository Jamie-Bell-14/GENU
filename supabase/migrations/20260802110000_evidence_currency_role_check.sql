/*
  T10 review round 5 (head 3eb1256): the one residual P0 at the
  receipt-lifecycle boundary.

  Round 4's currency check asked only whether the latest *other* message in
  the project belonged to the receipt's own turn — not whether that message
  was the turn's *assistant* answer. `start_turn` stores the user's message
  the moment a turn is accepted, before any research runs or any assistant
  answer exists (see `20260730090000_turn_start_and_operations.sql`), so a
  research turn that is accepted and then fails, is stopped, or has its
  lease expire before ever reaching `complete_turn` still leaves a message
  row for that turn — a `role = 'user'` one. If no turn has been accepted
  since, that user message is the latest *other* message, `turn_id` matches
  the receipt's turn, and round 4's check read that as "this turn
  completed", when in fact it never produced an answer at all.

  This is exactly the asymmetry `loadLatestResearchReceipt` already guards
  against on reload (it requires the latest message's `role` to be
  `'assistant'`, not merely its `turn_id` to match) — this migration brings
  the write-boundary check into agreement with it: current iff the single
  latest other message is both the receipt's own turn *and* that turn's
  assistant answer, checked as one combined condition on one fetched row.
*/
create or replace function public.complete_turn(
  p_project_id uuid,
  p_turn_id uuid,
  p_actor_id uuid,
  p_assistant_text text,
  p_fields jsonb,
  p_assumptions jsonb,
  p_evidence jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  existing record;
  slot text;
  written jsonb := '{}'::jsonb;
  refused jsonb := '{}'::jsonb;
  run record;
  checked_at timestamptz;
  finding record;
  v_evidence_id uuid;
  v_direction text;
  v_assumption_status public.assumption_status;
  v_latest_other_turn uuid;
  v_latest_other_role text;
  v_finding_turn_has_answer boolean;
  v_refusal_code text;
  v_evidence_refused_reason text;
begin
  perform private.assert_project_actor(p_project_id, p_actor_id);

  select state, lease_expires_at into run
  from public.turn_runs
  where turn_id = p_turn_id and project_id = p_project_id
  for update;

  checked_at := clock_timestamp();

  if not found or run.state <> 'running' or checked_at >= run.lease_expires_at
  then
    return jsonb_build_object('outcome', 'not_running');
  end if;

  insert into public.messages (id, project_id, turn_id, role, content)
  values (p_turn_id, p_project_id, p_turn_id, 'assistant', p_assistant_text);

  for item in select * from jsonb_array_elements(coalesce(p_fields, '[]'::jsonb))
  loop
    slot := coalesce(item ->> 'slot', '0');

    if (item ->> 'origin') = 'user_stated'
       and (item ->> 'source_excerpt') is null then
      raise exception 'unsourced_user_stated:%/%',
        item ->> 'area', item ->> 'key'
        using errcode = 'check_violation';
    end if;

    select origin, value into existing
    from public.project_fields
    where project_id = p_project_id
      and area = (item ->> 'area')::public.project_area
      and key = item ->> 'key'
    for update;

    if found and existing.origin = 'user_stated'
       and existing.value <> (item ->> 'value') then
      refused := jsonb_set(
        refused,
        array[slot],
        coalesce(refused -> slot, '[]'::jsonb) || to_jsonb('user_owned_field'::text),
        true
      );
      continue;
    end if;

    insert into public.project_fields
      (project_id, area, key, label, value, origin, support,
       source_turn_id, source_excerpt)
    values (
      p_project_id,
      (item ->> 'area')::public.project_area,
      item ->> 'key',
      item ->> 'label',
      item ->> 'value',
      (item ->> 'origin')::public.field_origin,
      (item ->> 'support')::public.support_state,
      case when item ->> 'source_excerpt' is null then null else p_turn_id end,
      item ->> 'source_excerpt'
    )
    on conflict (project_id, area, key) do update
    set label = excluded.label,
        value = excluded.value,
        support = excluded.support,
        origin = case
          when public.project_fields.origin = 'user_stated'
            then public.project_fields.origin
          else excluded.origin
        end,
        source_turn_id = case
          when public.project_fields.origin = 'user_stated'
            then public.project_fields.source_turn_id
          else excluded.source_turn_id
        end,
        source_excerpt = case
          when public.project_fields.origin = 'user_stated'
            then public.project_fields.source_excerpt
          else excluded.source_excerpt
        end,
        updated_at = now();

    written := jsonb_set(
      written,
      array[slot],
      to_jsonb(coalesce((written ->> slot)::integer, 0) + 1),
      true
    );
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p_assumptions, '[]'::jsonb))
  loop
    slot := coalesce(item ->> 'slot', '0');

    if (item ->> 'origin') = 'user_stated'
       and (item ->> 'source_excerpt') is null then
      raise exception 'unsourced_user_stated:assumption'
        using errcode = 'check_violation';
    end if;

    insert into public.assumptions
      (project_id, statement, why_it_matters, alternatives, importance, origin,
       source_turn_id, source_excerpt)
    values (
      p_project_id,
      item ->> 'statement',
      item ->> 'why_it_matters',
      coalesce(item -> 'alternatives', '[]'::jsonb),
      item ->> 'importance',
      (item ->> 'origin')::public.field_origin,
      case when item ->> 'source_excerpt' is null then null else p_turn_id end,
      item ->> 'source_excerpt'
    );

    written := jsonb_set(
      written,
      array[slot],
      to_jsonb(coalesce((written ->> slot)::integer, 0) + 1),
      true
    );
  end loop;

  /*
    "Add as evidence" (T10 review round 2, P0-B/P0-C; round 3/4/5, currency).
    Each item names a receipt, never a target — the target is the receipt's
    own `focal_object_id`, so this cannot attach evidence to whatever object
    happens to be in default focus when this turn, rather than the research
    that produced the receipt, runs.
  */
  for item in select * from jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb))
  loop
    slot := coalesce(item ->> 'slot', '0');

    select * into finding
    from public.research_findings
    where id = (item ->> 'receipt_id')::uuid and project_id = p_project_id;

    if not found then
      -- Foreign, unknown or stale receipts are rejected identically
      -- (T10 review round 1, P0-1): nothing about which is leaked.
      v_refusal_code := 'no_active_research';
      refused := jsonb_set(
        refused, array[slot],
        coalesce(refused -> slot, '[]'::jsonb) || to_jsonb(v_refusal_code),
        true
      );
      v_evidence_refused_reason := coalesce(v_evidence_refused_reason, v_refusal_code);
      continue;
    end if;

    /*
      Already linked is checked *before* currency, on a plain read rather
      than the insert-on-conflict below — a genuine idempotent repeat (the
      same "Add as evidence" retried as a new turn after, say, a connection
      loss the first attempt's own response never confirmed) must read as
      "already done", not as "this research is now stale", which is a
      confusing thing to tell someone about a request that in fact already
      succeeded. Checking this first also avoids ever creating an
      `evidence` row for a receipt currency will go on to refuse — that
      would leave a disconnected object on the canvas with no relationship
      to explain it, since `loadCanvasObjects` renders every `evidence` row
      regardless of whether it ever gained one.
    */
    select id into v_evidence_id
    from public.evidence
    where project_id = p_project_id and source_receipt_id = finding.id;

    if v_evidence_id is not null then
      v_refusal_code := 'already_linked';
      refused := jsonb_set(
        refused, array[slot],
        coalesce(refused -> slot, '[]'::jsonb) || to_jsonb(v_refusal_code),
        true
      );
      v_evidence_refused_reason := coalesce(v_evidence_refused_reason, v_refusal_code);
      continue;
    end if;

    /*
      Currency (T10 review round 5): current iff the single latest message
      in the project *other than this turn's own* is both the receipt's own
      turn and that turn's assistant answer — the same combined test
      `loadLatestResearchReceipt` already applies on reload. `turn_id`
      alone is not enough: `start_turn` stores the user's message the
      instant a turn is accepted, before any research runs or any answer is
      produced, so a turn that was accepted and then failed, was stopped,
      or had its lease expire before reaching this function still leaves a
      message row bearing its `turn_id` — a `role = 'user'` one. Requiring
      `role = 'assistant'` here is what tells "this turn produced an
      answer" apart from "this turn was merely accepted", the distinction
      round 4's turn_id-only check could not make.

      This turn's own message was already inserted above, so it is excluded
      from "other" — otherwise this turn being the newest one in the
      project would always make an older receipt look current merely by
      comparison with itself.
    */
    select turn_id, role into v_latest_other_turn, v_latest_other_role
    from public.messages
    where project_id = p_project_id and turn_id <> p_turn_id
    order by created_at desc
    limit 1;

    if v_latest_other_turn is distinct from finding.turn_id
       or v_latest_other_role is distinct from 'assistant' then
      select exists(
        select 1 from public.messages
        where project_id = p_project_id
          and turn_id = finding.turn_id
          and role = 'assistant'
      ) into v_finding_turn_has_answer;

      v_refusal_code := case
        when finding.turn_id = p_turn_id then 'research_not_yet_complete'
        when v_finding_turn_has_answer then 'research_superseded'
        else 'research_incomplete'
      end;
      refused := jsonb_set(
        refused, array[slot],
        coalesce(refused -> slot, '[]'::jsonb) || to_jsonb(v_refusal_code),
        true
      );
      v_evidence_refused_reason := coalesce(v_evidence_refused_reason, v_refusal_code);
      continue;
    end if;

    if finding.focal_object_id is null then
      v_refusal_code := 'no_focal_object';
      refused := jsonb_set(
        refused, array[slot],
        coalesce(refused -> slot, '[]'::jsonb) || to_jsonb(v_refusal_code),
        true
      );
      v_evidence_refused_reason := coalesce(v_evidence_refused_reason, v_refusal_code);
      continue;
    end if;

    -- No existing evidence row for this receipt (checked above) — a plain
    -- insert is enough; the `already_linked` check already ruled out the
    -- only case that could conflict.
    insert into public.evidence (
      project_id, title, summary, source_name, source_url, retrieved_at,
      methodology, limitations, kind, is_demo, source_receipt_id
    )
    values (
      p_project_id,
      finding.title,
      finding.key_finding,
      coalesce(finding.sources -> 0 ->> 'name', 'Demonstration source'),
      finding.sources -> 0 ->> 'url',
      finding.retrieved_at,
      finding.methodology,
      finding.limitations,
      'secondary_research',
      finding.is_demo,
      finding.id
    )
    returning id into v_evidence_id;

    v_direction := item ->> 'direction';

    insert into public.project_relationships (
      project_id, from_object_id, to_object_id, relation, origin, support, note
    )
    values (
      p_project_id,
      v_evidence_id,
      finding.focal_object_id,
      case v_direction
        when 'supports' then 'supports'
        when 'contradicts' then 'contradicts'
        -- Neutral by design: this codebase never asserts a direction it did
        -- not genuinely determine (T10 review round 2, P0-C).
        else 'affects'
      end::public.relationship_type,
      'researched',
      case v_direction
        when 'supports' then 'some_evidence'
        else 'hypothesis'
      end::public.support_state,
      item ->> 'consequence_summary'
    );

    /*
      Step 6's "the assumption's state visibly changes if appropriate"
      (VERTICAL_SLICE_SPEC), applied only when a direction was actually
      determined — never guessed here, and never for a target that is not
      an assumption at all, and never overwriting one already resolved.
    */
    if v_direction in ('supports', 'contradicts') then
      select status into v_assumption_status
      from public.assumptions
      where id = finding.focal_object_id and project_id = p_project_id
      for update;

      if found and v_assumption_status = 'open' then
        update public.assumptions
        set status = case v_direction
          when 'supports' then 'supported'
          else 'weakened'
        end::public.assumption_status
        where id = finding.focal_object_id and project_id = p_project_id;
      end if;
    end if;

    written := jsonb_set(
      written,
      array[slot],
      to_jsonb(coalesce((written ->> slot)::integer, 0) + 1),
      true
    );
  end loop;

  update public.turn_runs
  set state = 'completed',
      accepting_direction = false,
      ended_at = now(),
      evidence_refused_reason = v_evidence_refused_reason
  where turn_id = p_turn_id and state = 'running';

  return jsonb_build_object(
    'outcome', 'completed',
    'written', written,
    'refused', refused
  );
end;
$$;

comment on function public.complete_turn(uuid, uuid, uuid, text, jsonb, jsonb, jsonb) is
  'Stores a turn''s answer, applies its project-truth writes (fields, assumptions, evidence) and closes the run, in one transaction. An evidence item''s receipt must belong to the project''s most recently *answered* turn (role = assistant, not merely a stored message), the same currency rule reload hydration applies; a refusal is also durably recorded on turn_runs.evidence_refused_reason. Returns completed | not_running with per-slot written and refused counts.';
