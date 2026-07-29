import { describe, expect, it, vi } from "vitest";
import type { LeaseRenewal } from "@/lib/services/trusted-writer";
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

  it("asks for more time than one interval, so a late beat leaves no gap", async () => {
    const { timer, seconds } = setup(["renewed"]);
    await timer.tick();
    expect(seconds[0]).toBeGreaterThan(1);
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
