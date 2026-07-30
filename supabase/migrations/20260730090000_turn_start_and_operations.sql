/*
  Two atomic boundaries the application could not enforce on its own, plus the
  provenance a claim of "the person said this" has to carry to be checkable.

  Both functions exist because the guarantees they provide are *transactional*.
  A sequence of statements from the application cannot promise all-or-none, and
  a check followed by a write cannot promise the checked state still holds.
*/

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

revoke all on function public.start_turn(uuid, uuid, text) from public;
grant execute on function public.start_turn(uuid, uuid, text) to service_role;

comment on function public.start_turn(uuid, uuid, text) is
  'Reconciles an expired run, then opens a turn and saves its message atomically. Returns started | already_running.';

-- ---------------------------------------------------------------------------
-- Committing a turn's project-truth operations
-- ---------------------------------------------------------------------------

/*
  Applies every project-truth operation a successful turn produced, or none.

  The application used to loop and apply them one at a time, which is not what
  "committed as one unit" means: field A could land and assumption B fail,
  leaving the project half-changed by a turn reported as failed. A single
  function call is one transaction, so the set is genuinely all-or-none.

  Two protections live here rather than in application code, because both
  depend on state that can change between a read and a write:

  - **User-owned wording is not replaced automatically.** Checked under the
    row's own lock, so a concurrent user edit cannot slip in between the check
    and the upsert.
  - **A user-stated origin is never downgraded.** An automatic update that
    revises a label or support state must not quietly rewrite a row the person
    owns into an inference, which is what happens if origin is supplied
    unconditionally.

  Anything refused raises, so the caller gets no partial write to reconcile.
*/
create or replace function public.apply_turn_operations(
  p_project_id uuid,
  p_turn_id uuid,
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
  current record;
  fields_written integer := 0;
  assumptions_written integer := 0;
begin
  for item in select * from jsonb_array_elements(coalesce(p_fields, '[]'::jsonb))
  loop
    select origin, value, source_turn_id, source_excerpt
      into current
    from public.project_fields
    where project_id = p_project_id
      and area = (item ->> 'area')::public.project_area
      and key = item ->> 'key'
    for update;

    if found and current.origin = 'user_stated'
       and current.value <> (item ->> 'value') then
      raise exception
        'user_owned_field:%/%', item ->> 'area', item ->> 'key'
        using errcode = 'check_violation';
    end if;

    /*
      A proposal claiming the person said something must carry the words that
      were verified. Checked here rather than as a table constraint because a
      direct user edit is legitimately user-stated with nothing to quote.
    */
    if (item ->> 'origin') = 'user_stated'
       and (item ->> 'source_excerpt') is null then
      raise exception 'unsourced_user_stated:%/%',
        item ->> 'area', item ->> 'key'
        using errcode = 'check_violation';
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

    fields_written := fields_written + 1;
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p_assumptions, '[]'::jsonb))
  loop
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
    assumptions_written := assumptions_written + 1;
  end loop;

  return jsonb_build_object(
    'fields', fields_written,
    'assumptions', assumptions_written
  );
end;
$$;

revoke all on function public.apply_turn_operations(uuid, uuid, jsonb, jsonb) from public;
grant execute on function public.apply_turn_operations(uuid, uuid, jsonb, jsonb) to service_role;

comment on function public.apply_turn_operations(uuid, uuid, jsonb, jsonb) is
  'Applies a turn''s staged field and assumption writes in one transaction, or none. Protects user-stated rows under lock.';
