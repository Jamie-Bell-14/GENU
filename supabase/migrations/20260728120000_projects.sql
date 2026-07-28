-- Projects: the root user-owned resource. Every child table authorises
-- through private.is_project_owner(). RLS is enabled in the same migration
-- that creates the table (SECURITY_STANDARDS §7.1) and there is no window
-- where the table exists unprotected.

-- Non-exposed schema for privileged helper functions used by policies.
create schema if not exists private;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_owner_id_idx on public.projects (owner_id);

-- Ownership helper for child-table policies (stable, definer, non-exposed).
create or replace function private.is_project_owner(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.owner_id = (select auth.uid())
  );
$$;

revoke all on function private.is_project_owner(uuid) from public;
-- Child-table policies execute this as the querying role, so the API role
-- needs usage on the schema and execute on the helper — and nothing else.
grant usage on schema private to authenticated;
grant execute on function private.is_project_owner(uuid) to authenticated;

-- updated_at maintenance.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function private.set_updated_at();

-- Ownership is immutable: reassignment is a high-risk operation that does
-- not exist as a feature (SECURITY_STANDARDS §7.1).
create or replace function private.reject_owner_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'project ownership cannot be changed';
  end if;
  return new;
end;
$$;

create trigger projects_owner_immutable
  before update on public.projects
  for each row execute function private.reject_owner_change();

-- Row-Level Security: deny by default, explicit per-command owner policies.
alter table public.projects enable row level security;

create policy projects_select_own on public.projects
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy projects_insert_own on public.projects
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy projects_update_own on public.projects
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy projects_delete_own on public.projects
  for delete to authenticated
  using (owner_id = (select auth.uid()));

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
