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
  ResearchSource,
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
   * Persists the exact result a research pass produced, before it is shown —
   * so a finding the client can see always has a receipt "Add as evidence"
   * can later resolve (T10 review round 1, P0-1). Carries the object research
   * was actually run against, and the unavailable sources and applied
   * steering that were part of the displayed result (T10 review round 2,
   * P0-A) — the receipt is the *only* record of what was researched and how
   * once the session that ran it is gone. Returns the receipt id, or `null`
   * if it could not be recorded.
   */
  recordResearchFinding(input: {
    finding: ResearchFinding;
    focalObjectId: string | null;
    unavailableSources: { source: ResearchSource; reason: string }[];
    appliedDirections: string[];
  }): Promise<string | null>;
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
    /*
      This pass's own record of what it actually did (T10 review round 2,
      P0-A) — carried into the receipt so a source that failed, or a
      direction that genuinely took effect, is not only ever a fact of this
      session's transient state.
    */
    const unavailableSources: { source: ResearchSource; reason: string }[] = [];
    const appliedDirections: string[] = [];
    /*
      A direction the provider said `applies_next_step` for: not yet
      genuinely in effect, so not yet announced — only the *next* step
      boundary can honestly say it took hold (T10 review round 2, P0-D).
    */
    let pendingNextStepNote: string | null = null;
    /*
      Every step's boundary work (flushing a deferred note, reading and
      relaying new direction), chained so it always runs in the order its
      steps actually happened — never in the order their *database* reads
      happen to resolve (T10 review round 3, P0-3).

      The provider is not back-pressured by this work: its `execute` loop
      times its own steps independently and does not await `onEvent`, so a
      slow `takeDirection()` read cannot be assumed to finish before the next
      provider event arrives. Chaining every step's boundary work onto the
      one before it — rather than letting each step race the provider's own
      timing — is what keeps a later step's boundary from starting before an
      earlier one has actually decided what happened to its own direction,
      regardless of how long any one read takes. `finding`, `done` and
      `failed` each await this same chain before reading `appliedDirections`
      or settling, so none of them can observe a boundary still in flight.
    */
    let boundaryQueue: Promise<void> = Promise.resolve();

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
      Resolves a direction still waiting for a step that never came — the
      pass ended (a finding, `done` or `failed`) before the *next* boundary
      this note needed could exist to honestly say it took hold
      (T10 review round 3, P0-3). Without this, a direction accepted right at
      the pass's last step could be told "will be applied at the next step"
      and then never hear anything else again.
    */
    function rejectStrandedDirection() {
      if (!pendingNextStepNote) return;
      const note = pendingNextStepNote;
      pendingNextStepNote = null;
      ports.emit({
        type: "direction_rejected",
        note,
        reason:
          "This research finished before your direction reached a step that could apply it.",
      });
    }

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
        case "step": {
          /*
            Queued onto the chain immediately, in the order steps actually
            happen — not run inline — so a slower earlier boundary can never
            be overtaken by a faster later one (T10 review round 3, P0-3).
          */
          boundaryQueue = boundaryQueue.then(async () => {
            /*
              A direction deferred at the previous step boundary is honestly
              in effect now, at this one — this is the one place that
              promise can be kept.
            */
            if (pendingNextStepNote) {
              const note = pendingNextStepNote;
              pendingNextStepNote = null;
              appliedDirections.push(note);
              ports.onDirectionApplied(note);
            }
            if (handle) {
              const note = await ports.takeDirection({ final: false });
              if (note) {
                const outcome = ports.researchProvider.steer(handle, note);
                switch (outcome) {
                  case "applied_now":
                    // Genuinely in effect now — the only case this is true.
                    appliedDirections.push(note);
                    ports.onDirectionApplied(note);
                    break;
                  case "applies_next_step":
                    // Not yet true: announced at the next step boundary above,
                    // or rejected outright if no next step ever comes.
                    pendingNextStepNote = note;
                    break;
                  case "requires_restart":
                    /*
                      The direction endpoint already told the user this would
                      be applied — silence here would leave that promise
                      standing unfulfilled forever. The provider's own answer
                      says it did nothing with this text, so that is what is
                      said back (T10 review round 2, P0-D).
                    */
                    ports.emit({
                      type: "direction_rejected",
                      note,
                      reason:
                        "This direction cannot be applied to the research already running. Send it again to start a new research pass with it.",
                    });
                    break;
                }
              }
            }
          });
          /*
            Reported *around* the work the step conceptually spans, so its
            duration reflects how long the provider actually spent — not the
            boundary chain above, which is a correctness mechanism, not a
            presentation one, and must not gate this UI-facing promise or a
            slow read would visibly stall the activity line.
          */
          void ports.reporter.step(event.step, () => waitForNextEvent());
          break;
        }
        case "source":
          ports.emit({ type: "research_source", source: event.source });
          break;
        case "failed_source":
          unavailableSources.push({
            source: event.source,
            reason: event.reason,
          });
          ports.emit({
            type: "research_failed_source",
            source: event.source,
            reason: event.reason,
          });
          break;
        case "finding":
          lastFindingTitle = event.finding.title;
          /*
            Waits for every step boundary queued so far to actually resolve
            before reading `appliedDirections` or deciding whether a deferred
            note ever got a real step to land at (T10 review round 3, P0-3) —
            otherwise a slow final `takeDirection()` read could still be
            in flight when the receipt is built, and the direction it
            eventually resolves to would silently never reach it.

            Persisted before it is shown (T10 review round 1, P0-1): a
            finding the client can see must always have a receipt "Add as
            evidence" can later resolve. `done` below waits for this rather
            than racing it.
          */
          findingReceipt = boundaryQueue
            .then(() => {
              rejectStrandedDirection();
              return ports.recordResearchFinding({
                finding: event.finding,
                focalObjectId: task.focalObjectId,
                unavailableSources,
                appliedDirections,
              });
            })
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
          void boundaryQueue.then(() => {
            rejectStrandedDirection();
            settle({ ok: false, reason: "unavailable" });
          });
          break;
      }
    };

    if (signal?.aborted) {
      settle({ ok: false, reason: "stopped" });
      return;
    }

    // A new pass supersedes whatever the last one left behind (T10 review
    // round 2, P0-D) — before anything else, so nothing stale from an
    // earlier pass survives into this one even if this pass never produces
    // a finding of its own.
    ports.emit({ type: "research_started" });

    handle = ports.researchProvider.start(task, onEvent);
    if (signal?.aborted) onAbort();
  });
}
