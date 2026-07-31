import {
  validateScene,
  type CanvasScene,
  type ProjectScope,
  type SceneRejection,
} from "@/lib/canvas/scene";
import type {
  ResearchEvent,
  ResearchFinding,
  ResearchHandle,
  ResearchProvider,
  ResearchTask,
} from "@/lib/research/types";
import type { ActivityReporter } from "./activity-reporter";
import type {
  AddEvidenceOutcome,
  ResearchOutcome,
  TurnHooks,
} from "./discovery-engine";
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
   * The research receipt id this turn's client says it is looking at, if any
   * (T10 review round 1, P0-1) — an opaque reference into `research_findings`,
   * never trusted content: `linkEvidence` re-reads the actual result from that
   * table by this id, inside its own transaction, rather than accepting
   * anything else the client supplies about it.
   */
  activeFindingId: string | null;
  /**
   * Persists the exact result a research pass produced, before it is shown —
   * so a finding the client can see always has a receipt "Add as evidence"
   * can later resolve (T10 review round 1, P0-1). Returns the receipt id, or
   * `null` if it could not be recorded.
   */
  recordResearchFinding(finding: ResearchFinding): Promise<string | null>;
  /**
   * Creates (or reuses) the evidence row for a receipt and links it to an
   * object, atomically (T10 review round 1, P0-2, P0-3) — the only DB-touching
   * step in the evidence flow, so it is a port like `onSceneAccepted` rather
   * than logic living in this file.
   */
  linkEvidence(input: {
    receiptId: string;
    objectId: string;
    consequenceSummary: string;
  }): Promise<
    | "linked"
    | "already_linked"
    | "no_active_research"
    | "no_focal_object"
    | "not_running"
    | "unavailable"
  >;
  /**
   * Re-reads project truth and tells the canvas, exactly like
   * `finishTurn`'s own `publishProjectModel` — called directly here because a
   * successful evidence link is its own immediately-committed, independently
   * true change, not something waiting on the turn's own completion (T10
   * review round 1, P0-2).
   */
  publishProjectModel(): Promise<void>;
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

    async addEvidence({ consequenceSummary }): Promise<AddEvidenceOutcome> {
      if (!ports.activeFindingId) {
        return { ok: false, reason: "no_active_research" };
      }
      if (!ports.focalObjectId) {
        return { ok: false, reason: "no_focal_object" };
      }
      const outcome = await ports.linkEvidence({
        receiptId: ports.activeFindingId,
        objectId: ports.focalObjectId,
        consequenceSummary,
      });
      switch (outcome) {
        case "linked":
          // Independently true the moment it committed — the canvas is told
          // now, not deferred to the turn's own (possibly later-failing) end.
          await ports.publishProjectModel();
          return { ok: true, linked: true };
        case "already_linked":
          return { ok: true, linked: false };
        case "no_active_research":
          return { ok: false, reason: "no_active_research" };
        case "no_focal_object":
          return { ok: false, reason: "no_focal_object" };
        case "not_running":
        case "unavailable":
          return { ok: false, reason: "failed" };
      }
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
    let findingReceipt: Promise<string | null> | null = null;
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
                const outcome = ports.researchProvider.steer(handle, note);
                /*
                  `direction_applied` is only ever true when the provider's
                  own answer says the direction is genuinely in effect —
                  `requires_restart` means the provider did nothing with it,
                  and announcing "applied" regardless would tell the user a
                  direction changed the run when it did not.
                */
                if (outcome !== "requires_restart") {
                  ports.onDirectionApplied(note);
                }
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
          /*
            Persisted before it is shown (T10 review round 1, P0-1): a
            finding the client can see must always have a receipt "Add as
            evidence" can later resolve. `done` below waits for this rather
            than racing it — the provider emits the two back to back with no
            delay in between, and settling "ok" before the receipt exists
            would let the engine promise a finding is on the canvas before
            anything durable actually backs it.
          */
          findingReceipt = ports
            .recordResearchFinding(event.finding)
            .then((receiptId) => {
              if (receiptId) {
                ports.emit({
                  type: "research_finding",
                  finding: { ...event.finding, id: receiptId },
                });
              }
              return receiptId;
            });
          break;
        case "done":
          void (async () => {
            const receiptId = findingReceipt ? await findingReceipt : null;
            settle(
              receiptId
                ? { ok: true, findingTitle: lastFindingTitle }
                : { ok: false, reason: "unavailable" },
            );
          })();
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
