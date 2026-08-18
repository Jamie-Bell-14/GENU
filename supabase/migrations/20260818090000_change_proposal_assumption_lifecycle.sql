/*
  Corrects the proposal-contingent assumption lifecycle from the T11 review
  round-5 fix for issue #28 (rejected/undone connected-change proposals
  leaving their reasoning behind as active project truth), plus a further
  round-6 correction to that same fix's own partial-approval behaviour.

  This is a *forward* migration rather than an edit to
  `20260817090000_change_proposals.sql` / `20260817091000_change_proposal_functions.sql`
  themselves (T11 review round 6, P0). Those two files had already been
  applied — via `supabase db push` — to a live database (the "GENU T11 Smoke
  Test" project) during manual QA on this branch, before this correction
  round existed. Editing an already-applied migration's file in place is
  invisible to that database: `supabase_migrations.schema_migrations`
  already records those two migration versions as applied, so a later `db
  push` never re-runs their now-different content against it, and the fix
  never reaches the database it was meant to fix. Both migration files have
  been restored to the exact form they had when they were last deployed
  (commit `5bc1231`); every correction below is instead a `create or
  replace` of the affected functions, plus additive `alter table` /
  `create index` statements — safe to run against both a fresh database
  (built from every migration file in order) and an already-migrated one
  (which only sees this file as new).

  Two corrections land together:

  1. The `assumptions` lifecycle columns themselves
     (`source_change_proposal_id`, `pending_decision`) and the corrected
     `complete_turn` (proposals staged before assumptions, so a
     proposal-contingent assumption has a real id to link to) and
     `undo_change_proposal` (retires a promoted assumption back to pending)
     — unchanged in substance from the round-5 fix, just relocated here.

  2. A real bug in that same round-5 fix, found on re-review (T11 review
     round 6, P1): `apply_change_proposal` promoted a contingent assumption
     on *any* non-rejected outcome, including a partial approval — but the
     assumption is linked to the whole proposal, not to the specific
     item/area it actually reasons about. A proposal touching two areas,
     with an assumption reasoning about only one of them, could be partially
     approved on the *other* area and still promote the assumption to active
     truth. Fixed by promoting only on a full approval; a partially-approved
     proposal's assumption now stays pending, the same conservative outcome
     a rejection already produces.
*/

-- ---------------------------------------------------------------------------
-- Assumption lifecycle, tied to the proposal it was inferred alongside
-- ---------------------------------------------------------------------------

/*
  A connected-change proposal correctly gates project-field writes behind
  explicit approval, but an assumption the model infers in the *same turn* as
  a `propose_connected_change` call — the reasoning behind the direction it is
  proposing — was written straight into `assumptions` as active, visible,
  canonical project truth, regardless of whether that proposal was ever
  approved. Rejecting or undoing the proposal left the assumption behind,
  looking like settled truth for a direction the person explicitly did not
  adopt (T11 manual QA, issue #28).

  `source_change_proposal_id` names the proposal an assumption was inferred
  alongside, when there was one; `pending_decision` is what actually gates
  visibility. Every read that treats assumptions as active project truth
  (`loadCanvasObjects`, which also supplies the model's own scene/context
  inventory) excludes a row while this is true. `apply_change_proposal`
  clears it on a *full* approval only (round 6, P1 — see this file's own
  header) — promoting the assumption the same moment the direction it
  reasons about becomes real in full — and `undo_change_proposal` sets it
  back on undo, retiring the assumption exactly when the fields it was
  reasoning about are themselves reverted. A *rejected* or
  *partially-approved* proposal's assumption is never promoted: it simply
  stays `pending_decision = true`, which is already "not an active
  hypothesis" without deleting the row — it survives as a historical trace
  of what was proposed, per the issue's own "retained only as historical
  reasoning if useful" framing.

  An assumption recorded with no proposal in the same turn at all — the
  ordinary, and by far the most common, case — gets `source_change_proposal_id
  = null`, `pending_decision = false` by construction: immediately active,
  exactly today's existing behaviour. Nothing about this changes for it.
*/
alter table public.assumptions
  add column if not exists source_change_proposal_id uuid
    references public.change_proposals (id) on delete set null,
  add column if not exists pending_decision boolean not null default false;

create index if not exists assumptions_source_proposal_idx
  on public.assumptions (source_change_proposal_id)
  where source_change_proposal_id is not null;

comment on column public.assumptions.source_change_proposal_id is
  'The connected-change proposal this assumption was inferred alongside in the same turn, if any (T11 review round 5, issue #28). Null for an assumption recorded independently of any proposal.';
comment on column public.assumptions.pending_decision is
  'True while source_change_proposal_id names a still-undecided, rejected, or partially-approved proposal: the row exists but must not read as active project truth (T11 review round 5, issue #28; round 6, P1). apply_change_proposal clears this on a *full* approval only; undo_change_proposal sets it back on undo. Never cleared for a rejected or partially-approved proposal, since the assumption was never promoted for either.';

-- ---------------------------------------------------------------------------
-- complete_turn — corrected to stage proposals before assumptions, so a
-- proposal-contingent assumption has a real proposal id to link to.
-- ---------------------------------------------------------------------------

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
  v_latest_other_turn uuid;
  v_latest_other_role text;
  v_finding_turn_has_answer boolean;
  v_refusal_code text;
  v_evidence_refused_reason text;
  v_proposal_id uuid;
  v_areas text[];
  v_object_ids uuid[];
  v_field_id uuid;
  v_field_value text;
  v_field_origin public.field_origin;
  v_field_support public.support_state;
  /*
    Links a proposal-contingent assumption to the turn's own proposal (T11
    review round 5, issue #28) — see the proposals loop below, which now
    runs before the assumptions loop for exactly this reason.
  */
  v_proposal_count integer := 0;
  v_single_proposal_id uuid;
  v_assumption_proposal_id uuid;
  v_assumption_pending boolean;
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

  /*
    Connected-change proposals (T11 review round 1, P1). Stored as intent
    only — nothing here touches `project_fields`. `before` is never the
    model's own claim of the field's current value: it is read fresh from
    `project_fields` here, by the server, for every item, the moment the
    proposal is staged. Two things follow from that. First, the review
    sheet's "Currently" column is always genuine project truth, never model
    prose — a model that describes the existing value imperfectly can no
    longer mislabel it. Second, `apply_change_proposal`'s staleness check
    becomes a true database-to-database comparison across two points in
    time, so it can never manufacture a false conflict out of a merely
    inaccurate model description (docs/ARCHITECTURE.md §11). A null `before`
    means the field does not exist yet in this project, exactly as an
    approval or an undo already interprets it.

    `v_object_ids` collects the canvas-object id (`project_fields.id`) of
    every item that already exists as a field, so the client can highlight
    precisely the objects this proposal touches — never the scene's own
    `visibleObjectIds`, which name everything a scene may show, not what a
    proposal changes.

    Runs *before* the assumptions loop below (T11 review round 5, issue #28):
    a proposal-contingent assumption needs its proposal's real id to link
    to, and that id does not exist until this loop creates the row.
    `v_proposal_count`/`v_single_proposal_id` are what the assumptions loop
    reads — see its own comment for why linkage is only attempted when a
    turn stages exactly one proposal.
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

    v_proposal_count := v_proposal_count + 1;

    v_areas := array[]::text[];
    v_object_ids := array[]::uuid[];
    for change_item in select * from jsonb_array_elements(coalesce(proposal_item -> 'items', '[]'::jsonb))
    loop
      /*
        A non-strict `select ... into` leaves its targets at their *previous*
        value when zero rows match — it does not clear them. v_field_id and
        friends are declared once for the whole function and reused by every
        item in every proposal, so without this reset a field that does not
        exist yet would silently inherit an earlier item's real id/value/
        origin/support as its "before" instead of being recorded as null.
      */
      v_field_id := null;
      v_field_value := null;
      v_field_origin := null;
      v_field_support := null;
      select id, value, origin, support
      into v_field_id, v_field_value, v_field_origin, v_field_support
      from public.project_fields
      where project_id = p_project_id
        and area = (change_item ->> 'area')::public.project_area
        and key = change_item ->> 'key';

      /*
        `before_origin`/`before_support` snapshot the same real row `before`
        does, at the same instant (T11 review round 2, P1) — so
        `undo_change_proposal` can restore what an approval overwrites in
        full, not only the text.
      */
      insert into public.change_items
        (proposal_id, area, key, before, before_origin, before_support, after)
      values (
        v_proposal_id,
        (change_item ->> 'area')::public.project_area,
        change_item ->> 'key',
        v_field_value,
        v_field_origin,
        v_field_support,
        change_item ->> 'after'
      );
      v_areas := array_append(v_areas, change_item ->> 'area');
      if v_field_id is not null then
        v_object_ids := array_append(v_object_ids, v_field_id);
      end if;
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
        'areas', to_jsonb(array(select distinct unnest(v_areas))),
        'object_ids', to_jsonb(coalesce(v_object_ids, array[]::uuid[]))
      ),
      true
    );
  end loop;

  -- Exactly one proposal this turn is the only case linkage can be
  -- unambiguous in; see the assumptions loop below.
  v_single_proposal_id := case
    when v_proposal_count = 1 then v_proposal_id
    else null
  end;

  for item in select * from jsonb_array_elements(coalesce(p_assumptions, '[]'::jsonb))
  loop
    slot := coalesce(item ->> 'slot', '0');

    if (item ->> 'origin') = 'user_stated'
       and (item ->> 'source_excerpt') is null then
      raise exception 'unsourced_user_stated:assumption'
        using errcode = 'check_violation';
    end if;

    /*
      Proposal-contingent assumption linkage (T11 review round 5, issue #28).
      An assumption the model marked `contingent_on_proposal` is reasoning
      behind the direction this turn is also proposing — it starts
      `pending_decision = true`, invisible to every read that treats
      assumptions as active project truth, until `apply_change_proposal`
      promotes it. An ordinary assumption (the common case: the flag is
      false, or absent) gets neither column set, exactly today's existing
      behaviour. Linkage is only attempted when this turn staged exactly one
      proposal — `v_single_proposal_id` is null otherwise, including when it
      staged none at all, and a flagged assumption with no proposal to link
      to is recorded as an ordinary one rather than left pending forever
      with nothing that could ever promote it.
    */
    v_assumption_proposal_id := null;
    v_assumption_pending := false;
    if coalesce((item ->> 'contingent_on_proposal')::boolean, false)
       and v_single_proposal_id is not null then
      v_assumption_proposal_id := v_single_proposal_id;
      v_assumption_pending := true;
    end if;

    insert into public.assumptions
      (project_id, statement, why_it_matters, alternatives, importance, origin,
       source_turn_id, source_excerpt, source_change_proposal_id, pending_decision)
    values (
      p_project_id,
      item ->> 'statement',
      item ->> 'why_it_matters',
      coalesce(item -> 'alternatives', '[]'::jsonb),
      item ->> 'importance',
      (item ->> 'origin')::public.field_origin,
      case when item ->> 'source_excerpt' is null then null else p_turn_id end,
      item ->> 'source_excerpt',
      v_assumption_proposal_id,
      v_assumption_pending
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

  update public.turn_runs
  set state = 'completed',
      accepting_direction = false,
      ended_at = now(),
      evidence_refused_reason = v_evidence_refused_reason
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
  'Stores a turn''s answer, applies its project-truth writes (fields, assumptions, evidence, connected-change proposals) and closes the run, in one transaction. An evidence item''s receipt must belong to the project''s most recently *answered* turn (role = assistant, not merely a stored message), the same currency rule reload hydration applies; a refusal is also durably recorded on turn_runs.evidence_refused_reason. A proposal item''s before value is always read fresh from project_fields by this function, never trusted from the model. An assumption marked contingent_on_proposal is linked to this turn''s own proposal (only when exactly one was staged) and recorded pending_decision = true, invisible as active project truth until apply_change_proposal promotes it. Returns completed | not_running with per-slot written/refused counts and created proposal summaries (including each proposal''s affected canvas-object ids).';

-- ---------------------------------------------------------------------------
-- apply_change_proposal — corrected to promote a linked assumption only on
-- a full approval, never a partial one (T11 review round 6, P1).
-- ---------------------------------------------------------------------------

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
  v_decision_included boolean;
  v_decision_after text;
  v_current text;
  v_after text;
  v_included_count integer := 0;
  v_total_count integer := 0;
  v_status public.change_proposal_status;
  v_decision_id uuid;
  v_doc_slug public.document_slug;
  v_doc_id uuid;
  v_current_version_id uuid;
  v_version_id uuid;
  v_correlation uuid := gen_random_uuid();
  v_areas text[] := array[]::text[];
  /*
    Sections an included item contributes, grouped by the *document* it
    belongs to rather than written one row per item (T11 review round 3, P1):
    `{ "<document_slug>": { "<item key>": {"text": ..., "state": "approved"} } }`.
    A document version is a document's whole ordered section set, so a
    proposal touching two keys in the same document must produce one new
    version containing both — never two successive versions each missing the
    other's section, with `current_version_id` left pointing at whichever
    happened to apply last.
  */
  v_doc_sections jsonb := '{}'::jsonb;
  v_doc_slug_text text;
  v_existing_sections jsonb;
  v_ordered_sections jsonb;
  v_section jsonb;
  v_section_key text;
  v_new_value jsonb;
  v_seen_keys text[];
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

  select count(*) into v_total_count
  from public.change_items where proposal_id = p_proposal_id;

  /*
    Both passes below loop over `change_items` — the proposal's own bounded,
    already-distinct set of targets — rather than over `p_decisions` directly
    (T11 review round 2, P0). Looping the caller's own array let a client
    submit the same item_id more than once and inflate `v_included_count`
    past a real distinct approval, double-write a document version for one
    item, or otherwise manufacture approval state this function never
    intended a malformed request to reach. `change_items` is the authority on
    what a decision can possibly be about; `p_decisions` is only consulted
    per item, and `order by ord desc limit 1` takes the *last* matching entry
    if a duplicate item_id slipped through anyway (the request schema also
    rejects duplicates before this function is ever called, so this is
    defence in depth, not the primary guard).
  */

  -- Staleness is checked only for items this decision includes — see the
  -- function's own header for why an excluded item's drift must never block
  -- a rejection or the rest of a partial approval.
  for v_item in
    select * from public.change_items where proposal_id = p_proposal_id
  loop
    -- Same non-strict-select reset complete_turn's own comment explains:
    -- these must be cleared every iteration, not left at the previous item's
    -- decision when this item has none of its own.
    v_decision_included := null;
    v_decision_after := null;
    select (d.value ->> 'included')::boolean, d.value ->> 'after'
    into v_decision_included, v_decision_after
    from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) with ordinality as d(value, ord)
    where (d.value ->> 'item_id')::uuid = v_item.id
    order by d.ord desc
    limit 1;

    if coalesce(v_decision_included, false) is not true then
      continue;
    end if;

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

  for v_item in
    select * from public.change_items where proposal_id = p_proposal_id
  loop
    v_decision_included := null;
    v_decision_after := null;
    select (d.value ->> 'included')::boolean, d.value ->> 'after'
    into v_decision_included, v_decision_after
    from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) with ordinality as d(value, ord)
    where (d.value ->> 'item_id')::uuid = v_item.id
    order by d.ord desc
    limit 1;

    /*
      An item with no decision, or an explicit `included: false`, is excluded
      — silence is not consent (see the function's header) — and is recorded
      as such rather than left at `change_items.included`'s creation default
      of `true` (T11 review round 2, P1: a rejected or partially-approved
      proposal's own item rows must say what actually happened, not merely
      whatever they defaulted to when the proposal was staged).
    */
    if coalesce(v_decision_included, false) is not true then
      update public.change_items set included = false where id = v_item.id;
      continue;
    end if;

    v_after := coalesce(v_decision_after, v_item.after);
    v_included_count := v_included_count + 1;

    update public.change_items
    set included = true, after = v_after, applied_at = now()
    where id = v_item.id;

    /*
      Origin/support are set unconditionally on both branches of this upsert
      (T11 review round 2, P1). Approving a connected-change proposal is the
      one route by which an AI-originated value is allowed to supersede
      protected wording — including a field the person themselves stated —
      so the field's metadata must say what actually happened: an approved
      AI-proposed value, never a stale claim that the text is still "user
      stated" or still carries the support level earned by whatever it used
      to say. `undo_change_proposal` restores the prior origin/support from
      `before_origin`/`before_support`, snapshotted at proposal-creation
      time, so this is not a one-way loss of provenance.
    */
    insert into public.project_fields
      (project_id, area, key, label, value, origin, support)
    values (
      v_proposal.project_id, v_item.area, v_item.key, v_item.key, v_after,
      'ai_inferred', 'hypothesis'
    )
    on conflict (project_id, area, key) do update
    set value = excluded.value,
        origin = excluded.origin,
        support = excluded.support,
        updated_at = now();

    /*
      Collected per document, not written yet — see the post-loop below for
      why (T11 review round 3, P1). A single-level `jsonb_set`, not a
      two-level path straight into `v_doc_sections`: `jsonb_set` can only
      create a *missing* key at the last path element — it will not
      auto-vivify a missing intermediate container, so a two-level path into
      a brand-new `v_doc_sections` (or a document not yet seen this call)
      would silently no-op and leave `v_doc_sections` empty for that
      document. Building the merged per-document object first sidesteps
      that entirely.
    */
    v_doc_slug_text := private.document_slug_for_area(v_item.area)::text;
    v_doc_sections := jsonb_set(
      v_doc_sections,
      array[v_doc_slug_text],
      coalesce(v_doc_sections -> v_doc_slug_text, '{}'::jsonb)
        || jsonb_build_object(
             v_item.key, jsonb_build_object('text', v_after, 'state', 'approved')
           ),
      true
    );

    v_areas := array_append(v_areas, v_item.area::text);
  end loop;

  /*
    One new document_versions row per *affected document*, not per item (T11
    review round 3, P1): a document version is the document's whole ordered
    section set, so two included items targeting the same document must
    produce a single new version containing both resulting sections, built on
    top of whatever sections the document's current version already had —
    never two successive versions each overwriting `current_version_id` with
    a payload that omits the other's section.
  */
  for v_doc_slug_text in select jsonb_object_keys(v_doc_sections)
  loop
    v_doc_slug := v_doc_slug_text::public.document_slug;

    insert into public.documents (project_id, slug, title)
    values (
      v_proposal.project_id, v_doc_slug, private.document_title_for_slug(v_doc_slug)
    )
    on conflict (project_id, slug) do nothing;

    select id, current_version_id into v_doc_id, v_current_version_id
    from public.documents
    where project_id = v_proposal.project_id and slug = v_doc_slug;

    /*
      A brand-new document has no current version, so `v_current_version_id`
      is null and this select matches zero rows — a non-strict select-into
      leaves its target unchanged on zero rows (the same gotcha fixed
      elsewhere in this file), so this reset is required, not defensive
      decoration: without it, a document processed earlier in this loop that
      *did* have existing sections would leak them onto a later, genuinely
      new document in the same proposal.
    */
    v_existing_sections := null;
    select content -> 'sections' into v_existing_sections
    from public.document_versions
    where id = v_current_version_id;

    -- Existing sections keep their position, updated in place if this
    -- proposal touches them; sections this proposal introduces for the
    -- first time are appended in the order they were collected above.
    v_ordered_sections := '[]'::jsonb;
    v_seen_keys := array[]::text[];
    for v_section in select * from jsonb_array_elements(coalesce(v_existing_sections, '[]'::jsonb))
    loop
      v_section_key := v_section ->> 'key';
      v_new_value := v_doc_sections -> v_doc_slug_text -> v_section_key;
      v_ordered_sections := v_ordered_sections || jsonb_build_array(
        case
          when v_new_value is not null then
            jsonb_build_object(
              'key', v_section_key,
              'text', v_new_value ->> 'text',
              'state', v_new_value ->> 'state'
            )
          else v_section
        end
      );
      v_seen_keys := array_append(v_seen_keys, v_section_key);
    end loop;

    for v_section_key in select jsonb_object_keys(v_doc_sections -> v_doc_slug_text)
    loop
      if not (v_section_key = any(v_seen_keys)) then
        v_new_value := v_doc_sections -> v_doc_slug_text -> v_section_key;
        v_ordered_sections := v_ordered_sections || jsonb_build_array(
          jsonb_build_object(
            'key', v_section_key,
            'text', v_new_value ->> 'text',
            'state', v_new_value ->> 'state'
          )
        );
      end if;
    end loop;

    insert into public.document_versions (document_id, content, origin, change_proposal_id)
    values (
      v_doc_id,
      jsonb_build_object('sections', v_ordered_sections),
      'ai_approved',
      p_proposal_id
    )
    returning id into v_version_id;

    update public.documents set current_version_id = v_version_id where id = v_doc_id;
  end loop;

  v_status := case
    when v_included_count = 0 then 'rejected'
    when v_included_count = v_total_count then 'approved'
    else 'partially_approved'
  end;

  update public.change_proposals
  set status = v_status, decided_at = now()
  where id = p_proposal_id;

  /*
    Promotes an assumption that was recorded as this proposal's own reasoning
    (T11 review round 5, issue #28) — but only on a *full* approval, never a
    partial one (T11 review round 6, P1). The link is to the whole proposal,
    not to the specific item/area the assumption actually reasons about: a
    proposal touching both "target customer" and "MVP scope", with an
    assumption reasoning specifically about the customer change, must not
    promote that assumption when the person excluded the customer item and
    approved only the scope item. Promoting on any non-rejected outcome (the
    original round-5 rule) would have recreated exactly the trust problem
    #28 exists to close, through T11's own partial-approval path. The
    conservative, deterministic rule: an assumption is trustworthy as active
    project truth only once the proposal it reasons about was accepted in
    full. A partially-approved proposal's assumption therefore stays
    `pending_decision = true` — not wrong, just not yet provably right —
    exactly like a rejected proposal's own assumption, until either a fuller
    linkage model (item/area-scoped, not proposal-scoped) replaces this, or
    the proposal is re-decided in a way this function does not currently
    allow.
  */
  if v_status = 'approved' then
    update public.assumptions
    set pending_decision = false
    where source_change_proposal_id = p_proposal_id;
  end if;

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
    -- A bare CASE resolves its branches' type as `text`, not the "unknown"
    -- literal type a plain string gets — an explicit cast is required here,
    -- unlike the direct 'proposal_undone' literal below (T11 review round 1,
    -- P0: this was missing and raised 42804 against every apply/reject).
    (case when v_status = 'rejected' then 'proposal_rejected' else 'proposal_approved' end)
      ::public.audit_action,
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
  'Approves (fully or partially) or rejects a connected-change proposal, transactionally: field writes (value, origin and support all overwritten to reflect the approved AI-proposed value), one new document_versions row per affected document — its full ordered section set, existing sections preserved and updated in place, new ones appended, never one row per item — a decisions row (unless rejected) and an audit_events row. Every change_items row is set to included=true or false to match what was actually decided, never left at its creation default. On a *full* approval only (never a partial one, T11 review round 6, P1 — the link is to the whole proposal, not the specific item an assumption reasons about), promotes (pending_decision = false) every assumption complete_turn linked to this proposal, so the reasoning behind a fully-accepted direction stops being excluded from active project truth the same moment the direction itself becomes real. Refuses with conflict rather than writing if the proposal is no longer proposed or any field an included item targets has changed since the proposal was created. Iterates change_items rather than the caller''s own decisions array, so a duplicate or unknown item id in the request cannot inflate the approval count.';

-- ---------------------------------------------------------------------------
-- undo_change_proposal — corrected to retire a linked assumption back to
-- pending on undo, unchanged in substance from the round-5 fix.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Undoing an applied proposal
-- ---------------------------------------------------------------------------

/*
  Restores each included item's `before` value as a *new* write, and writes
  one new document version per affected document — its full ordered section
  set, not one row per item (T11 review round 3, P1; see
  apply_change_proposal for the same reasoning) — never rewriting the
  approval that happened. Refuses, again as `conflict` rather than a partial
  undo, if any field this proposal wrote has since changed again: undoing
  must not silently discard an edit that landed after the approval it is
  undoing (VERTICAL_SLICE_TASKS.md T11 edge case: "undo after further
  edits").

  A `before` of null means the proposal created the field; undo deletes it
  rather than writing back an empty value the field could never legitimately
  hold. Otherwise it restores `before_origin`/`before_support` alongside
  `before` (T11 review round 2, P1) — approval overwrites all three, so undo
  restores all three.
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
  v_current_version_id uuid;
  v_version_id uuid;
  v_correlation uuid := gen_random_uuid();
  v_areas text[] := array[]::text[];
  -- Same document-scoped accumulation apply_change_proposal uses, and for
  -- the same reason (T11 review round 3, P1): one new version per affected
  -- document, never one per item.
  v_doc_sections jsonb := '{}'::jsonb;
  v_doc_slug_text text;
  v_existing_sections jsonb;
  v_ordered_sections jsonb;
  v_section jsonb;
  v_section_key text;
  v_new_value jsonb;
  v_seen_keys text[];
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
      /*
        Restores the field's prior origin/support along with its text (T11
        review round 2, P1) — approval overwrote all three (see
        apply_change_proposal), so undoing it has to restore all three, not
        leave the field's provenance saying "approved AI-proposed value"
        for wording that is once again exactly what it was beforehand.
      */
      update public.project_fields
      set value = v_item.before,
          origin = v_item.before_origin,
          support = v_item.before_support,
          updated_at = now()
      where project_id = v_proposal.project_id and area = v_item.area and key = v_item.key;
    end if;

    /*
      Collected per document, written once below — see apply_change_proposal
      for why, including why this has to be a single-level `jsonb_set` with
      the per-document object merged first rather than a two-level path
      straight into `v_doc_sections` (T11 review round 3, P1). A document
      that was never created (this proposal's own approval had no
      affected-document row for it, which cannot happen for an included
      item, but kept as a defensive no-op) simply contributes nothing
      further below.

      When `v_item.before is null`, the field did not exist before this
      proposal was approved — undoing it must remove that section from the
      document entirely, not leave a ghost empty-text section behind (T11
      review round 4, P1). A jsonb `null` is stored as an explicit delete
      sentinel and interpreted below, since a missing map key and an
      explicit "delete this key" both need to be distinguishable from an
      ordinary restored section.
    */
    v_doc_slug_text := private.document_slug_for_area(v_item.area)::text;
    v_doc_sections := jsonb_set(
      v_doc_sections,
      array[v_doc_slug_text],
      coalesce(v_doc_sections -> v_doc_slug_text, '{}'::jsonb)
        || jsonb_build_object(
             v_item.key,
             case
               when v_item.before is null then 'null'::jsonb
               else jsonb_build_object('text', v_item.before, 'state', 'working_draft')
             end
           ),
      true
    );

    v_areas := array_append(v_areas, v_item.area::text);
  end loop;

  for v_doc_slug_text in select jsonb_object_keys(v_doc_sections)
  loop
    v_doc_slug := v_doc_slug_text::public.document_slug;

    -- Reset before each select-into below — see apply_change_proposal's own
    -- comment on the same non-strict-select gotcha; a document/version
    -- lookup matching zero rows must never inherit the previous document's
    -- values.
    v_doc_id := null;
    v_current_version_id := null;
    select id, current_version_id into v_doc_id, v_current_version_id
    from public.documents
    where project_id = v_proposal.project_id and slug = v_doc_slug;

    if v_doc_id is null then
      continue;
    end if;

    v_existing_sections := null;
    select content -> 'sections' into v_existing_sections
    from public.document_versions
    where id = v_current_version_id;

    v_ordered_sections := '[]'::jsonb;
    v_seen_keys := array[]::text[];
    for v_section in select * from jsonb_array_elements(coalesce(v_existing_sections, '[]'::jsonb))
    loop
      v_section_key := v_section ->> 'key';
      v_new_value := v_doc_sections -> v_doc_slug_text -> v_section_key;
      v_seen_keys := array_append(v_seen_keys, v_section_key);

      -- An explicit delete sentinel (T11 review round 4, P1): this item's
      -- undo means the field never existed before the proposal it undoes,
      -- so its section is dropped from the new version entirely rather
      -- than restored as an empty stub.
      if v_new_value is not null and jsonb_typeof(v_new_value) = 'null' then
        continue;
      end if;

      v_ordered_sections := v_ordered_sections || jsonb_build_array(
        case
          when v_new_value is not null then
            jsonb_build_object(
              'key', v_section_key,
              'text', v_new_value ->> 'text',
              'state', v_new_value ->> 'state'
            )
          else v_section
        end
      );
    end loop;

    for v_section_key in select jsonb_object_keys(v_doc_sections -> v_doc_slug_text)
    loop
      if not (v_section_key = any(v_seen_keys)) then
        v_new_value := v_doc_sections -> v_doc_slug_text -> v_section_key;

        -- Defensive: a delete sentinel for a key that was never in the
        -- document's existing sections has nothing to remove.
        if jsonb_typeof(v_new_value) = 'null' then
          continue;
        end if;

        v_ordered_sections := v_ordered_sections || jsonb_build_array(
          jsonb_build_object(
            'key', v_section_key,
            'text', v_new_value ->> 'text',
            'state', v_new_value ->> 'state'
          )
        );
      end if;
    end loop;

    insert into public.document_versions (document_id, content, origin, change_proposal_id)
    values (
      v_doc_id,
      jsonb_build_object('sections', v_ordered_sections),
      'ai_approved',
      p_proposal_id
    )
    returning id into v_version_id;

    update public.documents set current_version_id = v_version_id where id = v_doc_id;
  end loop;

  update public.change_proposals
  set status = 'undone'
  where id = p_proposal_id;

  /*
    Retires an assumption that was promoted when this proposal was approved
    (T11 review round 5, issue #28) — undo reverts the fields it reasoned
    about, so the reasoning itself must stop reading as active project truth
    too, the same way approval promoted it in the first place. The row
    survives, `pending_decision = true` again, exactly like a rejected
    proposal's own assumption never promoted at all.
  */
  update public.assumptions
  set pending_decision = true
  where source_change_proposal_id = p_proposal_id;

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
  'Reverts an approved or partially-approved proposal''s included items to their prior value, origin and support, as new writes and one new document version per affected document (its full ordered section set, never one row per item) - never rewriting the approval itself. Also retires (pending_decision = true) every assumption complete_turn linked to this proposal, so its reasoning stops reading as active project truth the same moment the fields it reasoned about are reverted. Refuses with conflict if a field has changed again since the approval it would undo, or if the proposal is not in an undoable state.';
