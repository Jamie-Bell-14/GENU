import type { LeaseRenewal } from "@/lib/services/trusted-writer";
import { LEASE_HEARTBEAT_MS } from "./engine-config";

/**
 * Keeps a running turn's lease alive while its worker is alive (issue #11).
 *
 * The lease answers one question — "is anyone still working on this?" — and a
 * heartbeat is the only honest way to answer it. A turn that simply takes a
 * long time is indistinguishable, from the outside, from one whose worker died
 * ten minutes ago; the difference is whether something is still saying so.
 *
 * Two failure directions matter and they are not symmetric. Renewing a run
 * whose worker is gone strands it as steerable and recoverable for ever, which
 * is the bound the lease exists to enforce. Failing to renew a healthy run
 * ends it early, which loses work but leaves the system truthful. So the
 * heartbeat is generous with the second and refuses the first outright: it
 * tolerates transient renewal failures, and it stops the moment the database
 * says this run is no longer ours to extend.
 */

export type HeartbeatLoss =
  /** The database refused: the run is finished, expired or absent. */
  | "run_not_renewable"
  /** Renewal kept failing; the lease can no longer be vouched for. */
  | "renewal_failing";

export interface HeartbeatPorts {
  renew(seconds: number): Promise<LeaseRenewal>;
  /**
   * Called once when the lease can no longer be maintained. The host stops the
   * turn: producing a result that cannot be recorded against a live run is
   * work nobody will receive, and the user may already have been told the turn
   * did not finish.
   */
  onLost(reason: HeartbeatLoss): void;
  /** Injectable for tests; defaults to the real timer. */
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

/**
 * Consecutive renewal failures tolerated before the worker gives up.
 *
 * Three, at a minute apart, against a fifteen-minute lease: a transient
 * database blip does not end a healthy turn, and the run still expires on its
 * own well before anything could pretend otherwise.
 */
export const MAX_CONSECUTIVE_RENEWAL_FAILURES = 3;

export interface Heartbeat {
  stop(): void;
  /** Consecutive failures right now; for tests and diagnostics. */
  readonly failures: number;
}

export function startLeaseHeartbeat(
  ports: HeartbeatPorts,
  intervalMs: number = LEASE_HEARTBEAT_MS,
): Heartbeat {
  const setTimer =
    ports.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer =
    ports.clearTimer ??
    ((handle: unknown) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>));

  let stopped = false;
  let failures = 0;
  let handle: unknown = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (handle !== null) clearTimer(handle);
    handle = null;
  };

  const lose = (reason: HeartbeatLoss) => {
    stop();
    ports.onLost(reason);
  };

  const beat = async () => {
    if (stopped) return;
    /*
      Ask for more than one interval's worth. A renewal that is late — a slow
      query, a delayed timer — must not leave a gap in which the lease lapses
      and the run is declared dead while the worker is mid-sentence.
    */
    const seconds = Math.ceil((intervalMs * 3) / 1000);
    let outcome: LeaseRenewal;
    try {
      outcome = await ports.renew(seconds);
    } catch {
      outcome = "unavailable";
    }
    // The turn may have finished while the renewal was in flight; whatever it
    // returned is then irrelevant and must not restart the timer.
    if (stopped) return;

    if (outcome === "renewed") {
      failures = 0;
      schedule();
      return;
    }

    if (outcome === "unavailable") {
      failures += 1;
      // Logged every time, not only at the threshold: repeated renewal failure
      // is an operational signal in its own right, and a turn that recovers
      // after two failures would otherwise leave no trace that it nearly died.
      console.error("turn lease renewal failed", { failures });
      if (failures >= MAX_CONSECUTIVE_RENEWAL_FAILURES) {
        return lose("renewal_failing");
      }
      schedule();
      return;
    }

    /*
      `finished`, `expired` or `unknown`. None of these is a transient failure
      and none is retryable: the run has an outcome, has been declared dead, or
      does not exist. Beating again would be asking the same settled question.
    */
    console.error("turn lease no longer renewable", { outcome });
    lose("run_not_renewable");
  };

  const schedule = () => {
    if (stopped) return;
    handle = setTimer(() => void beat(), intervalMs);
  };

  schedule();

  return {
    stop,
    get failures() {
      return failures;
    },
  };
}
