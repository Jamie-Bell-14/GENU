/*
  T10 review round 4 (head 8f2f286): two of the three residual P0s at the
  receipt-lifecycle boundary.

  1. Round 3's currency check ("the receipt's own turn completed, and no
     later *completed research pass* supersedes it") was its own, third
     definition of "current" — disagreeing with the one live client state
     already applies (retiring on *any* later turn completing, or on its own
     turn later failing) and the one reload hydration already applies (the
     project's most recent stored message must be this receipt's own turn's
     assistant message). A caller could still submit a receipt both the live
     client and a reload would already refuse to treat as current.

     This replaces that check with the *same* rule reload hydration already
     uses, expressed as a live predicate: a receipt is current only if the
     most recent message in the project *other than this turn's own* belongs
     to the receipt's own turn. That one predicate is exactly "no later turn
     has completed since this receipt's turn did" — which is what "current"
     already means everywhere else — and it naturally covers every case the
     old check needed a separate branch for:

     - a turn that never stored a message (failed, or still running) can
       never be "the latest message's turn", so an incomplete receipt is
       refused without a separate `turn_runs` state read;
     - an unrelated later turn completing stores its own message, which
       becomes the latest one, retiring the receipt exactly as reload would;
     - the *current* turn's own just-inserted message (inserted earlier in
       this same function, before this loop runs) is excluded from the
       comparison, so it cannot make an *older* receipt from a prior turn
       look current merely because this turn also happens to be the newest
       one — and a receipt named from *this very turn's own, still-running*
       research is refused outright, because this turn's own message can
       never appear as an *other* turn's latest message. Same-turn
       "Research this" → "Add as evidence" is consequently not supported at
       the write boundary at all (the application does not attempt it
       either — see `route.ts`, which clears the request's `activeFindingId`
       whenever this turn ran its own research pass, so the two enforce the
       same rule from both directions).

  2. `evidence_refused` was an SSE-only event: `complete_turn` committed the
     turn with no durable record of *why* a staged "Add as evidence" was not
     written, so a connection lost between that commit and the client
     consuming the live event — or simply a later reload — left only the
     stored assistant message's staged, present-progressive wording
     ("Adding this as evidence…") with no correction anywhere durable. This
     adds `turn_runs.evidence_refused_reason`, written in the same
     transaction as everything else the turn does, and returned by
     `turn_snapshot` so both catch-up and initial page hydration can recover
     the same outcome the live stream showed.
*/
alter table public.turn_runs
  add column evidence_refused_reason text
    check (char_length(evidence_refused_reason) <= 64);

comment on column public.turn_runs.evidence_refused_reason is
  'Why a staged "Add as evidence" proposal in this turn was not written, if any — the refusal code complete_turn produced, mapped to user-facing text the same way the live evidence_refused event is (T10 review round 4). Null when nothing was staged or it was written.';

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
  v_finding_turn_has_message boolean;
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
    "Add as evidence" (T10 review round 2, P0-B/P0-C; round 3/4, currency).
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
      Currency, defined once, the same way reload hydration already defines
      it (T10 review round 4): current iff no turn *other than this one* has
      stored a message more recently than the receipt's own turn did. This
      turn's own message was already inserted above, so it is excluded from
      "other" — otherwise this turn being the newest one in the project
      would always make an older receipt look current merely by comparison
      with itself.
    */
    select turn_id into v_latest_other_turn
    from public.messages
    where project_id = p_project_id and turn_id <> p_turn_id
    order by created_at desc
    limit 1;

    if v_latest_other_turn is distinct from finding.turn_id then
      select exists(
        select 1 from public.messages
        where project_id = p_project_id and turn_id = finding.turn_id
      ) into v_finding_turn_has_message;

      v_refusal_code := case
        when finding.turn_id = p_turn_id then 'research_not_yet_complete'
        when v_finding_turn_has_message then 'research_superseded'
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
  'Stores a turn''s answer, applies its project-truth writes (fields, assumptions, evidence) and closes the run, in one transaction. An evidence item''s receipt must belong to the project''s most recently message-producing turn, the same currency rule reload hydration applies; a refusal is also durably recorded on turn_runs.evidence_refused_reason. Returns completed | not_running with per-slot written and refused counts.';

/*
  `turn_snapshot` now also returns the durable evidence-refusal outcome, so
  catch-up can recover it exactly as the live `evidence_refused` stream event
  reported it (T10 review round 4).
*/
-- Postgres cannot change a function's return type with CREATE OR REPLACE;
-- this one now returns an additional column.
drop function if exists public.turn_snapshot(uuid, uuid);

create function public.turn_snapshot(
  p_project_id uuid,
  p_turn_id uuid
)
returns table (
  state text,
  message_id uuid,
  message_content text,
  message_created_at timestamptz,
  evidence_refused_reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when r.state = 'running' and now() >= r.lease_expires_at then 'expired'
      else r.state::text
    end as state,
    m.id,
    m.content,
    m.created_at,
    r.evidence_refused_reason
  from public.turn_runs r
  left join public.messages m
    on m.turn_id = r.turn_id
   and m.project_id = r.project_id
   and m.role = 'assistant'
  where r.turn_id = p_turn_id
    and r.project_id = p_project_id
    and private.is_project_owner(r.project_id);
$$;

revoke all on function public.turn_snapshot(uuid, uuid) from public;
grant execute on function public.turn_snapshot(uuid, uuid) to authenticated;
