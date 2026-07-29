/*
  Activity, audit and steering (docs/VERTICAL_SLICE_TASKS.md T8,
  docs/ADAPTIVE_CANVAS_MVP.md §11 E, SECURITY_STANDARDS §14).

  Three append-only tables:

  - `activity_events` records what the system actually did during a turn, so
    the activity a user saw can be retrieved later rather than existing only in
    a browser session.
  - `audit_events` records consequential events with an actor, an action, a
    target and a correlation id (SECURITY_STANDARDS §14.2). It is separate from
    activity because activity is a user-facing narration of real work, while
    audit is a security record — including work that was *rejected* and
    therefore never narrated.
  - `turn_directions` records mid-turn steering so "Add direction" has a
    durable record and the running turn can read it. Steering crosses two HTTP
    requests (the SSE stream and the direction POST), so the handover has to be
    storage, not process memory.

  Trust model. Append-only stops history being rewritten; it does not stop
  history being *fabricated*. All three tables are therefore written only by a
  trusted server-side writer holding an elevated key
  (SECURITY_STANDARDS §11.2: elevated keys in trusted server environments
  only). The browser-authenticated role can SELECT its own project's rows and
  has no INSERT, UPDATE or DELETE grant on any of them, so a user cannot mint
  activity that never happened, audit entries attributing actions to the
  system, or steering history.

  Vocabulary. `activity_events` stores a closed step enum rather than free
  text, so the words a user reads as "what the system is doing" cannot be
  chosen at the storage boundary at all — they are looked up from the
  application's catalogue on read.
*/

create type public.activity_kind as enum (
  'analysis',
  'research',
  'model_update',
  'document_update'
);

/*
  The closed set of operations the application can report. Adding a value here
  means adding a step the system genuinely performs; it is deliberately a
  migration rather than a string, so the vocabulary cannot drift.
*/
create type public.activity_step as enum (
  'reading_project_model',
  'considering_direction',
  'preparing_canvas_view'
);

/*
  Activity has a lifecycle: a step is reported when it starts and again when it
  stops, saying which of the two ways it stopped. A single "complete" state
  would claim success for work that failed, so ending and succeeding are
  separate facts.
*/
create type public.activity_state as enum ('active', 'succeeded', 'failed');

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- Correlates every line of a turn's observable work.
  turn_id uuid not null,
  /*
    Identifies one *invocation* of a step. The same operation can run more than
    once in a turn, so the reports are grouped by this rather than by step
    name — otherwise a repeat would overwrite its predecessor and history would
    quietly lose an operation that really happened.
  */
  operation_id uuid not null,
  step public.activity_step not null,
  state public.activity_state not null,
  created_at timestamptz not null default now()
);

create index activity_events_project_idx
  on public.activity_events (project_id, created_at desc);
create index activity_events_turn_idx on public.activity_events (turn_id);
create index activity_events_operation_idx
  on public.activity_events (operation_id);

/*
  Closed audit vocabulary. Deliberately small and specific: an enum forces a
  new action to be a deliberate migration rather than an arbitrary string, and
  keeps the audit history queryable.
*/
create type public.audit_action as enum (
  'turn_started',
  'turn_completed',
  'turn_failed',
  'direction_recorded',
  'direction_rejected',
  'scene_recommended',
  'scene_rejected',
  'object_edited',
  'scope_truncated'
);

create type public.audit_actor_kind as enum ('user', 'system');

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- Who caused the event. Model-proposed work is attributed to 'system'
  -- acting for this user, never to the user directly.
  actor_id uuid not null references auth.users (id) on delete cascade,
  actor_kind public.audit_actor_kind not null,
  action public.audit_action not null,
  -- What the action was about, in application terms (e.g. a renderer key).
  target text check (char_length(target) <= 200),
  correlation_id uuid not null,
  /*
    Small, structured context only — a rejection code, a renderer key, a count.
    Never message bodies, project prose or model reasoning
    (SECURITY_STANDARDS §14.1).
  */
  detail jsonb not null default '{}'::jsonb
    check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 2048),
  created_at timestamptz not null default now()
);

create index audit_events_project_idx
  on public.audit_events (project_id, created_at desc);
create index audit_events_correlation_idx
  on public.audit_events (correlation_id);

/*
  Operational turn state.

  Steering and recovery both need to know whether a turn is still running.
  That cannot be read from `audit_events`: audit writes are best-effort by
  design — a turn must not fail because its history could not be written — so a
  missing audit row would make a running turn look unknown and a lost terminal
  row would leave a finished turn looking permanently live.

  This table is the operational record instead: its writes are checked, a turn
  does not open its stream until the running row exists, and exactly one
  terminal state is written when the outcome is known. `audit_events` remains
  the append-only history; this is runtime truth.

  It is therefore not append-only: the terminal write updates the row in place,
  which is what makes "exactly one terminal state" enforceable rather than a
  convention.
*/
create type public.turn_run_state as enum ('running', 'completed', 'failed');

create table public.turn_runs (
  turn_id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  state public.turn_run_state not null default 'running',
  /*
    The steering window, which is not the same fact as "the turn has not
    finished yet". A turn stops being able to consume direction at its last
    direction boundary — before it persists its result and closes — so
    accepting direction on the strength of `state = 'running'` alone would
    promise a next step that no longer exists.
  */
  accepting_direction boolean not null default true,
  /*
    A lease, so a run whose worker died does not stay eligible for direction
    and being recovered for ever. Nothing renews it today because a scripted
    turn is seconds long; a real engine (T9) will need to.
  */
  lease_expires_at timestamptz not null default now() + interval '15 minutes',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  -- A terminal state has an end time and a running one does not; neither can
  -- drift from the other.
  constraint turn_runs_terminal_has_end
    check ((state = 'running') = (ended_at is null))
);

create index turn_runs_project_idx on public.turn_runs (project_id);

create type public.direction_application as enum (
  'applies_now',
  'next_step',
  'restart'
);

create table public.turn_directions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  turn_id uuid not null,
  note text not null check (char_length(note) between 1 and 1000),
  -- What the engine committed to doing with it, recorded at the moment the
  -- promise was made to the user (DESIGN.md §9.3).
  application public.direction_application not null,
  created_at timestamptz not null default now()
);

create index turn_directions_turn_idx
  on public.turn_directions (turn_id, created_at);

alter table public.turn_runs enable row level security;
alter table public.activity_events enable row level security;
alter table public.audit_events enable row level security;
alter table public.turn_directions enable row level security;

-- Read-only for the owner. There is no INSERT, UPDATE or DELETE policy for
-- `authenticated` on any of these tables, and no grant either, so a browser
-- session cannot write history under any circumstances.
create policy activity_events_select on public.activity_events
  for select to authenticated using (private.is_project_owner(project_id));

create policy audit_events_select on public.audit_events
  for select to authenticated using (private.is_project_owner(project_id));

create policy turn_directions_select on public.turn_directions
  for select to authenticated using (private.is_project_owner(project_id));

create policy turn_runs_select on public.turn_runs
  for select to authenticated using (private.is_project_owner(project_id));

grant select on public.activity_events to authenticated;
grant select on public.audit_events to authenticated;
grant select on public.turn_directions to authenticated;
grant select on public.turn_runs to authenticated;

/*
  The trusted writer. `service_role` bypasses RLS, so authorisation for these
  writes happens in the route that calls it: it authenticates the user and
  confirms project ownership through the user-scoped client *before* the
  trusted writer is used. The elevated key exists only in server environment
  variables and is reached through one module that exposes no general-purpose
  client (see src/lib/services/trusted-writer.ts).
*/
grant select, insert on public.activity_events to service_role;
grant select, insert on public.audit_events to service_role;
grant select, insert on public.turn_directions to service_role;
-- Operational state, not history: the terminal write updates the running row.
grant select, insert, update on public.turn_runs to service_role;

comment on table public.activity_events is
  'Observable work performed during a turn, as closed step + lifecycle state. Written only by the trusted server writer; readable by the project owner.';
comment on table public.audit_events is
  'Security and consequence record, including actions that were rejected. Append-only, trusted-writer only.';
/*
  Accepting a direction has to be one operation, not a status read followed by
  an insert. Between those two statements a turn can pass its last direction
  boundary, and the direction would then be accepted — and promised a next
  step — with nothing left to consume it.

  Taking the row lock first is what removes the window: a concurrent
  `take_turn_directions` either committed before this and has already sealed
  the window (so this refuses), or it waits and then sees the row this
  inserted.
*/
create or replace function public.accept_turn_direction(
  p_project_id uuid,
  p_turn_id uuid,
  p_note text,
  p_application public.direction_application
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.turn_runs%rowtype;
begin
  select * into run
  from public.turn_runs
  where turn_id = p_turn_id and project_id = p_project_id
  for update;

  if not found then
    return 'unknown';
  end if;
  if run.state <> 'running' then
    return 'finished';
  end if;
  if now() >= run.lease_expires_at then
    return 'expired';
  end if;
  if not run.accepting_direction then
    return 'closed';
  end if;

  insert into public.turn_directions (project_id, turn_id, note, application)
  values (p_project_id, p_turn_id, p_note, p_application);
  return 'accepted';
end;
$$;

/*
  Reads the directions a turn has not yet consumed, and — at the final
  boundary — seals the window in the same transaction, so nothing can be
  accepted after the last step that could apply it.
*/
create or replace function public.take_turn_directions(
  p_project_id uuid,
  p_turn_id uuid,
  p_after timestamptz,
  p_seal boolean
)
returns table (note text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.turn_runs
  where turn_id = p_turn_id and project_id = p_project_id
  for update;

  if p_seal then
    update public.turn_runs
    set accepting_direction = false
    where turn_id = p_turn_id and project_id = p_project_id;
  end if;

  return query
    select d.note, d.created_at
    from public.turn_directions d
    where d.turn_id = p_turn_id
      and d.project_id = p_project_id
      and d.created_at > p_after
    order by d.created_at
    limit 10;
end;
$$;

/*
  One snapshot of what a turn amounts to.

  Reading the state and the result as separate requests can assemble a
  combination that never existed: the result read misses the insert, the state
  read then sees `completed`, and the caller concludes the turn finished with
  nothing. A single statement sees one snapshot, so `completed` and its result
  arrive together or not at all.

  A running turn whose lease has expired reports `expired`: its worker is gone,
  so "still being processed" would be false.
*/
create or replace function public.turn_snapshot(
  p_project_id uuid,
  p_turn_id uuid
)
returns table (
  state text,
  message_id uuid,
  message_content text,
  message_created_at timestamptz
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
    m.created_at
  from public.turn_runs r
  left join public.messages m
    on m.turn_id = r.turn_id
   and m.project_id = r.project_id
   and m.role = 'assistant'
  where r.turn_id = p_turn_id
    and r.project_id = p_project_id
    and private.is_project_owner(r.project_id);
$$;

revoke all on function public.accept_turn_direction(uuid, uuid, text, public.direction_application) from public;
revoke all on function public.take_turn_directions(uuid, uuid, timestamptz, boolean) from public;
revoke all on function public.turn_snapshot(uuid, uuid) from public;

-- Steering is written only by the trusted server writer; the snapshot is read
-- by the owner, and checks ownership itself because it is security definer.
grant execute on function public.accept_turn_direction(uuid, uuid, text, public.direction_application) to service_role;
grant execute on function public.take_turn_directions(uuid, uuid, timestamptz, boolean) to service_role;
grant execute on function public.turn_snapshot(uuid, uuid) to authenticated;

comment on table public.turn_runs is
  'Operational state of a turn: whether it is still running. Written by the trusted server writer with checked results, because steering and recovery depend on it.';
comment on table public.turn_directions is
  'Mid-turn steering, with the application mode promised to the user when it was accepted.';
