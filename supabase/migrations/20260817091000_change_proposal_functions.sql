/*
  Folds connected-change proposal creation into `complete_turn`'s own
  transaction, the same way T10 folded "Add as evidence" in — a proposal a
  model stages mid-turn is kept only if the turn's own transaction commits,
  and is otherwise indistinguishable from every other staged write's fate.

  Then the two functions that actually move a proposal: `apply_change_proposal`
  and `undo_change_proposal`. See the previous migration's header for why both
  are `security definer`, granted straight to `authenticated`, rather than
  invoker-rights functions the caller's own RLS would gate.
*/

drop function if exists public.complete_turn(
  uuid, uuid, uuid, text, jsonb, jsonb, jsonb
);

create or replace function public.complete_turn(
  p_project_id uuid,
  p_turn_id uuid,
  p_actor_id uuid,
  p_assistant_text text,
  p_fields jsonb,
  p_assumptions jsonb,
  p_evidence jsonb default '[]'::jsonb,
  p_proposals jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  proposal_item jsonb;
  change_item jsonb;
  existing record;
  slot text;
  written jsonb := '{}'::jsonb;
  refused jsonb := '{}'::jsonb;
  proposals jsonb := '{}'::jsonb;
  run record;
  checked_at timestamptz;
  finding record;
  v_evidence_id uuid;
  v_direction text;
  v_assumption_status public.assumption_status;
  v_proposal_id uuid;
  v_areas text[];
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

  for item in select * from jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb))
  loop
    slot := coalesce(item ->> 'slot', '0');

    select * into finding
    from public.research_findings
    where id = (item ->> 'receipt_id')::uuid and project_id = p_project_id;

    if not found then
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
        else 'affects'
      end::public.relationship_type,
      'researched',
      case v_direction
        when 'supports' then 'some_evidence'
        else 'hypothesis'
      end::public.support_state,
      item ->> 'consequence_summary'
    );

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

  /*
    Connected-change proposals (T11). Stored as intent only — nothing here
    touches `project_fields`. `before` is the model's own claim of the
    field's current value, kept for display and staleness-checking, never
    trusted as the value to restore; `apply_change_proposal` re-reads the
    live value at approval time (docs/ARCHITECTURE.md §11).
  */
  for proposal_item in select * from jsonb_array_elements(coalesce(p_proposals, '[]'::jsonb))
  loop
    slot := coalesce(proposal_item ->> 'slot', '0');

    insert into public.change_proposals
      (project_id, source_turn_id, title, rationale, remaining_uncertainty)
    values (
      p_project_id,
      p_turn_id,
      proposal_item ->> 'title',
      proposal_item ->> 'rationale',
      proposal_item ->> 'remaining_uncertainty'
    )
    returning id into v_proposal_id;

    v_areas := array[]::text[];
    for change_item in select * from jsonb_array_elements(coalesce(proposal_item -> 'items', '[]'::jsonb))
    loop
      insert into public.change_items (proposal_id, area, key, before, after)
      values (
        v_proposal_id,
        (change_item ->> 'area')::public.project_area,
        change_item ->> 'key',
        change_item ->> 'before',
        change_item ->> 'after'
      );
      v_areas := array_append(v_areas, change_item ->> 'area');
    end loop;

    written := jsonb_set(
      written, array[slot], to_jsonb(1), true
    );
    proposals := jsonb_set(
      proposals,
      array[slot],
      jsonb_build_object(
        'id', v_proposal_id,
        'title', proposal_item ->> 'title',
        'rationale', proposal_item ->> 'rationale',
        'areas', to_jsonb(array(select distinct unnest(v_areas)))
      ),
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
    'refused', refused,
    'proposals', proposals
  );
end;
$$;

revoke all on function public.complete_turn(
  uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb
) from public;
grant execute on function public.complete_turn(
  uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb
) to service_role;

comment on function public.complete_turn(
  uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb
) is
  'Stores a turn''s answer, applies its project-truth writes (fields, assumptions, evidence, connected-change proposals) and closes the run, in one transaction. Returns completed | not_running with per-slot written/refused counts and created proposal summaries.';

-- ---------------------------------------------------------------------------
-- Area -> document mapping
-- ---------------------------------------------------------------------------

create or replace function private.document_slug_for_area(p_area public.project_area)
returns public.document_slug
language sql
immutable
set search_path = ''
as $$
  select case p_area
    when 'problem' then 'problem_definition'::public.document_slug
    when 'customer' then 'target_customer'::public.document_slug
    when 'value_proposition' then 'value_proposition'::public.document_slug
    when 'mvp_scope' then 'mvp_scope'::public.document_slug
  end;
$$;

create or replace function private.document_title_for_slug(p_slug public.document_slug)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_slug
    when 'problem_definition' then 'Problem definition'
    when 'target_customer' then 'Target customer'
    when 'value_proposition' then 'Value proposition'
    when 'mvp_scope' then 'MVP scope'
  end;
$$;

revoke all on function private.document_slug_for_area(public.project_area) from public;
revoke all on function private.document_title_for_slug(public.document_slug) from public;

-- ---------------------------------------------------------------------------
-- Approving (fully or partially) or rejecting a proposal
-- ---------------------------------------------------------------------------

/*
  `p_decisions` is a jsonb array of `{item_id, included, after}`, one entry
  per item the reviewer actually looked at — `after` is present only when the
  person edited the proposed value. An item with no matching entry is treated
  as excluded: silence is not consent, and the sheet is expected to submit an
  explicit decision for every item it showed.

  Two checks happen before anything is written, and either can end the call
  without touching a row:

  - **Ownership.** `auth.uid()` must own the proposal's project. Checked by
    joining through `projects` under the row lock below, the same shape
    `assert_project_actor` uses for the service-role RPCs — this one just
    reads the actor from the session instead of a parameter, since a real one
    exists here.
  - **Currency.** `status` must still be `proposed`, and every field this
    proposal touches must still hold the value the proposal recorded as
    `before` (docs/ARCHITECTURE.md §11's "before values are recomputed at
    approval time"). Either failing returns `conflict` rather than raising —
    a stale proposal is an expected state to reach, not a fault — and nothing
    is written: not even the items that would still have been current.
*/
create or replace function public.apply_change_proposal(
  p_proposal_id uuid,
  p_decisions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_proposal record;
  v_item record;
  v_decision jsonb;
  v_current text;
  v_after text;
  v_included_count integer := 0;
  v_total_count integer := 0;
  v_status public.change_proposal_status;
  v_decision_id uuid;
  v_doc_slug public.document_slug;
  v_doc_id uuid;
  v_version_id uuid;
  v_correlation uuid := gen_random_uuid();
  v_areas text[] := array[]::text[];
begin
  if v_actor is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;

  select cp.* into v_proposal
  from public.change_proposals cp
  join public.projects p on p.id = cp.project_id
  where cp.id = p_proposal_id and p.owner_id = v_actor
  for update of cp;

  if not found then
    -- A proposal that does not exist and one owned by someone else raise the
    -- same outcome, so nothing about existence leaks.
    raise exception 'not_found_or_not_owner' using errcode = 'insufficient_privilege';
  end if;

  if v_proposal.status <> 'proposed' then
    return jsonb_build_object(
      'outcome', 'conflict', 'reason', 'already_decided', 'status', v_proposal.status
    );
  end if;

  perform 1 from public.change_items where proposal_id = p_proposal_id for update;

  for v_item in select * from public.change_items where proposal_id = p_proposal_id
  loop
    v_total_count := v_total_count + 1;

    select value into v_current
    from public.project_fields
    where project_id = v_proposal.project_id
      and area = v_item.area and key = v_item.key;

    if coalesce(v_current, '') is distinct from coalesce(v_item.before, '') then
      return jsonb_build_object(
        'outcome', 'conflict', 'reason', 'stale', 'item_id', v_item.id
      );
    end if;
  end loop;

  for v_decision in select * from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb))
  loop
    select * into v_item
    from public.change_items
    where id = (v_decision ->> 'item_id')::uuid and proposal_id = p_proposal_id;

    if not found then
      continue;
    end if;

    if coalesce((v_decision ->> 'included')::boolean, false) is not true then
      update public.change_items set included = false where id = v_item.id;
      continue;
    end if;

    v_after := coalesce(v_decision ->> 'after', v_item.after);
    v_included_count := v_included_count + 1;

    update public.change_items
    set included = true, after = v_after, applied_at = now()
    where id = v_item.id;

    insert into public.project_fields
      (project_id, area, key, label, value, origin, support)
    values (
      v_proposal.project_id, v_item.area, v_item.key, v_item.key, v_after,
      'ai_inferred', 'hypothesis'
    )
    on conflict (project_id, area, key) do update
    set value = excluded.value, updated_at = now();

    v_doc_slug := private.document_slug_for_area(v_item.area);
    insert into public.documents (project_id, slug, title)
    values (
      v_proposal.project_id, v_doc_slug, private.document_title_for_slug(v_doc_slug)
    )
    on conflict (project_id, slug) do nothing;

    select id into v_doc_id from public.documents
    where project_id = v_proposal.project_id and slug = v_doc_slug;

    insert into public.document_versions (document_id, content, origin, change_proposal_id)
    values (
      v_doc_id,
      jsonb_build_object(
        'sections', jsonb_build_array(
          jsonb_build_object('key', v_item.key, 'text', v_after, 'state', 'approved')
        )
      ),
      'ai_approved',
      p_proposal_id
    )
    returning id into v_version_id;

    update public.documents set current_version_id = v_version_id where id = v_doc_id;

    v_areas := array_append(v_areas, v_item.area::text);
  end loop;

  v_status := case
    when v_included_count = 0 then 'rejected'
    when v_included_count = v_total_count then 'approved'
    else 'partially_approved'
  end;

  update public.change_proposals
  set status = v_status, decided_at = now()
  where id = p_proposal_id;

  if v_status <> 'rejected' then
    insert into public.decisions
      (project_id, title, reasoning_summary, remaining_uncertainty,
       approved_by, change_proposal_id)
    values (
      v_proposal.project_id, v_proposal.title, v_proposal.rationale,
      v_proposal.remaining_uncertainty, v_actor, p_proposal_id
    )
    returning id into v_decision_id;
  end if;

  insert into public.audit_events
    (project_id, actor_id, actor_kind, action, target, correlation_id, detail)
  values (
    v_proposal.project_id, v_actor, 'user',
    case when v_status = 'rejected' then 'proposal_rejected' else 'proposal_approved' end,
    'change_proposal',
    v_correlation,
    jsonb_build_object(
      'proposal_id', p_proposal_id::text,
      'status', v_status,
      'included', v_included_count,
      'total', v_total_count
    )
  );

  return jsonb_build_object(
    'outcome', 'completed',
    'status', v_status,
    'decision_id', v_decision_id,
    'included', v_included_count,
    'total', v_total_count,
    'areas', to_jsonb(array(select distinct unnest(v_areas)))
  );
end;
$$;

revoke all on function public.apply_change_proposal(uuid, jsonb) from public;
grant execute on function public.apply_change_proposal(uuid, jsonb) to authenticated;

comment on function public.apply_change_proposal(uuid, jsonb) is
  'Approves (fully or partially) or rejects a connected-change proposal, transactionally: field writes, a new document_versions row per affected document, a decisions row (unless rejected) and an audit_events row. Refuses with conflict rather than writing if the proposal is no longer proposed or any field it targets has changed since the proposal was created.';

-- ---------------------------------------------------------------------------
-- Undoing an applied proposal
-- ---------------------------------------------------------------------------

/*
  Restores each included item's `before` value as a *new* write and a new
  document version — never rewriting the approval that happened. Refuses,
  again as `conflict` rather than a partial undo, if any field this proposal
  wrote has since changed again: undoing must not silently discard an edit
  that landed after the approval it is undoing (VERTICAL_SLICE_TASKS.md T11
  edge case: "undo after further edits").

  A `before` of null means the proposal created the field; undo deletes it
  rather than writing back an empty value the field could never legitimately
  hold.
*/
create or replace function public.undo_change_proposal(
  p_proposal_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_proposal record;
  v_item record;
  v_current text;
  v_doc_slug public.document_slug;
  v_doc_id uuid;
  v_version_id uuid;
  v_correlation uuid := gen_random_uuid();
  v_areas text[] := array[]::text[];
begin
  if v_actor is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;

  select cp.* into v_proposal
  from public.change_proposals cp
  join public.projects p on p.id = cp.project_id
  where cp.id = p_proposal_id and p.owner_id = v_actor
  for update of cp;

  if not found then
    raise exception 'not_found_or_not_owner' using errcode = 'insufficient_privilege';
  end if;

  if v_proposal.status not in ('approved', 'partially_approved') then
    return jsonb_build_object(
      'outcome', 'conflict', 'reason', 'not_undoable', 'status', v_proposal.status
    );
  end if;

  perform 1 from public.change_items
  where proposal_id = p_proposal_id and included for update;

  for v_item in
    select * from public.change_items where proposal_id = p_proposal_id and included
  loop
    select value into v_current
    from public.project_fields
    where project_id = v_proposal.project_id and area = v_item.area and key = v_item.key;

    if coalesce(v_current, '') is distinct from coalesce(v_item.after, '') then
      return jsonb_build_object(
        'outcome', 'conflict', 'reason', 'changed_since', 'item_id', v_item.id
      );
    end if;
  end loop;

  for v_item in
    select * from public.change_items where proposal_id = p_proposal_id and included
  loop
    if v_item.before is null then
      delete from public.project_fields
      where project_id = v_proposal.project_id and area = v_item.area and key = v_item.key;
    else
      update public.project_fields
      set value = v_item.before, updated_at = now()
      where project_id = v_proposal.project_id and area = v_item.area and key = v_item.key;
    end if;

    v_doc_slug := private.document_slug_for_area(v_item.area);
    select id into v_doc_id from public.documents
    where project_id = v_proposal.project_id and slug = v_doc_slug;

    if v_doc_id is not null then
      insert into public.document_versions (document_id, content, origin, change_proposal_id)
      values (
        v_doc_id,
        jsonb_build_object(
          'sections', jsonb_build_array(
            jsonb_build_object(
              'key', v_item.key,
              'text', coalesce(v_item.before, ''),
              'state', case when v_item.before is null then 'unvalidated' else 'working_draft' end
            )
          )
        ),
        'ai_approved',
        p_proposal_id
      )
      returning id into v_version_id;

      update public.documents set current_version_id = v_version_id where id = v_doc_id;
    end if;

    v_areas := array_append(v_areas, v_item.area::text);
  end loop;

  update public.change_proposals
  set status = 'undone'
  where id = p_proposal_id;

  insert into public.audit_events
    (project_id, actor_id, actor_kind, action, target, correlation_id, detail)
  values (
    v_proposal.project_id, v_actor, 'user', 'proposal_undone', 'change_proposal',
    v_correlation,
    jsonb_build_object('proposal_id', p_proposal_id::text)
  );

  return jsonb_build_object(
    'outcome', 'completed',
    'areas', to_jsonb(array(select distinct unnest(v_areas)))
  );
end;
$$;

revoke all on function public.undo_change_proposal(uuid) from public;
grant execute on function public.undo_change_proposal(uuid) to authenticated;

comment on function public.undo_change_proposal(uuid) is
  'Reverts an approved or partially-approved proposal''s included items to their prior values, as new writes and new document versions - never rewriting the approval itself. Refuses with conflict if a field has changed again since the approval it would undo, or if the proposal is not in an undoable state.';
