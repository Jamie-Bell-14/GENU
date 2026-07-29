import type { ActivityStep } from "./activity-steps";
import { activityLineFor, type TurnEvent } from "./turn-events";

/**
 * Reports an operation while it is happening.
 *
 * `step(name, work)` brackets the real call: the active line is emitted, the
 * work runs, the complete line is emitted. Because the operation is the
 * argument, a label cannot be emitted for work that already finished, or for
 * work that never happens — which is the failure mode of narrating steps after
 * the fact.
 *
 * The orchestration layer that performs an operation is the layer that reports
 * it, so the route reports its own database work and the engine reports its
 * own steps through the same helper.
 */
export interface ActivityReporter {
  step<T>(name: ActivityStep, work: () => Promise<T>): Promise<T>;
}

export interface ReporterPorts {
  turnId: string;
  emit(event: TurnEvent): void;
  /** Persists one report. Failures must not abort the work being reported. */
  persist(name: ActivityStep, state: "active" | "complete"): Promise<void>;
}

export function createActivityReporter(ports: ReporterPorts): ActivityReporter {
  return {
    async step(name, work) {
      ports.emit({
        type: "activity",
        activity: activityLineFor(ports.turnId, name, "active"),
      });
      const persistActive = ports.persist(name, "active");
      try {
        return await work();
      } finally {
        // The completion report is emitted whether the work succeeded or
        // threw: either way the operation is no longer running, and leaving a
        // live indicator on a finished step is the thing this exists to stop.
        ports.emit({
          type: "activity",
          activity: activityLineFor(ports.turnId, name, "complete"),
        });
        await persistActive;
        await ports.persist(name, "complete");
      }
    },
  };
}
