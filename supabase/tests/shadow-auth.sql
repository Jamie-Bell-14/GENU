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

-- Supabase grants these to its API roles; our policies call auth.uid().
grant usage on schema auth to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
