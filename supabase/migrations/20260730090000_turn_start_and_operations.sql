/*
  Two atomic boundaries the application could not enforce on its own, plus the
  provenance a claim of "the person said this" has to carry to be checkable.

  Both functions exist because the guarantees they provide are *transactional*.
  A sequence of statements from the application cannot promise all-or-none, and
  a check followed by a write cannot promise the checked state still holds.

  Both are `security definer` and granted to `service_role` alone, which means
  neither can rely on Row-Level Security to decide who is allowed in. So each one
  authorises its own caller against `p_actor_id` before it writes anything: the
  actor must own the project. That check is inside the transaction, so it cannot
  be skipped by a caller that forgot, and it does not depend on the route having
  read the project first (SECURITY_STANDARDS §11.2 — an elevated path must carry
  its own authorisation, not inherit one).
*/

/*
  Confirms the acting user owns the project, or raises.

  Shared by both functions below so the rule reads the same way in each, and so
  a new elevated entry point cannot accidentally omit it.
*/
create or replace function private.assert_project_actor(
  p_project_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor_id is null or not exists (
    select 1 from public.projects
    where id = p_project_id and owner_id = p_actor_id
  ) then
    -- Deliberately uniform: a project that does not exist and one owned by
    -- somebody else raise the same thing, so nothing about existence leaks.
    raise exception 'not_project_owner'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke all on function private.assert_project_actor(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- Provenance, persisted
-- ---------------------------------------------------------------------------

/*
  Where a user-stated claim came from.

  Origin alone is an assertion; origin plus the turn it came from and the exact
  words that were verified is a record someone can audit. Without these, a row
  marked `user_stated` cannot be distinguished after the fact from one marked
  that way in error — which is the whole distinction the product rests on.

  Nullable because `ai_inferred` rows legitimately have no source, and rows that
  predate this migration have none either.
*/
alter table public.project_fields
  add column if not exists source_turn_id uuid,
  add column if not exists source_excerpt text
    check (source_excerpt is null or char_length(source_excerpt) between 8 and 500);

alter table public.assumptions
  add column if not exists source_turn_id uuid,
  add column if not exists source_excerpt text
    check (source_excerpt is null or char_length(source_excerpt) between 8 and 500);

/*
  Deliberately *not* a table constraint.

  "A user-stated row must carry a verified excerpt" is true of rows a turn
  proposes and false of rows the person wrote themselves: a direct edit through
  the object editor is user-stated with no message to quote, because the source
  is the edit. A check constraint cannot tell those apart and forbidding the
  second would break the editing path T7 exists to provide.

  The rule therefore lives in `apply_turn_operations` below, which is the only
  route by which an untrusted proposal can claim that origin.
*/

comment on column public.project_fields.source_excerpt is
  'The exact verified words from the source message. Present iff origin is user_stated.';

-- ---------------------------------------------------------------------------
-- Starting a turn
-- ---------------------------------------------------------------------------

/*
  Opening a turn, as one operation.

  Three separate problems, one fix:

  1. **A dead worker used to block the project for ever.** The
     one-running-turn index tests `state = 'running'`, and an expired lease does
     not change the stored state — it only changes how the snapshot *reads* it.
     So a run whose worker died stayed `running`, kept the project's only slot,
     and every later turn was rejected as "already running" while steering and
     recovery correctly reported that same turn as dead. Reconciling the expired
     row is therefore part of starting a turn, not a separate cleanup somebody
     has to remember to run.

  2. **A rejected start used to leave an orphan message.** The route saved the
     user's message and *then* tried to open the run, so a conflict left a
     message with no run and no answer — and the client, restoring the draft on
     any non-OK response, produced a duplicate on retry. The message is now
     written in the same transaction as the run: either both exist or neither
     does.

  3. **Two clients could both open a turn.** The lock below serialises them, so
     the loser sees the winner's committed row.
*/
create or replace function public.start_turn(
  p_project_id uuid,
  p_turn_id uuid,
  p_actor_id uuid,
  p_content text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  live_runs integer;
  violated text;
begin
  perform private.assert_project_actor(p_project_id, p_actor_id);

  /*
    Serialise starts for this project on a row that always exists.

    Locking the *running turn_runs rows* is not enough and was the bug: when
    there is no running row there is nothing to lock, so two callers both got
    past the count below and both inserted — the second failing on the unique
    index with a duplicate-key error instead of a civil "already running". The
    project row is the thing every start has in common, so it is what they
    queue on.
  */
  perform 1 from public.projects where id = p_project_id for update;

  /*
    Close any run whose worker is gone, now that this caller holds the project.
  */
  perform 1
  from public.turn_runs
  where project_id = p_project_id and state = 'running'
  for update;

  update public.turn_runs
  set state = 'failed',
      accepting_direction = false,
      ended_at = now()
  where project_id = p_project_id
    and state = 'running'
    and now() >= lease_expires_at;

  select count(*) into live_runs
  from public.turn_runs
  where project_id = p_project_id and state = 'running';

  if live_runs > 0 then
    -- Nothing is written: no run, and no message either.
    return 'already_running';
  end if;

  /*
    Both writes in one subtransaction, so the index is a backstop rather than a
    way to half-start a turn. If a concurrent start still wins the slot — the
    lock above should prevent it, and a guarantee resting on "should" is not one
    — the exception rolls back the message as well, and this caller gets the
    same civil answer it would have got from the count.
  */
  begin
    insert into public.messages (project_id, turn_id, role, content)
    values (p_project_id, p_turn_id, 'user', p_content);

    insert into public.turn_runs (turn_id, project_id, state)
    values (p_turn_id, p_project_id, 'running');
  exception
    when unique_violation then
      get stacked diagnostics violated = constraint_name;
      -- Only the concurrency index means "already running". Anything else — a
      -- reused turn id, say — is a fault and must not be disguised as one.
      if violated = 'turn_runs_one_running_per_project' then
        return 'already_running';
      end if;
      raise;
  end;

  return 'started';
end;
$$;

revoke all on function public.start_turn(uuid, uuid, uuid, text) from public;
grant execute on function public.start_turn(uuid, uuid, uuid, text) to service_role;

comment on function public.start_turn(uuid, uuid, uuid, text) is
  'Reconciles an expired run, then opens a turn and saves its message atomically. Returns started | already_running.';


-- ---------------------------------------------------------------------------
-- Ending a turn
-- ---------------------------------------------------------------------------

/*
  Everything a successful turn changes, in one transaction: the answer, the
  project-truth writes it produced, and the turn's terminal state.

  Ordering these as three separate durable writes was not enough, and the reason
  is worth stating plainly. Catch-up treats a stored assistant message as
  settlement — "a stored result settles it, whatever the state says" — so a
  worker that died after the message was inserted but before the operations
  committed left a turn that *reads* as completed while every field and
  assumption belonging to it had been lost. There is no ordering of separate
  writes that fixes that; the three have to be one commit.

  Refusals are not failures. A field the person owns is expected to be refused,
  and raising would throw away an answer the user is entitled to keep — so
  per-row refusals are collected and reported, while genuine faults still abort
  the whole thing. Two protections live here rather than in application code,
  because both depend on state that can change between a read and a write:

  - **User-owned wording is not replaced automatically.** Checked under the
    row's own lock, so a concurrent user edit cannot slip in between the check
    and the upsert.
  - **A user-stated origin is never downgraded.** An automatic update that
    revises a label or support state must not quietly rewrite a row the person
    owns into an inference, which is what happens if origin is supplied
    unconditionally.

  Each staged row carries the `slot` of the operation that produced it, so the
  caller can report and audit per operation what the database actually did with
  it rather than inferring from a total.

  Returns one of:
    { outcome: 'completed', written: {slot: n}, refused: {slot: [code]} }
    { outcome: 'not_running' }  -- nothing written at all
*/
create or replace function public.complete_turn(
  p_project_id uuid,
  p_turn_id uuid,
  p_actor_id uuid,
  p_assistant_text text,
  p_fields jsonb,
  p_assumptions jsonb
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
begin
  perform private.assert_project_actor(p_project_id, p_actor_id);

  /*
    The run must still be this turn's to finish. A turn whose lease lapsed may
    already have been reconciled and reported to the user as unfinished, and
    recovery's verdict is not something a late worker may overwrite — so nothing
    is written and the caller is told why.
  */
  perform 1
  from public.turn_runs
  where turn_id = p_turn_id and project_id = p_project_id and state = 'running'
  for update;

  if not found then
    return jsonb_build_object('outcome', 'not_running');
  end if;

  /*
    The assistant row is keyed by the turn id, so the message the client watched
    arrive and the message catch-up returns are the same message.
  */
  insert into public.messages (id, project_id, turn_id, role, content)
  values (p_turn_id, p_project_id, p_turn_id, 'assistant', p_assistant_text);

  for item in select * from jsonb_array_elements(coalesce(p_fields, '[]'::jsonb))
  loop
    slot := coalesce(item ->> 'slot', '0');

    /*
      A proposal claiming the person said something must carry the words that
      were verified. This is an application invariant rather than a refusal —
      origin is *derived* from the excerpt, so the two cannot disagree unless
      the caller is broken — which is why it aborts rather than being collected.
    */
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
      -- Refused, not applied: changing a person's own wording is a proposal for
      -- them to approve, not something a turn does on its own.
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
        /*
          Preserve a user-stated origin and its source. The incoming row may
          legitimately revise a label or support state, but an automatic update
          must never turn the person's own words into the model's inference.
        */
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
    Closing the run is part of the same commit. Constrained to a still-running
    row, so a second terminal write cannot overwrite the first.
  */
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

revoke all on function public.complete_turn(uuid, uuid, uuid, text, jsonb, jsonb)
  from public;
grant execute on function public.complete_turn(uuid, uuid, uuid, text, jsonb, jsonb)
  to service_role;

comment on function public.complete_turn(uuid, uuid, uuid, text, jsonb, jsonb) is
  'Stores a turn''s answer, applies its project-truth writes and closes the run, in one transaction. Returns completed | not_running with per-slot written and refused counts.';
