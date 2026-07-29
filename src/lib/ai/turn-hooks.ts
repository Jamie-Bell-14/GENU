import {
  validateScene,
  type CanvasScene,
  type ProjectScope,
  type SceneRejection,
} from "@/lib/canvas/scene";
import type { ActivityReporter } from "./activity-reporter";
import type { StagedOperation, TurnHooks } from "./discovery-engine";
import type { TurnEvent } from "./turn-events";

/**
 * What a host must supply to run a turn. Everything that touches storage is a
 * port, so the same orchestration serves the real project route and the
 * database-free development route without either re-implementing the trust
 * boundary.
 */
export interface TurnPorts {
  emit(event: TurnEvent): void;
  scope: ProjectScope;
  /** Reports operations around the work that performs them. */
  reporter: ActivityReporter;
  onSceneAccepted(scene: CanvasScene): Promise<void>;
  onSceneRejected(rejection: SceneRejection): Promise<void>;
  /**
   * Reads pending steering. Deliberately does *not* announce that a direction
   * was applied: a note existing and the model using it are different facts,
   * and the second is the engine's to report through `onDirectionApplied`.
   */
  takeDirection(options: { final: boolean }): Promise<string | null>;
  /** The model has now actually received this direction. */
  onDirectionApplied(note: string): void;
  /**
   * Disposes of the operations a successful turn produced. Optional because the
   * scripted engine produces none; a live engine that reaches an absent port is
   * a wiring error and is treated as one rather than as a silent refusal.
   */
  commitOperations?(operations: readonly StagedOperation[]): Promise<void>;
}

/**
 * The single place a scene candidate crosses from untrusted to renderable
 * (docs/AI_SYSTEM.md §9.1).
 *
 * An engine hands over a candidate and is told nothing about the outcome: it
 * cannot discover which shapes pass, and a rejected candidate reaches no
 * surface at all — it is recorded in the audit trail instead, because a
 * rejected recommendation is exactly the kind of event that matters after the
 * fact.
 */
export function createTurnHooks(ports: TurnPorts): TurnHooks {
  return {
    emit: ports.emit,

    step: (name, work, outcome) => ports.reporter.step(name, work, outcome),

    /*
      The step is reported here rather than by the engine, because only this
      side knows whether a scene was actually prepared. Wrapping the call in
      the engine would report "canvas view prepared" for a rejected candidate.
      The outcome still does not travel back to the engine: it returns void
      either way, so the validation boundary cannot be probed.
    */
    async recommendScene(candidate) {
      await ports.reporter.step(
        "preparing_canvas_view",
        async () => {
          const result = validateScene(candidate, ports.scope);
          if (!result.ok) {
            await ports.onSceneRejected(result.rejection);
            return false;
          }
          ports.emit({ type: "scene_recommended", scene: result.scene });
          await ports.onSceneAccepted(result.scene);
          return true;
        },
        (accepted) => (accepted ? "succeeded" : "failed"),
      );
    },

    takeDirection: ports.takeDirection,

    directionApplied: ports.onDirectionApplied,

    async commitOperations(operations) {
      if (!operations.length) return;
      if (!ports.commitOperations) {
        // Loud rather than silent: an engine producing operations for a host
        // that cannot dispose of them would otherwise look like a boundary
        // quietly refusing everything.
        throw new Error("no operation port for staged operations");
      }
      await ports.commitOperations(operations);
    },
  };
}
