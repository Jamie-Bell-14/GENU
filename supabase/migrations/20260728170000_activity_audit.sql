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
comment on table public.turn_runs is
  'Operational state of a turn: whether it is still running. Written by the trusted server writer with checked results, because steering and recovery depend on it.';
comment on table public.turn_directions is
  'Mid-turn steering, with the application mode promised to the user when it was accepted.';
