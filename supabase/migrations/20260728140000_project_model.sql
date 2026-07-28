-- Project model: the structured memory the canvas visualises.
-- Confidence is qualitative throughout (PROJECT_PLAN.md §4): support states,
-- never numeric scores.

create type public.project_area as enum (
  'problem',
  'customer',
  'value_proposition',
  'mvp_scope'
);

create type public.field_origin as enum (
  'user_stated',
  'ai_inferred',
  'researched'
);

create type public.support_state as enum (
  'unexplored',
  'hypothesis',
  'some_evidence',
  'credible',
  'strongly_evidenced',
  'contradicted'
);

create table public.project_fields (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  area public.project_area not null,
  key text not null check (char_length(key) between 1 and 64),
  label text not null check (char_length(label) between 1 and 200),
  value text not null check (char_length(value) <= 2000),
  origin public.field_origin not null,
  support public.support_state not null default 'unexplored',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, area, key)
);

create index project_fields_project_idx on public.project_fields (project_id);

create trigger project_fields_set_updated_at
  before update on public.project_fields
  for each row execute function private.set_updated_at();

create type public.assumption_status as enum (
  'open',
  'supported',
  'weakened',
  'invalidated'
);

create table public.assumptions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  statement text not null check (char_length(statement) between 1 and 1000),
  why_it_matters text check (char_length(why_it_matters) <= 1000),
  alternatives jsonb not null default '[]'::jsonb,
  status public.assumption_status not null default 'open',
  -- Only material assumptions interrupt the user (DESIGN.md §2.2).
  importance text not null default 'material'
    check (importance in ('low', 'material')),
  origin public.field_origin not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assumptions_project_idx on public.assumptions (project_id);

create trigger assumptions_set_updated_at
  before update on public.assumptions
  for each row execute function private.set_updated_at();

-- Row-Level Security: authorised through the parent project.
alter table public.project_fields enable row level security;
alter table public.assumptions enable row level security;

create policy project_fields_select on public.project_fields
  for select to authenticated using (private.is_project_owner(project_id));
create policy project_fields_insert on public.project_fields
  for insert to authenticated with check (private.is_project_owner(project_id));
create policy project_fields_update on public.project_fields
  for update to authenticated
  using (private.is_project_owner(project_id))
  with check (private.is_project_owner(project_id));
create policy project_fields_delete on public.project_fields
  for delete to authenticated using (private.is_project_owner(project_id));

create policy assumptions_select on public.assumptions
  for select to authenticated using (private.is_project_owner(project_id));
create policy assumptions_insert on public.assumptions
  for insert to authenticated with check (private.is_project_owner(project_id));
create policy assumptions_update on public.assumptions
  for update to authenticated
  using (private.is_project_owner(project_id))
  with check (private.is_project_owner(project_id));
create policy assumptions_delete on public.assumptions
  for delete to authenticated using (private.is_project_owner(project_id));

grant select, insert, update, delete on public.project_fields to authenticated;
grant select, insert, update, delete on public.assumptions to authenticated;
