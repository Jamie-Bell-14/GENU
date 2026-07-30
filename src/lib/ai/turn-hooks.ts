import {
  validateScene,
  type CanvasScene,
  type ProjectScope,
  type SceneRejection,
} from "@/lib/canvas/scene";
import { findFindingById } from "@/lib/research/findings";
import type {
  ResearchEvent,
  ResearchFinding,
  ResearchHandle,
  ResearchProvider,
  ResearchTask,
} from "@/lib/research/types";
import type { ActivityReporter } from "./activity-reporter";
import type { ResearchOutcome, TurnHooks } from "./discovery-engine";
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
  /** Stamped onto `scene_recommended` (issue #13, T10 exit gate). */
  turnId: string;
  /** The slice's one research provider (T10), supplied so a host can choose it. */
  researchProvider: ResearchProvider;
  /**
   * The object "Add as evidence" links to, and the object a research scene
   * recommendation focuses on. Read from the application's own project scope,
   * never from anything the model names (docs/AI_SYSTEM.md §10).
   */
  focalObjectId: string | null;
  /**
   * The finding id this turn's client says it is looking at, if any — the
   * only thing about a prior turn's research this turn is told
   * (`src/lib/research/types.ts`: nothing about a research run persists on
   * the server between turns). "Add as evidence" re-derives every provenance
   * field from this id via the closed catalogue; it is never trusted content.
   */
  activeFindingId: string | null;
  /**
   * Writes one evidence row and its link, or reports that the pairing already
   * exists. The only DB-touching step in the evidence flow, so it is a port
   * like `onSceneAccepted` rather than logic living in this file.
   */
  writeEvidence(input: {
    finding: ResearchFinding;
    objectId: string;
    consequenceSummary: string;
  }): Promise<"linked" | "already_linked" | "failed">;
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
          ports.emit({
            type: "scene_recommended",
            scene: result.scene,
            turnId: ports.turnId,
          });
          await ports.onSceneAccepted(result.scene);
          return true;
        },
        (accepted) => (accepted ? "succeeded" : "failed"),
      );
    },

    takeDirection: ports.takeDirection,

    directionApplied: ports.onDirectionApplied,

    runResearch: (task, signal) => runResearch(ports, task, signal),

    async addEvidence({ consequenceSummary }) {
      if (!ports.activeFindingId) {
        return { ok: false, reason: "no_active_research" };
      }
      if (!ports.focalObjectId) {
        return { ok: false, reason: "no_focal_object" };
      }
      const finding = findFindingById(ports.activeFindingId);
      if (!finding) return { ok: false, reason: "no_active_research" };

      const result = await ports.writeEvidence({
        finding,
        objectId: ports.focalObjectId,
        consequenceSummary,
      });
      if (result === "failed") return { ok: false, reason: "failed" };
      return { ok: true, linked: result === "linked" };
    },
  };
}

/**
 * Bridges the callback-driven `ResearchProvider` into the turn's step
 * reporting and event stream.
 *
 * A provider step has no natural "work" of its own to hand `reporter.step` —
 * the provider drives its own timing internally and simply announces when a
 * step starts. The bridge is a promise that step's `work` awaits and that only
 * resolves when the *next* provider event arrives, so the reported duration of
 * "Searching…" is genuinely how long the provider spent on it, not an
 * instant no-op.
 */
function runResearch(
  ports: TurnPorts,
  task: ResearchTask,
  signal?: AbortSignal,
): Promise<ResearchOutcome> {
  return new Promise<ResearchOutcome>((resolveOutcome) => {
    let handle: ResearchHandle | null = null;
    let awaitingNext: (() => void) | null = null;
    let lastFindingTitle = "";
    let settled = false;

    const settle = (outcome: ResearchOutcome) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolveOutcome(outcome);
    };

    const waitForNextEvent = () =>
      new Promise<void>((resolve) => {
        awaitingNext = resolve;
      });

    /*
      Stopping mid-run never produces another provider event (the mock
      provider's own loop simply returns once `stopped` — see
      `mock-research-provider.ts`), so this is the only place that outcome is
      ever reported; waiting for a `done`/`failed` that will not arrive would
      hang the turn until its lease expired instead of finishing cleanly.
    */
    function onAbort() {
      if (handle) ports.researchProvider.stop(handle);
      settle({ ok: false, reason: "stopped" });
    }
    signal?.addEventListener("abort", onAbort);

    const onEvent = (event: ResearchEvent) => {
      const resume = awaitingNext;
      awaitingNext = null;
      resume?.();

      switch (event.type) {
        case "step":
          void ports.reporter.step(event.step, async () => {
            if (handle) {
              const note = await ports.takeDirection({ final: false });
              if (note) {
                ports.researchProvider.steer(handle, note);
                ports.onDirectionApplied(note);
              }
            }
            await waitForNextEvent();
          });
          break;
        case "source":
          ports.emit({ type: "research_source", source: event.source });
          break;
        case "failed_source":
          ports.emit({
            type: "research_failed_source",
            source: event.source,
            reason: event.reason,
          });
          break;
        case "finding":
          lastFindingTitle = event.finding.title;
          ports.emit({ type: "research_finding", finding: event.finding });
          break;
        case "done":
          settle({ ok: true, findingTitle: lastFindingTitle });
          break;
        case "failed":
          settle({ ok: false, reason: "unavailable" });
          break;
      }
    };

    if (signal?.aborted) {
      settle({ ok: false, reason: "stopped" });
      return;
    }

    handle = ports.researchProvider.start(task, onEvent);
    if (signal?.aborted) onAbort();
  });
}
