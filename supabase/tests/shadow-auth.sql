-- Minimal shadow of the Supabase auth environment for RLS testing against
-- plain Postgres (local dev and CI service containers). Mirrors the parts
-- our policies depend on: auth.users, auth.uid(), and the authenticated/anon
-- roles. Never applied to a real Supabase project.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text unique
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    ''
  )::uuid
$$;

/*
  Every RLS test file runs this script, in parallel Vitest workers, each
  against its own freshly created database — but Postgres roles are
  cluster-wide, not per-database, so the three roles below are shared state
  across every one of those concurrent connections. The `if not exists`
  checks are not atomic with the `create role` that follows: two workers can
  both see "does not exist" before either has created it, then both attempt
  the create, and the loser gets a raw unique-violation on
  pg_authid_rolname_index instead of the idempotent no-op this script means
  to be. The advisory lock below serialises just this critical section —
  everything else about each worker's run (its own database, its own
  migrations) stays fully parallel.
*/
select pg_advisory_lock(727215);

do $$
begin
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  -- Supabase's elevated API role. It bypasses RLS there, so the shadow must
  -- too, or a test could pass here and fail in production.
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

select pg_advisory_unlock(727215);

-- Supabase grants these to its API roles; our policies call auth.uid().
grant usage on schema auth to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
