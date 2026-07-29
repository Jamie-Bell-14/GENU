import type { ActivityState, ActivityStep } from "./activity-steps";
import { activityLineFor, type TurnEvent } from "./turn-events";

/**
 * Reports an operation while it is happening, and says honestly how it ended.
 *
 * `step(name, work)` brackets the real call: the running line is emitted, the
 * work runs, and a finished line follows. Because the operation is the
 * argument, a label cannot be emitted for work that already finished, or for
 * work that never happens — which is the failure mode of narrating steps after
 * the fact.
 *
 * Ending is not the same as succeeding. Work that throws is reported as failed
 * and the error is rethrown; work that returns can classify itself through
 * `outcome`, so an operation that completes without achieving anything — a
 * rejected scene, a partial model read — never renders a success label.
 *
 * The orchestration layer that performs an operation is the layer that reports
 * it, so the route reports its own database work and the engine reports its
 * own steps through the same helper.
 */
export interface ActivityReporter {
  step<T>(
    name: ActivityStep,
    work: () => Promise<T>,
    /** Classifies a returned result. Defaults to succeeded. */
    outcome?: (result: T) => "succeeded" | "failed",
  ): Promise<T>;
}

export interface ReporterPorts {
  emit(event: TurnEvent): void;
  /** Persists one report. Failures must not abort the work being reported. */
  persist(
    operationId: string,
    name: ActivityStep,
    state: ActivityState,
  ): Promise<void>;
}

export function createActivityReporter(ports: ReporterPorts): ActivityReporter {
  return {
    async step(name, work, outcome) {
      /*
        One id per invocation, not per step name: the same operation can happen
        more than once in a turn, and two invocations must stay two entries in
        the history.
      */
      const operationId = crypto.randomUUID();

      const report = (state: ActivityState) => {
        ports.emit({
          type: "activity",
          activity: activityLineFor(operationId, name, state),
        });
        return ports.persist(operationId, name, state);
      };

      const active = report("active");
      let finished: ActivityState = "failed";
      try {
        const result = await work();
        finished = outcome ? outcome(result) : "succeeded";
        return result;
      } finally {
        // Whatever happened, the operation is no longer running — but the
        // label says which of the two ways it stopped, so a thrown or
        // unsuccessful step never reads as success.
        await active;
        await report(finished);
      }
    },
  };
}
