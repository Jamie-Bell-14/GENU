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

  None of the three has an UPDATE or DELETE policy: history is not editable by
  ordinary users (SECURITY_STANDARDS §14.2).
*/

create type public.activity_kind as enum (
  'analysis',
  'research',
  'model_update',
  'document_update'
);

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- Correlates every line of a turn's observable work.
  turn_id uuid not null,
  kind public.activity_kind not null,
  -- Application-authored label describing a real operation. Never model prose
  -- (docs/ARCHITECTURE.md §8); the length bound reflects a single UI line.
  label text not null check (char_length(label) between 1 and 200),
  created_at timestamptz not null default now()
);

create index activity_events_project_idx
  on public.activity_events (project_id, created_at desc);
create index activity_events_turn_idx on public.activity_events (turn_id);

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
  'scene_recommended',
  'scene_rejected'
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

alter table public.activity_events enable row level security;
alter table public.audit_events enable row level security;
alter table public.turn_directions enable row level security;

create policy activity_events_select on public.activity_events
  for select to authenticated using (private.is_project_owner(project_id));
create policy activity_events_insert on public.activity_events
  for insert to authenticated with check (private.is_project_owner(project_id));

create policy audit_events_select on public.audit_events
  for select to authenticated using (private.is_project_owner(project_id));
-- An audit row must name the acting user; nobody can write history as
-- somebody else, and nobody can write into another user's project.
create policy audit_events_insert on public.audit_events
  for insert to authenticated
  with check (private.is_project_owner(project_id) and actor_id = auth.uid());

create policy turn_directions_select on public.turn_directions
  for select to authenticated using (private.is_project_owner(project_id));
create policy turn_directions_insert on public.turn_directions
  for insert to authenticated with check (private.is_project_owner(project_id));

-- Insert and select only: no grant exists for UPDATE or DELETE, so append-only
-- is enforced by privilege as well as by the absent policies.
grant select, insert on public.activity_events to authenticated;
grant select, insert on public.audit_events to authenticated;
grant select, insert on public.turn_directions to authenticated;

comment on table public.activity_events is
  'Observable work performed during a turn. Labels are application-authored and describe real operations.';
comment on table public.audit_events is
  'Security and consequence record, including actions that were rejected. Append-only.';
comment on table public.turn_directions is
  'Mid-turn steering, with the application mode promised to the user when it was accepted.';
