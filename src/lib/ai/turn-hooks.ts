import {
  validateScene,
  type CanvasScene,
  type ProjectScope,
  type SceneRejection,
} from "@/lib/canvas/scene";
import type { ActivityReporter } from "./activity-reporter";
import type { TurnHooks } from "./discovery-engine";
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
  takeDirection(): Promise<string | null>;
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

    step: (name, work) => ports.reporter.step(name, work),

    async recommendScene(candidate) {
      const result = validateScene(candidate, ports.scope);
      if (!result.ok) {
        await ports.onSceneRejected(result.rejection);
        return;
      }
      ports.emit({ type: "scene_recommended", scene: result.scene });
      await ports.onSceneAccepted(result.scene);
    },

    takeDirection: ports.takeDirection,
  };
}
