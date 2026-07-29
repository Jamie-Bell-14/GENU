import { describe, expect, it, vi } from "vitest";
import type { LeaseRenewal } from "@/lib/services/trusted-writer";
import {
  LEASE_HEARTBEAT_MS,
  LEASE_TTL_SECONDS,
  TURN_TIMEOUT_MS,
} from "./engine-config";
import {
  MAX_CONSECUTIVE_RENEWAL_FAILURES,
  startLeaseHeartbeat,
} from "./lease-heartbeat";

/**
 * Heartbeat behaviour (issue #11).
 *
 * Timers are driven by hand rather than by the clock: these tests are about
 * ordering and decisions, and a test that waits for real intervals would be
 * slow and flaky without checking anything extra.
 */
function controlledTimer() {
  let pending: (() => void) | null = null;
  let cleared = 0;
  return {
    setTimer: (fn: () => void) => {
      pending = fn;
      return Symbol("handle");
    },
    clearTimer: () => {
      pending = null;
      cleared += 1;
    },
    /** Fires the scheduled beat and lets its promise settle. */
    async tick() {
      const fn = pending;
      pending = null;
      fn?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
    get scheduled() {
      return pending !== null;
    },
    get cleared() {
      return cleared;
    },
  };
}

function setup(outcomes: LeaseRenewal[] | (() => Promise<LeaseRenewal>)) {
  const timer = controlledTimer();
  const onLost = vi.fn();
  const seconds: number[] = [];
  let index = 0;
  const renew = vi.fn(async (s: number) => {
    seconds.push(s);
    if (typeof outcomes === "function") return outcomes();
    const outcome = outcomes[Math.min(index, outcomes.length - 1)];
    index += 1;
    return outcome;
  });
  const heartbeat = startLeaseHeartbeat(
    {
      renew,
      onLost,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    },
    1_000,
  );
  return { timer, onLost, renew, seconds, heartbeat };
}

describe("lease heartbeat", () => {
  it("keeps a healthy turn alive across many intervals", async () => {
    const { timer, renew, onLost } = setup(["renewed"]);
    // Well past the fifteen minutes a single fixed lease would have allowed.
    for (let beat = 0; beat < 20; beat += 1) await timer.tick();

    expect(renew).toHaveBeenCalledTimes(20);
    expect(onLost).not.toHaveBeenCalled();
    expect(timer.scheduled).toBe(true);
  });

  it("asks for the full lease TTL every time, not a multiple of the interval", async () => {
    /*
      Deriving the request from the heartbeat interval got the direction wrong:
      a minute-apart beat asking for three minutes was asking for *less* time
      than a fresh fifteen-minute lease already had. Asking for the TTL means
      each successful beat resets the whole window.
    */
    const { timer, seconds } = setup(["renewed"]);
    await timer.tick();
    expect(seconds[0]).toBe(LEASE_TTL_SECONDS);
  });

  it("tolerates a transient failure and recovers", async () => {
    const { timer, onLost, heartbeat } = setup([
      "unavailable",
      "unavailable",
      "renewed",
    ]);
    await timer.tick();
    await timer.tick();
    expect(onLost).not.toHaveBeenCalled();

    await timer.tick();
    expect(heartbeat.failures).toBe(0);
    expect(timer.scheduled).toBe(true);
  });

  it("gives up after repeated failure rather than assuming it is alive", async () => {
    const { timer, onLost } = setup(["unavailable"]);
    for (let beat = 0; beat < MAX_CONSECUTIVE_RENEWAL_FAILURES; beat += 1) {
      await timer.tick();
    }
    expect(onLost).toHaveBeenCalledExactlyOnceWith("renewal_failing");
    expect(timer.scheduled).toBe(false);
  });

  it("treats a thrown renewal as a failure, not a crash", async () => {
    const { timer, onLost } = setup(async () => {
      throw new Error("network");
    });
    for (let beat = 0; beat < MAX_CONSECUTIVE_RENEWAL_FAILURES; beat += 1) {
      await timer.tick();
    }
    expect(onLost).toHaveBeenCalledExactlyOnceWith("renewal_failing");
  });

  it.each(["finished", "expired", "unknown"] as const)(
    "stops immediately when the run is not renewable (%s)",
    async (outcome) => {
      const { timer, onLost, renew } = setup([outcome]);
      await timer.tick();

      // Not retryable: the run has an outcome, has been declared dead, or does
      // not exist. Beating again would re-ask a settled question.
      expect(onLost).toHaveBeenCalledExactlyOnceWith("run_not_renewable");
      expect(timer.scheduled).toBe(false);
      await timer.tick();
      expect(renew).toHaveBeenCalledOnce();
    },
  );

  it("does not renew after the turn has been stopped", async () => {
    const { timer, renew, heartbeat } = setup(["renewed"]);
    heartbeat.stop();
    await timer.tick();
    expect(renew).not.toHaveBeenCalled();
    expect(timer.cleared).toBe(1);
  });

  it("does not reschedule when the turn finishes mid-renewal", async () => {
    /*
      The window that matters: a renewal is in flight when the turn ends. Its
      result arrives after `stop()`, and must not restart the timer — a
      heartbeat outliving its turn would hold a finished run's lease open.
    */
    let release: (value: LeaseRenewal) => void = () => {};
    const inFlight = new Promise<LeaseRenewal>((resolve) => {
      release = resolve;
    });
    const { timer, heartbeat } = setup(() => inFlight);

    const beat = timer.tick();
    heartbeat.stop();
    release("renewed");
    await beat;

    expect(timer.scheduled).toBe(false);
  });

  it("reports loss exactly once", async () => {
    const { timer, onLost } = setup(["expired"]);
    await timer.tick();
    await timer.tick();
    expect(onLost).toHaveBeenCalledOnce();
  });
});

/*
  Issue #11's acceptance criterion, at the worker level: a healthy turn stays
  running beyond the original lease *because* something keeps saying so.
*/
describe("a healthy worker outlives its original lease", () => {
  it("is allowed to, because the turn timeout is longer than the lease", () => {
    /*
      The criterion is unreachable if the engine gives up first — the lease's
      fixed expiry would then be the real limit and the heartbeat decoration.
      This assertion is what stops the two drifting back apart.
    */
    expect(TURN_TIMEOUT_MS).toBeGreaterThan(LEASE_TTL_SECONDS * 1_000);
  });

  it("keeps beating past fifteen minutes of simulated work", async () => {
    const { timer, renew, onLost } = setup(["renewed"]);
    const beatsInLease = Math.ceil(
      (LEASE_TTL_SECONDS * 1_000) / LEASE_HEARTBEAT_MS,
    );
    // Comfortably beyond one lease period.
    const beats = beatsInLease * 2;
    for (let beat = 0; beat < beats; beat += 1) await timer.tick();

    expect(renew).toHaveBeenCalledTimes(beats);
    expect(onLost).not.toHaveBeenCalled();
    // Still scheduled: the turn is alive and saying so.
    expect(timer.scheduled).toBe(true);
  });

  it("gives up the moment the run stops being renewable, however long it has run", async () => {
    /*
      The other half of the invariant. Surviving a long time must not make a
      worker harder to kill: once the database says the run is gone, further
      work on it is work nobody will receive.
    */
    const { timer, onLost } = setup([
      ...Array.from({ length: 20 }, () => "renewed" as const),
      "expired" as const,
    ]);
    for (let beat = 0; beat < 21; beat += 1) await timer.tick();

    expect(onLost).toHaveBeenCalledExactlyOnceWith("run_not_renewable");
    expect(timer.scheduled).toBe(false);
  });
});
