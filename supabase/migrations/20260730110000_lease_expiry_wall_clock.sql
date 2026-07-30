/*
  Lease-expiry checks made against the actual moment they run, not the moment
  their transaction started (GPT re-review of PR #12, round 5).

  `now()` in PostgreSQL is `transaction_timestamp()`: fixed once when a
  transaction begins and unchanged by anything that happens inside it,
  including time spent blocked on a row lock. Every function on this branch
  that checks `now() >= lease_expires_at` takes that lock first (`for update`)
  precisely so a heartbeat and a terminal write cannot interleave — but that
  means a caller whose transaction began a moment *before* the lease expired,
  then waited on the lock until *after* it did, would still carry a pre-expiry
  `now()` when it finally got to check. It could then renew, accept a
  direction into, or (worse) complete a lease that had, by wall-clock time,
  already lapsed and possibly already been reported to the user as expired.

  `clock_timestamp()` returns the actual current time regardless of where a
  transaction is in its life, so it is what every one of these checks needs:
  captured once the lock is held, compared against the row read under that
  same lock.

  `renew_turn_lease` and `complete_turn` were fixed in place because their
  migration has not shipped yet (`20260729120000_turn_lease_renewal.sql`,
  `20260730090000_turn_start_and_operations.sql`, both introduced by this same
  PR). `accept_turn_direction` already shipped in a merged migration
  (`20260728170000_activity_audit.sql`), so it is corrected here instead,
  forward-only, with the same signature.
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
  existing integer;
  checked_at timestamptz;
begin
  select * into run
  from public.turn_runs
  where turn_id = p_turn_id and project_id = p_project_id
  for update;

  -- Captured only after the lock above is held; see the migration header.
  checked_at := clock_timestamp();

  if not found then
    return 'unknown';
  end if;
  if run.state <> 'running' then
    return 'finished';
  end if;
  if checked_at >= run.lease_expires_at then
    return 'expired';
  end if;
  if not run.accepting_direction then
    return 'closed';
  end if;

  select count(*) into existing
  from public.turn_directions
  where turn_id = p_turn_id and project_id = p_project_id;
  if existing >= private.max_directions_per_turn() then
    -- Refused before a promise is made, rather than accepted and stranded.
    return 'too_many';
  end if;

  insert into public.turn_directions (project_id, turn_id, note, application)
  values (p_project_id, p_turn_id, p_note, p_application);
  return 'accepted';
end;
$$;

comment on function public.accept_turn_direction(
  uuid, uuid, text, public.direction_application
) is
  'Accepts a direction into a turn''s steering window under a row lock, checking lease expiry against clock_timestamp() rather than the transaction''s fixed now().';
