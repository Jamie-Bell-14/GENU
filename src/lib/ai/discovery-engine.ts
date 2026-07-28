import type { ActivityStep } from "./activity-steps";
import type { EngineEvent } from "./turn-events";

/**
 * The minimum project context an engine receives. Ids only: an engine needs to
 * be able to *name* an existing object when recommending a view, and nothing
 * more than that is sent (SECURITY_STANDARDS §11.5, data minimisation).
 */
export interface TurnContext {
  objectIds: string[];
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
  activity(step: ActivityStep): Promise<void>;
  recommendScene(candidate: unknown): Promise<void>;
  takeDirection(): Promise<string | null>;
}

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
    hooks.emit({ type: "turn_started", turnId: input.turnId });

    const interrupted = () => {
      hooks.emit({
        type: "turn_failed",
        error: {
          code: "turn_interrupted",
          userMessage:
            "The response was stopped. Your message is saved; send another when you are ready.",
          recoverable: true,
        },
      });
      return { assistantText: "" };
    };

    // Step 1 — record the message.
    await hooks.activity("recording_message");
    if (signal?.aborted) return interrupted();

    const trimmed = input.userMessage.trim();
    const preview =
      trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
    const lines = [
      `${REFLECTION_PREFIX}: “${preview}”`,
      "",
      "This message is saved to the project. Discovery analysis is not connected yet, so nothing here has been interpreted, challenged or added to the project model.",
    ];

    /*
      Step 2 — decide what the canvas should show, before explaining anything.
      The candidate is a plain object; the application decides whether it is
      renderable. Doing this before the response is streamed also means the
      canvas reports its own work while that work is what is happening, rather
      than in the instant before the turn ends.
    */
    const focalObjectId = input.context?.objectIds[0];
    if (focalObjectId) {
      await hooks.activity("reading_project_model");
      await hooks.activity("preparing_canvas_view");
      await hooks.recommendScene({
        renderer: "problem_exploration",
        purpose: "explore_problem",
        focalObjectId,
        visibleObjectIds: input.context?.objectIds.slice(0, 60) ?? [],
        visibleRelationshipIds: [],
        emphasis: "none",
        reason:
          "Showing the problem currently in focus while discovery analysis is not connected.",
        transition: "replace",
      });
    }
    if (signal?.aborted) return interrupted();

    // Step 3 — explain, in text.
    hooks.emit({ type: "block", kind: "plain" });
    if (!(await this.stream(lines.join("\n"), hooks, signal))) {
      return interrupted();
    }

    /*
      Step boundary — this is where added direction is genuinely picked up,
      which is why the engine promises "next step" rather than "applies now".
    */
    const direction = await hooks.takeDirection();
    if (direction) {
      await hooks.activity("considering_direction");
      const acknowledgement = `\n\nYou added: “${truncate(direction, 120)}”. It is recorded against this turn and will be used once discovery analysis is connected.`;
      if (!(await this.stream(acknowledgement, hooks, signal))) {
        return interrupted();
      }
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
    hooks.emit({ type: "done" });
    return { assistantText: lines.join("\n") };
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
