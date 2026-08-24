import type { ActivityStep } from "./activity-steps";
import { resolveActions } from "./contextual-actions";
import type { EngineEvent } from "./turn-events";
import type { ResearchTask } from "@/lib/research/types";

/**
 * The minimum project context an engine receives. Ids only: an engine needs to
 * be able to *name* an existing object when recommending a view, and nothing
 * more than that is sent (SECURITY_STANDARDS §11.5, data minimisation).
 */
export interface TurnContext {
  /** Every object a scene may name, in a deterministic order. */
  objectIds: string[];
  /**
   * The object the project is currently exploring, chosen by the application
   * from the real project model. An engine may name it in a recommendation; it
   * may not decide what "in focus" means.
   */
  focalObjectId: string | null;
}

export interface TurnInput {
  projectId: string;
  /**
   * The correlation id for everything in this turn: messages, activity, audit
   * and any direction the user adds. The host supplies it so the id the client
   * receives is the same one the server steers by.
   */
  turnId: string;
  userMessage: string;
  context?: TurnContext;
}

export interface TurnResult {
  /** Assistant text to persist; empty when the turn failed. */
  assistantText: string;
  /**
   * Project-truth operations the turn produced, for the host to commit.
   *
   * Returned rather than committed by the engine: project truth, the assistant
   * row and the turn's terminal state have to move together, and only the host
   * can order those. A failed turn returns none.
   */
  operations: StagedOperation[];
}

/**
 * A validated operation waiting for the turn to succeed.
 *
 * `candidate` stays `unknown`: shape was checked to decide whether to retry,
 * which is not the same as being authorised, and the host re-parses it before
 * anything is written.
 */
export interface StagedOperation {
  name: string;
  candidate: unknown;
}

/**
 * What an engine may do to the outside world. Deliberately narrow:
 *
 * - `emit` accepts `EngineEvent`, which excludes `scene_recommended` and
 *   `direction_recorded`, so an engine cannot mint either.
 * - `activity` names a step from the application's catalogue; the engine never
 *   supplies the words a user reads as activity.
 * - `recommendScene` takes `unknown` — a *candidate*. The application validates
 *   and authorises it before anything reaches the canvas (docs/AI_SYSTEM.md
 *   §9.1). The engine is not told whether it was accepted, so it cannot adapt
 *   its way past the boundary.
 * - `takeDirection` returns steering the user added since the last call.
 */
export interface TurnHooks {
  emit(event: EngineEvent): void;
  /**
   * Reports an operation *around* the work that performs it, so a label can
   * never be emitted for work that already finished or never happens.
   */
  step<T>(
    name: ActivityStep,
    work: () => Promise<T>,
    outcome?: (result: T) => "succeeded" | "failed",
  ): Promise<T>;
  recommendScene(candidate: unknown): Promise<void>;
  /**
   * Announces that the model has actually consumed a direction.
   *
   * Separate from `takeDirection` because taking a note and using it are
   * different events, and only the second is `direction_applied`. Announcing on
   * the first is what let the interface claim a direction had been applied when
   * the turn had no step left to use it.
   */
  directionApplied(note: string): void;
  /**
   * Direction the user added since the last check. `final` says this is the
   * engine's last chance to use one — the host seals the steering window on
   * that call, so nothing can be accepted afterwards and promised a step that
   * will never come.
   */
  takeDirection(options: { final: boolean }): Promise<string | null>;
  /**
   * Runs the slice's one research provider to completion inside this turn
   * (docs/ARCHITECTURE.md §9, T10). Steps, sources and the finding stream to
   * the client as they happen; this resolves once the pass is over, stopped,
   * or failed. The engine is told only enough to phrase an honest reply — the
   * finding's full detail reaches the canvas directly, never through the
   * engine (docs/AI_SYSTEM.md §9.1: a scene names existing objects, it does
   * not carry render content the model composed).
   */
  runResearch(
    task: ResearchTask,
    signal?: AbortSignal,
  ): Promise<ResearchOutcome>;
}

export type ResearchOutcome =
  | { ok: true; findingTitle: string }
  | { ok: false; reason: "stopped" | "unavailable" };

export type DirectionApplicationMode = "applies_now" | "next_step" | "restart";

/**
 * The seam between the application and the model (docs/ARCHITECTURE.md §8).
 * T9 adds AnthropicDiscoveryEngine behind this same interface; nothing in
 * the UI or route handler changes when it does.
 */
export interface DiscoveryEngine {
  /**
   * What this engine can honestly promise when a user adds direction mid-turn
   * (DESIGN.md §9.3). The endpoint reports this to the user, so it must
   * describe what the engine actually does — not an aspiration.
   */
  readonly directionApplication: DirectionApplicationMode;
  runTurn(
    input: TurnInput,
    hooks: TurnHooks,
    signal?: AbortSignal,
  ): Promise<TurnResult>;
}

const REFLECTION_PREFIX = "You said";

/**
 * Deterministic engine used for development, tests and CI. It performs no
 * analysis: it reflects the user's message and states plainly that real
 * discovery is not connected yet, so no screen can imply capability the
 * product does not have.
 *
 * It runs in observable steps because the activity system's contract is that a
 * multi-step turn can be watched, steered and stopped — a single-shot engine
 * could not demonstrate that honestly.
 */
export class ScriptedDiscoveryEngine implements DiscoveryEngine {
  /** Direction is read at the step boundary, so this is what it can promise. */
  readonly directionApplication = "next_step" as const;

  constructor(private readonly deltaDelayMs = 0) {}

  async runTurn(
    input: TurnInput,
    hooks: TurnHooks,
    signal?: AbortSignal,
  ): Promise<TurnResult> {
    const interrupted = () => {
      hooks.emit({
        type: "turn_failed",
        turnId: input.turnId,
        error: {
          code: "turn_interrupted",
          userMessage:
            "The response was stopped. Your message is saved; send another when you are ready.",
          recoverable: true,
        },
      });
      return { assistantText: "", operations: [] };
    };

    if (signal?.aborted) return interrupted();

    const trimmed = input.userMessage.trim();

    /*
      Recognised by exact text, not understanding — this engine performs no
      analysis at all (see the class doc). The live engine recognises the same
      requests by what they mean, through the same two tools
      (docs/ARCHITECTURE.md §8); this is only the deterministic stand-in CI and
      Playwright run against.

      "Research this" matches by prefix, not full equality: the T10
      all-sources-unavailable edge case is reached by appending a marker
      MockResearchProvider recognises on the topic it is handed (e.g.
      "Research this (all sources unavailable)"), and the full message is
      what becomes that topic — see `runResearchTurn` below.
    */
    if (trimmed.toLowerCase().startsWith("research this")) {
      return this.runResearchTurn(input, hooks, signal, interrupted);
    }
    if (trimmed.toLowerCase() === "add as evidence") {
      return this.runAddEvidenceTurn(input, hooks, signal, interrupted);
    }
    if (trimmed.toLowerCase() === "propose a change") {
      return this.runProposeChangeTurn(input, hooks, signal, interrupted);
    }

    const preview =
      trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
    const lines = [
      `${REFLECTION_PREFIX}: “${preview}”`,
      "",
      "This message is saved to the project. Discovery analysis is not connected yet, so nothing here has been interpreted, challenged or added to the project model.",
    ];

    /*
      Decide what the canvas should show, before explaining anything. The
      candidate is a plain object; the application decides whether it is
      renderable. The focal object comes from the application's own reading of
      the project — the engine names it, it does not choose what is in focus.
    */
    const focalObjectId = input.context?.focalObjectId;
    if (focalObjectId) {
      await hooks.recommendScene({
        renderer: "problem_exploration",
        purpose: "explore_problem",
        focalObjectId,
        visibleObjectIds: visibleWithFocus(
          focalObjectId,
          input.context?.objectIds ?? [],
        ),
        visibleRelationshipIds: [],
        emphasis: "none",
        reason:
          "Showing the problem this project is exploring. Discovery analysis is not connected yet.",
        transition: "replace",
      });
    }
    if (signal?.aborted) return interrupted();

    // Explain, in text.
    hooks.emit({ type: "block", kind: "plain" });
    if (!(await this.stream(lines.join("\n"), hooks, signal))) {
      return interrupted();
    }

    /*
      Step boundary — this is where added direction is genuinely picked up,
      which is why the engine promises "next step" rather than "applies now".
    */
    // The scripted engine has exactly one direction boundary, so it is final.
    const direction = await hooks.takeDirection({ final: true });
    if (direction) {
      const acknowledgement = `\n\nYou added: “${truncate(direction, 120)}”. It is recorded against this turn and will be used once discovery analysis is connected.`;
      const streamed = await hooks.step(
        "considering_direction",
        async () => {
          /*
            The scripted engine really does pick the direction up: it reads it
            at its step boundary and answers with it. Announcing that here —
            rather than when the note merely arrived — keeps the meaning of
            `direction_applied` the same for both engines.
          */
          hooks.directionApplied(direction);
          return this.stream(acknowledgement, hooks, signal);
        },
        // A turn stopped part-way through the acknowledgement did not take the
        // direction into account, whatever the label would otherwise say.
        (delivered) => (delivered ? "succeeded" : "failed"),
      );
      if (!streamed) return interrupted();
      lines.push(acknowledgement);
    }

    hooks.emit({
      type: "actions",
      actions: [
        {
          id: "explain-reasoning",
          label: "Explain my reasoning",
          hint: "Available once discovery analysis is connected.",
        },
      ],
    });
    // No `done`: the host emits that once the result is stored and the turn's
    // outcome is recorded.
    // The scripted engine proposes no project-truth operations.
    return { assistantText: lines.join("\n"), operations: [] };
  }

  /**
   * "Research this" (VERTICAL_SLICE_SPEC Step 4). Runs the provider, then — on
   * a finding — recommends the research view and names the one action that
   * genuinely follows from it.
   */
  private async runResearchTurn(
    input: TurnInput,
    hooks: TurnHooks,
    signal: AbortSignal | undefined,
    interrupted: () => TurnResult,
  ): Promise<TurnResult> {
    if (signal?.aborted) return interrupted();

    const outcome = await hooks.runResearch(
      {
        topic: input.userMessage.trim(),
        focalObjectId: input.context?.focalObjectId ?? null,
      },
      signal,
    );
    if (signal?.aborted) return interrupted();

    if (!outcome.ok) {
      const text =
        outcome.reason === "stopped"
          ? "Research was stopped before it produced a finding."
          : "Research could not run just now. Nothing was added to the project.";
      hooks.emit({ type: "block", kind: "plain" });
      if (!(await this.stream(text, hooks, signal))) return interrupted();
      return { assistantText: text, operations: [] };
    }

    const focalObjectId = input.context?.focalObjectId;
    if (focalObjectId) {
      await hooks.recommendScene({
        renderer: "evidence_research",
        purpose: "research_evidence",
        focalObjectId,
        visibleObjectIds: [focalObjectId],
        visibleRelationshipIds: [],
        emphasis: "none",
        reason: `Showing what was found: “${outcome.findingTitle}”. This is demonstration data.`,
        transition: "replace",
      });
    }

    /*
      A successful pass with no focal object queues no scene at all (the
      branch above) and its receipt has no target — `complete_turn` can only
      refuse it as `no_focal_object`. Neither the reply nor the offered
      actions may say otherwise (T10 review round 9, P1: the same
      application-owned eligibility rule the live engine's tool result and
      reload hydration already apply — see `anthropic-engine.ts` and
      `project-model-store.ts`'s `loadLatestResearchReceipt`). There is no
      canvas view to point to, and "Add as evidence" would submit a receipt
      the database is guaranteed to refuse.
    */
    const text = focalObjectId
      ? `I found: “${outcome.findingTitle}”. This is demonstration data, not a live lookup — see the canvas for the full finding, its sources and what it does and does not support.`
      : `I found: “${outcome.findingTitle}”. This is demonstration data, not a live lookup. Nothing was in focus, so no research view was queued and this cannot be added as evidence — establish or focus the relevant object, then run the research again.`;
    hooks.emit({ type: "block", kind: "finding" });
    if (!(await this.stream(text, hooks, signal))) return interrupted();

    if (focalObjectId) {
      hooks.emit({
        type: "actions",
        actions: resolveActions(["add_as_evidence"]),
      });
    }
    return { assistantText: text, operations: [] };
  }

  /**
   * "Add as evidence" (VERTICAL_SLICE_SPEC Step 6).
   *
   * Staged like any other project-truth write (T10 review round 2, P0-B):
   * whether it actually links is decided when the turn completes, not here,
   * so the reply speaks in the same present-progressive terms as any other
   * staged proposal rather than claiming a result this engine cannot yet
   * know. This engine cannot itself judge whether the scripted finding
   * supports or contradicts an arbitrary, unknown target object, so it
   * honestly proposes `unclear` rather than guess — the live engine, which
   * can read the target's own text, judges this for real.
   */
  private async runAddEvidenceTurn(
    input: TurnInput,
    hooks: TurnHooks,
    signal: AbortSignal | undefined,
    interrupted: () => TurnResult,
  ): Promise<TurnResult> {
    if (signal?.aborted) return interrupted();

    const consequenceSummary =
      "It supports that deposit disputes occur at meaningfully different rates across agency sizes in the scripted scenario. It does not establish anything about a real agency's own dispute rate, and the two demonstration sources disagree on the overall figure.";
    const text = `Adding this as evidence — it will show on the canvas once this finishes. ${consequenceSummary}`;

    hooks.emit({ type: "block", kind: "plain" });
    if (!(await this.stream(text, hooks, signal))) return interrupted();
    return {
      assistantText: text,
      operations: [
        {
          name: "add_evidence",
          candidate: { consequenceSummary, direction: "unclear" },
        },
      ],
    };
  }

  /**
   * "Propose a change" (VERTICAL_SLICE_SPEC Steps 7–8, T11). Stages a
   * connected change across target customer, problem, value proposition and
   * MVP scope — nothing here writes project truth. As with "Add as
   * evidence", the staged operation is only real once the host has actually
   * committed it; the host announces the proposal (`proposal_created`) at
   * that point, not here.
   */
  private async runProposeChangeTurn(
    input: TurnInput,
    hooks: TurnHooks,
    signal: AbortSignal | undefined,
    interrupted: () => TurnResult,
  ): Promise<TurnResult> {
    if (signal?.aborted) return interrupted();

    const text =
      "I found a connected change worth reviewing: narrowing the target customer changes what the problem, value proposition and MVP scope should say too. Nothing is applied yet — review it below, item by item.";

    hooks.emit({ type: "block", kind: "plain" });
    if (!(await this.stream(text, hooks, signal))) return interrupted();

    return {
      assistantText: text,
      operations: [
        {
          name: "propose_connected_change",
          candidate: {
            title: "Narrow the target customer to small letting agencies",
            rationale:
              "The scripted scenario's evidence points at smaller agencies, which changes what the problem, value proposition and MVP scope should say too.",
            remainingUncertainty:
              "No pricing evidence yet, so the MVP scope change is the least certain of the four.",
            items: [
              {
                area: "customer",
                key: "primary_customer",
                before: "Letting agencies",
                after: "Letting agencies under 20 staff",
              },
              {
                area: "problem",
                key: "core_problem",
                before: "Deposit disputes are costly and slow to resolve.",
                after:
                  "Deposit disputes are costly and slow to resolve for agencies too small to have in-house dispute handling.",
              },
              {
                area: "value_proposition",
                key: "core_value",
                before: "Faster deposit dispute resolution.",
                after:
                  "Faster deposit dispute resolution, without needing in-house dispute expertise.",
              },
              {
                area: "mvp_scope",
                key: "core_scope",
                before: "Deposit dispute case tracking.",
                after:
                  "Deposit dispute case tracking, sized for a small agency's caseload.",
              },
            ],
          },
        },
      ],
    };
  }

  /** Streams text, returning false if the turn was stopped part-way. */
  private async stream(
    text: string,
    hooks: TurnHooks,
    signal?: AbortSignal,
  ): Promise<boolean> {
    for (const chunk of chunkText(text)) {
      if (signal?.aborted) return false;
      hooks.emit({ type: "assistant_delta", text: chunk });
      if (this.deltaDelayMs > 0) await delay(this.deltaDelayMs);
    }
    return true;
  }
}

/** The scene schema's ceiling on how many objects one view may name. */
const MAX_VISIBLE_OBJECTS = 60;

/**
 * Builds the visible set with the focal object guaranteed to be in it.
 *
 * Taking the first N ids and hoping the focal object is among them fails on any
 * project large enough for it not to be — the scene is then rejected as
 * `focal_not_visible`, which looks like a validation bug rather than what it
 * is. The focal object leads; the rest fills deterministically behind it.
 */
function visibleWithFocus(
  focalObjectId: string,
  objectIds: string[],
): string[] {
  const rest = objectIds.filter((id) => id !== focalObjectId);
  return [focalObjectId, ...rest.slice(0, MAX_VISIBLE_OBJECTS - 1)];
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function chunkText(text: string, size = 24): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
