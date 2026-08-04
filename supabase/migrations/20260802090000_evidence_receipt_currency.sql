/*
  Enforces receipt currency for "Add as evidence" inside `complete_turn`
  itself (T10 review round 3, P0-2).

  Round 2 made the receipt durable and reload-reachable, but eligibility was
  never enforced where the write actually happens: `complete_turn` accepted
  any `research_findings` row belonging to the project, whatever turn
  produced it and whatever became of that turn afterwards. That left three
  real gaps:

  - a receipt whose own research pass later failed (mid-turn, after the
    finding had already been recorded) was exactly as addable as one from a
    turn that completed normally;
  - a later research pass superseding an earlier one client-side
    (`research_started`, see `turn-events.ts`) had no server-side
    counterpart — a caller could still submit the earlier pass's receipt id
    directly, bypassing whatever the client currently shows;
  - any historical receipt id from the same project, however old, was
    accepted identically to the one the conversation is actually about.

  The rule applied here is exactly the one `loadLatestResearchReceipt`
  already uses for reload hydration (`project-model-store.ts`): a receipt is
  current only if the turn that produced it actually completed, and only if
  no *later* completed pass has since superseded it. Two different code
  paths deciding "is this receipt current" independently is itself a defect
  reload and live state can silently disagree about — enforcing the rule
  here, at the one place the write can happen, is what makes it impossible
  to submit a receipt that has stopped being current, regardless of what a
  particular client believes.
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
  origin_turn_state public.turn_run_state;
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
    "Add as evidence" (T10 review round 2, P0-B/P0-C; round 3, P0-2). Each
    item names a receipt, never a target — the target is the receipt's own
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

    /*
      The receipt's own research pass has to have actually completed
      (T10 review round 3, P0-2) — *unless* it is this very turn's own
      research: the live engine can run `start_research` and `add_evidence`
      in the same turn (two tool rounds, one turn), and that turn's own
      `turn_runs` row is deliberately still `running` until the update at
      the very end of this function — checking it here would refuse a
      same-turn add every single time, not only a genuinely incomplete one.
      `research_findings` rows are written *before* the finding is shown,
      which is what makes the *other* case possible: a schema failure or
      timeout later in a *different*, still-open turn must not leave an
      otherwise-identical receipt just as addable as one whose turn
      genuinely finished.
    */
    if finding.turn_id <> p_turn_id then
      select state into origin_turn_state
      from public.turn_runs
      where turn_id = finding.turn_id and project_id = p_project_id;

      if origin_turn_state is distinct from 'completed' then
        refused := jsonb_set(
          refused, array[slot],
          coalesce(refused -> slot, '[]'::jsonb) || to_jsonb('research_incomplete'::text),
          true
        );
        continue;
      end if;
    end if;

    /*
      Not superseded: this must be the *latest* pass whose own turn
      completed, the same rule `loadLatestResearchReceipt` already applies
      for reload hydration (`project-model-store.ts`). Without this, a
      client that started a second research pass — or a caller submitting an
      old receipt id directly — could still add an earlier pass's finding as
      though the conversation had not moved on from it.
    */
    if exists (
      select 1
      from public.research_findings newer
      join public.turn_runs newer_run
        on newer_run.turn_id = newer.turn_id
       and newer_run.project_id = newer.project_id
      where newer.project_id = p_project_id
        and newer_run.state = 'completed'
        and (newer.created_at, newer.id) > (finding.created_at, finding.id)
    ) then
      refused := jsonb_set(
        refused, array[slot],
        coalesce(refused -> slot, '[]'::jsonb) || to_jsonb('research_superseded'::text),
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

comment on function public.complete_turn(uuid, uuid, uuid, text, jsonb, jsonb, jsonb) is
  'Stores a turn''s answer, applies its project-truth writes (fields, assumptions, evidence) and closes the run, in one transaction. An evidence item''s receipt must belong to a completed turn and must not have been superseded by a later completed pass. Returns completed | not_running with per-slot written and refused counts.';
