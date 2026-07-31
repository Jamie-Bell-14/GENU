/*
  Adding evidence, as one atomic operation (T10 review round 1, P0-2, P0-3).

  DESIGN.md §13.1 classifies "adding cited evidence" as a low-risk automatic
  change — no approval workflow — but automatic is not the same question as
  atomic, and the original implementation conflated the two: it wrote the
  `evidence` row and its link as two separate client round trips, outside any
  transaction boundary, so a failure between them could leave an orphaned
  evidence row, and a later, unrelated turn failure could leave evidence
  written while the turn's own failure message claimed nothing had changed.

  This function is `security definer`, like `complete_turn`, and for the
  same reason: it authorises its own caller against `p_actor_id` rather than
  depending on RLS or on the caller having checked ownership first
  (SECURITY_STANDARDS §11.2).

  It does not fold into `complete_turn`'s own transaction. That was
  considered and rejected: staging evidence there would mean the assistant's
  response — composed and streamed *before* the turn's final commit — could
  never honestly say whether the add succeeded, forcing every "Add as
  evidence" reply into the same hedged, not-yet-confirmed phrasing
  `update_project_model` already needs. Evidence-linking is fast, has no
  later step that depends on its outcome, and its own onward effects (the
  canvas refresh) are triggered directly by its caller once this call
  returns — so a dedicated, immediately-committed action with a truthful
  result is the more honest design, not a compromise on atomicity: this
  function's own transaction is exactly as all-or-none as `complete_turn`'s.
*/
create or replace function public.add_evidence_link(
  p_project_id uuid,
  p_turn_id uuid,
  p_actor_id uuid,
  p_receipt_id uuid,
  p_object_id uuid,
  p_consequence_summary text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  run record;
  checked_at timestamptz;
  finding record;
  v_evidence_id uuid;
  v_rows integer;
  v_assumption_status public.assumption_status;
begin
  perform private.assert_project_actor(p_project_id, p_actor_id);

  /*
    The turn this call is attributed to must still be the one actually
    running, under the same lock and the same clock_timestamp() reasoning as
    `complete_turn` (see 20260730110000_lease_expiry_wall_clock.sql) — a call
    arriving after its turn's lease has lapsed must not silently attribute a
    write to a run that has already been reported to the user as finished or
    expired.
  */
  select state, lease_expires_at into run
  from public.turn_runs
  where turn_id = p_turn_id and project_id = p_project_id
  for update;

  checked_at := clock_timestamp();

  if not found or run.state <> 'running' or checked_at >= run.lease_expires_at
  then
    return 'not_running';
  end if;

  /*
    Reject stale, foreign, unknown or never-produced results (T10 review
    round 1, P0-1): a receipt id naming no row this project produced is
    exactly as invalid as one that never existed. RLS is not consulted here
    (security definer), so this check is the whole of that boundary.
  */
  select * into finding
  from public.research_findings
  where id = p_receipt_id and project_id = p_project_id;

  if not found then
    return 'no_active_research';
  end if;

  if not exists (
    select 1 from public.project_objects
    where id = p_object_id and project_id = p_project_id
  ) then
    return 'no_focal_object';
  end if;

  /*
    Get or create the evidence row for this exact result. On conflict,
    `do update` is used only so `returning` still yields the existing row's
    id — nothing about the row actually changes on a repeat call.
  */
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

  insert into public.project_relationships (
    project_id, from_object_id, to_object_id, relation, origin, support, note
  )
  values (
    p_project_id,
    v_evidence_id,
    p_object_id,
    'supports',
    'researched',
    'some_evidence',
    p_consequence_summary
  )
  on conflict (from_object_id, to_object_id, relation) do nothing;

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return 'already_linked';
  end if;

  /*
    Step 6's "the assumption's state visibly changes if appropriate"
    (VERTICAL_SLICE_SPEC), applied conservatively. Whether this specific
    evidence *supports* or *weakens* an arbitrary, user-authored assumption
    statement is a semantic question this scripted provider cannot honestly
    answer — guessing a direction would be exactly the false certainty this
    product exists to avoid. What can be said honestly, generically, for any
    target: an assumption that was genuinely unexplored now has evidence
    bearing on it. So only a currently-'open' assumption moves, and only to
    'supported' — never further, and never overwriting an assumption the
    project has already resolved one way or another.
  */
  select status into v_assumption_status
  from public.assumptions
  where id = p_object_id and project_id = p_project_id
  for update;

  if found and v_assumption_status = 'open' then
    update public.assumptions
    set status = 'supported'
    where id = p_object_id and project_id = p_project_id;
  end if;

  return 'linked';
end;
$$;

revoke all on function public.add_evidence_link(
  uuid, uuid, uuid, uuid, uuid, text
) from public;
grant execute on function public.add_evidence_link(
  uuid, uuid, uuid, uuid, uuid, text
) to service_role;

comment on function public.add_evidence_link(
  uuid, uuid, uuid, uuid, uuid, text
) is
  'Atomically creates (or reuses) an evidence row from a research_findings receipt and links it to an object via project_relationships. Returns linked | already_linked | no_active_research | no_focal_object | not_running.';
