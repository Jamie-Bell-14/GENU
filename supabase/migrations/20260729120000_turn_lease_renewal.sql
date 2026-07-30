/*
  Lease renewal for long-running turns (issue #11).

  `turn_runs.lease_expires_at` bounds how long a run stays eligible for
  steering and recovery when its worker has died. A fixed 15-minute lease was
  enough for the scripted engine, whose turns last seconds. A real model turn
  can legitimately outlive it, and would then be reported as expired — steering
  refused, the turn declared unfinished — while its worker was still working.

  So the live worker renews the lease as it goes. The renewal is deliberately
  narrow: it extends a lease, and it can do nothing else.
*/

create or replace function private.max_lease_extension_seconds()
returns integer language sql immutable set search_path = '' as $$ select 900 $$;

/*
  Extends a running turn's lease.

  Three conditions, and each one closes a specific hole:

  - the row is locked before it is read, so a heartbeat and a terminal write
    cannot interleave. Without the lock, `closeTurnRun` could commit between
    this function's read and its update, and the update would then reopen a
    lease on a finished turn.
  - the state must still be `running`. A completed or failed turn has an
    outcome, and an outcome is not something a heartbeat may revise.
  - the lease must not have expired *already*. This is the one that stops a
    late heartbeat resurrecting a run that has been declared dead: once the
    lease lapses, recovery may have concluded the turn was unfinished and told
    the user so, and reopening the window would contradict a verdict the user
    has already seen.

  The extension is capped so a caller cannot lease a run indefinitely in one
  call — the bound has to survive a bad argument, not just a well-behaved one.

  The third condition has to be checked against `clock_timestamp()`, not
  `now()`. `now()` is `transaction_timestamp()` — fixed once at the start of the
  transaction and unchanged by anything that happens afterwards, including
  time spent blocked on the `for update` lock above. A caller whose transaction
  began a moment before the lease expired, then waited on that lock until after
  it did, would still carry a pre-expiry `now()` and could renew — or, in
  `complete_turn` below, complete — a lease that had already lapsed by the time
  it actually acquired the row. `clock_timestamp()` is captured once the lock is
  held, so the comparison is against the moment this call actually got to act,
  not the moment it started waiting.
*/
create or replace function public.renew_turn_lease(
  p_turn_id uuid,
  p_seconds integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.turn_runs%rowtype;
  extension integer;
  checked_at timestamptz;
begin
  extension := least(
    greatest(coalesce(p_seconds, 0), 1),
    private.max_lease_extension_seconds()
  );

  select * into run
  from public.turn_runs
  where turn_id = p_turn_id
  for update;

  -- Captured only now: after the lock is held, so a wait crossing the expiry
  -- boundary is reflected rather than masked by a stale transaction start time.
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

  /*
    Extend, never replace. `checked_at + extension` alone is a *reduction*
    whenever the requested TTL is shorter than what the lease already has: a
    60-second heartbeat against a fresh 15-minute lease would cut it to 60
    seconds, so the mechanism meant to keep long turns alive would be the thing
    killing them. `greatest` makes renewal monotonic — a lease can only ever
    move later, so no renewal, however small, can bring a run's death forward.
  */
  update public.turn_runs
  set lease_expires_at = greatest(
    run.lease_expires_at,
    checked_at + make_interval(secs => extension)
  )
  where turn_id = p_turn_id;

  return 'renewed';
end;
$$;

revoke all on function public.renew_turn_lease(uuid, integer) from public;
-- Only the trusted server writer renews a lease. A browser session extending
-- the life of its own turn would defeat the point of having one.
grant execute on function public.renew_turn_lease(uuid, integer) to service_role;

comment on function public.renew_turn_lease(uuid, integer) is
  'Extends a running turn lease under a row lock. Never revives a finished or already-expired run.';

/*
  Two more audited actions, for the live engine's structured operations (T9).

  The vocabulary stays closed and each addition stays a deliberate migration.
  `operation_rejected` matters as much as `operation_applied`: a proposal the
  application refused is precisely the kind of event worth having a record of,
  and an audit trail that only records successes cannot show that a boundary
  did its job.
*/
alter type public.audit_action add value if not exists 'operation_applied';
alter type public.audit_action add value if not exists 'operation_rejected';

/*
  One running turn per project, enforced by the database (T9 edge case:
  "concurrent turns blocked").

  A guard in React protects one mounted runtime and nothing else. Two tabs, a
  reload mid-turn, or two direct requests each insert their own running row,
  and the project then has two turns steering and recovering independently —
  with `loadProjectContext` unable to tell which message belongs to which.

  A partial unique index is the whole mechanism: it is evaluated inside the
  same transaction as the insert, so there is no window between checking and
  opening. `openTurnRun` reads the resulting conflict as "another turn is
  already running" and the route answers with a safe conflict rather than
  starting a second stream.
*/
create unique index turn_runs_one_running_per_project
  on public.turn_runs (project_id)
  where state = 'running';

comment on index public.turn_runs_one_running_per_project is
  'At most one running turn per project. Enforced here so two clients cannot both open one.';
