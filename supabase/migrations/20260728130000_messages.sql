-- Conversation messages and per-user rate limiting.
-- Messages are project-owned: authorised through private.is_project_owner()
-- (SECURITY_STANDARDS §6 — nested resources authorise through their parent).

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  turn_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 8000),
  created_at timestamptz not null default now()
);

create index messages_project_created_idx
  on public.messages (project_id, created_at);
create index messages_turn_idx on public.messages (turn_id);

alter table public.messages enable row level security;

-- Messages are conversation history: append-only. No UPDATE or DELETE policy
-- exists, so history cannot be rewritten by ordinary users; cascade from a
-- deleted project remains the only removal path.
create policy messages_select_own_project on public.messages
  for select to authenticated
  using (private.is_project_owner(project_id));

create policy messages_insert_own_project on public.messages
  for insert to authenticated
  with check (private.is_project_owner(project_id));

grant select, insert on public.messages to authenticated;

-- Sliding-window rate limiting (SECURITY_STANDARDS §17). Postgres-backed so
-- the slice needs no extra infrastructure; the interface stays swappable.
create table public.rate_limit_events (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now()
);

create index rate_limit_events_lookup_idx
  on public.rate_limit_events (user_id, action, created_at desc);

alter table public.rate_limit_events enable row level security;
-- No policies: only the definer function below may read or write this table.

/*
  Records an attempt and reports whether it is allowed. Runs as definer so
  callers cannot read or forge other users' counters; the actor is always
  taken from the verified session, never from a parameter.
*/
create or replace function public.check_rate_limit(
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_count integer;
  v_oldest timestamptz;
begin
  if v_user is null then
    raise exception 'authentication required';
  end if;
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit configuration';
  end if;

  delete from public.rate_limit_events
  where created_at < now() - make_interval(secs => p_window_seconds * 10);

  select count(*), min(created_at)
    into v_count, v_oldest
  from public.rate_limit_events
  where user_id = v_user
    and action = p_action
    and created_at > now() - make_interval(secs => p_window_seconds);

  if v_count >= p_limit then
    return query
      select false,
             greatest(
               1,
               ceil(
                 extract(
                   epoch from
                     (v_oldest + make_interval(secs => p_window_seconds)) - now()
                 )
               )::integer
             );
    return;
  end if;

  insert into public.rate_limit_events (user_id, action) values (v_user, p_action);
  return query select true, 0;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public;
grant execute on function public.check_rate_limit(text, integer, integer) to authenticated;
