/*
  Folds "Add as evidence" into `complete_turn`'s own transaction
  (T10 review round 2, P0-B, superseding the standalone `add_evidence_link`
  from review round 1).

  Round 1 kept evidence-linking as its own immediately-committed action,
  independent of the surrounding model turn, so the assistant's reply could
  say plainly whether it had happened. Round 2 found the seam that left open:
  the write was genuinely atomic on its own, but its *outcome* was not
  durably recoverable the way every other staged write already is. A Stop or
  a lost connection after the write committed left nothing for catch-up to
  recover — catch-up only ever looks at the stored assistant message and
  `turn_runs`' terminal state, both of which are `complete_turn`'s own
  concern, not a second, parallel one this file used to invent.

  Staging it here instead means "Add as evidence" inherits everything that
  already makes fields and assumptions recoverable, for free: one commit for
  the answer, the write and the terminal state; a stored message that
  catch-up already treats as settlement; a `project_model_updated` refresh
  already triggered by `finishTurn` whenever anything changed. The trade is
  that the model's own reply can no longer say "added" in the same breath it
  proposes the write — exactly the same trade every other staged tool
  already makes (see `STAGED` in `anthropic-engine.ts`), and the honest
  phrasing that trade requires is the model's to compose, guided by the
  same tool-result convention as every other staged write.

  This also fixes the false-certainty half of round 1's P0-3: the relation
  and support state are no longer written unconditionally as `supports` /
  `some_evidence`. `p_evidence` items now carry a `direction` the caller
  determined — never inferred here — of `supports`, `contradicts` or
  `unclear`; an assumption's status only moves when a direction was actually
  determined, and only ever from `open`, never overwriting one already
  resolved.
*/
drop function if exists public.add_evidence_link(
  uuid, uuid, uuid, uuid, uuid, text
);

drop function if exists public.complete_turn(
  uuid, uuid, uuid, text, jsonb, jsonb
);

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
    "Add as evidence" (T10 review round 2, P0-B/P0-C). Each item names a
    receipt, never a target — the target is the receipt's own
    `focal_object_id`, so this cannot attach evidence to whatever object
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
      refused := jsonb_set(
        refused, array[slot],
        coalesce(refused -> slot, '[]'::jsonb) || to_jsonb('no_active_research'::text),
        true
      );
      continue;
    end if;

    if finding.focal_object_id is null then
      refused := jsonb_set(
        refused, array[slot],
        coalesce(refused -> slot, '[]'::jsonb) || to_jsonb('no_focal_object'::text),
        true
      );
      continue;
    end if;

    -- Get or create the evidence row for this exact receipt. `do update` is
    -- used only so `returning` still yields the existing row's id on a
    -- repeat call — nothing about the row actually changes.
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
    on conflict (project_id, source_receipt_id)
      do update set title = excluded.title
    returning id into v_evidence_id;

    -- Idempotent regardless of `direction`: a repeat call must not create a
    -- second edge with a different relation just because it asked for one.
    if exists (
      select 1 from public.project_relationships
      where from_object_id = v_evidence_id and to_object_id = finding.focal_object_id
    ) then
      refused := jsonb_set(
        refused, array[slot],
        coalesce(refused -> slot, '[]'::jsonb) || to_jsonb('already_linked'::text),
        true
      );
      continue;
    end if;

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
      ended_at = now()
  where turn_id = p_turn_id and state = 'running';

  return jsonb_build_object(
    'outcome', 'completed',
    'written', written,
    'refused', refused
  );
end;
$$;

revoke all on function public.complete_turn(uuid, uuid, uuid, text, jsonb, jsonb, jsonb)
  from public;
grant execute on function public.complete_turn(uuid, uuid, uuid, text, jsonb, jsonb, jsonb)
  to service_role;

comment on function public.complete_turn(uuid, uuid, uuid, text, jsonb, jsonb, jsonb) is
  'Stores a turn''s answer, applies its project-truth writes (fields, assumptions, evidence) and closes the run, in one transaction. Returns completed | not_running with per-slot written and refused counts.';
