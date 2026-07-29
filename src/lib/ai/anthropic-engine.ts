import Anthropic from "@anthropic-ai/sdk";
import { assembleContext, type ProjectContext } from "./context";
import type {
  DiscoveryEngine,
  TurnHooks,
  TurnInput,
  TurnResult,
} from "./discovery-engine";
import {
  DISCOVERY_EFFORT,
  DISCOVERY_MODEL,
  MAX_OUTPUT_TOKENS,
  MAX_SCHEMA_RETRIES,
  MAX_TOOL_STEPS,
  TURN_TIMEOUT_MS,
} from "./engine-config";
import {
  asUntrusted,
  DISCOVERY_PROMPT_VERSION,
  DISCOVERY_SYSTEM_PROMPT,
} from "./prompts/discovery";
import { DISCOVERY_TOOLS, validateToolInput } from "./tools/discovery-tools";
import type { SafeError } from "./turn-events";

/**
 * The live discovery engine (docs/VERTICAL_SLICE_TASKS.md T9).
 *
 * It sits behind the same `DiscoveryEngine` interface as the scripted engine,
 * so nothing in the UI or the route handler changes when it is selected. The
 * provider SDK is imported here and nowhere else (docs/ARCHITECTURE.md §1).
 *
 * Three properties are worth stating because they are easy to lose in a
 * refactor:
 *
 * - The engine never writes to the database. Every operation it derives is
 *   handed to a host hook, which validates it against the project's own rows
 *   and decides. The engine is never told what was decided.
 * - Thinking is never emitted as assistant text and never returned. Only
 *   `text` deltas reach the stream (docs/AI_SYSTEM.md §12).
 * - The turn is bounded on four axes — output tokens, tool steps, schema
 *   retries and wall-clock time — and each bound is enforced here rather than
 *   trusted to the provider.
 */

export interface AnthropicEngineOptions {
  client?: Anthropic;
  /** Overrides the assembled context; used by tests and the dev route. */
  buildContext?(input: TurnInput): ProjectContext;
  /** Structured turn diagnostics (docs/AI_SYSTEM.md §12). Never message bodies. */
  onDiagnostics?(diagnostics: TurnDiagnostics): void;
}

export interface TurnDiagnostics {
  promptVersion: string;
  model: string;
  turnId: string;
  toolSteps: number;
  schemaRetries: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  outcome: "completed" | "failed";
  errorCode?: SafeError["code"];
}

/**
 * Sent back for every accepted tool call.
 *
 * It says what is true — the proposal has been submitted — and no more.
 * Reporting acceptance would let a turn discover which shapes survive
 * validation and adapt towards them, and reporting a fabricated success would
 * invite the model to tell the person their project was updated when it was
 * not. Silence about the outcome is the only answer that is neither.
 */
const SUBMITTED =
  "Submitted. The application validates and authorises proposals; the outcome is not reported back to you. Do not tell the person it has been applied.";

export class AnthropicDiscoveryEngine implements DiscoveryEngine {
  /** Direction is picked up at tool-step boundaries, so this is the promise. */
  readonly directionApplication = "next_step" as const;

  private readonly client: Anthropic;
  private readonly options: AnthropicEngineOptions;

  constructor(options: AnthropicEngineOptions = {}) {
    // The key is read from the server environment by the SDK. It is never
    // passed through application config, so it cannot reach a client bundle
    // by being threaded through a shared options object.
    this.client = options.client ?? new Anthropic();
    this.options = options;
  }

  async runTurn(
    input: TurnInput,
    hooks: TurnHooks,
    signal?: AbortSignal,
  ): Promise<TurnResult> {
    const startedAt = Date.now();
    let toolSteps = 0;
    let schemaRetries = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    const report = (
      outcome: "completed" | "failed",
      errorCode?: SafeError["code"],
    ) =>
      this.options.onDiagnostics?.({
        promptVersion: DISCOVERY_PROMPT_VERSION,
        model: DISCOVERY_MODEL,
        turnId: input.turnId,
        toolSteps,
        schemaRetries,
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - startedAt,
        outcome,
        errorCode,
      });

    const fail = (error: SafeError): TurnResult => {
      hooks.emit({ type: "turn_failed", error });
      report("failed", error.code);
      return { assistantText: "" };
    };

    const interrupted = () =>
      fail({
        code: "turn_interrupted",
        userMessage:
          "The response was stopped. Your message is saved; send another when you are ready.",
        recoverable: true,
      });

    if (signal?.aborted) return interrupted();

    /*
      A wall-clock bound of the engine's own, joined with the caller's stop
      signal. Without it a provider that never answers holds the turn — and its
      lease — open until the lease expires, which is a much blunter recovery
      than simply giving up.
    */
    const timeout = AbortSignal.timeout(TURN_TIMEOUT_MS);
    const combined = signal
      ? AbortSignal.any([signal, timeout])
      : (timeout as AbortSignal);

    /*
      The host has already read the project model and reported that step — it
      owns the read, because only it knows whether the read was complete. The
      engine takes what it is given rather than reporting a second step with
      the same name for work that already happened.
    */
    const context = this.options.buildContext
      ? this.options.buildContext(input)
      : emptyContext(input);
    const assembled = assembleContext(context);

    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          assembled.snapshot,
          asUntrusted("user_message", input.userMessage),
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ];
    for (const message of assembled.messages) {
      // Prior turns go in ahead of the current one, oldest first.
      messages.unshift({ role: message.role, content: message.content });
    }

    let assistantText = "";
    let blockOpened = false;

    for (let step = 0; step <= MAX_TOOL_STEPS; step += 1) {
      if (combined.aborted) {
        return signal?.aborted ? interrupted() : fail(TIMED_OUT);
      }

      let final: Anthropic.Message;
      try {
        const stream = this.client.messages.stream(
          {
            model: DISCOVERY_MODEL,
            max_tokens: MAX_OUTPUT_TOKENS,
            output_config: { effort: DISCOVERY_EFFORT },
            system: DISCOVERY_SYSTEM_PROMPT,
            tools: DISCOVERY_TOOLS as unknown as Anthropic.Tool[],
            messages,
          },
          { signal: combined },
        );

        /*
          Only `text` deltas reach the user. Thinking deltas are ignored here
          rather than filtered downstream, so there is no code path on which
          hidden reasoning could be emitted or stored.
        */
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta" &&
            event.delta.text
          ) {
            if (!blockOpened) {
              hooks.emit({ type: "block", kind: "plain" });
              blockOpened = true;
            }
            hooks.emit({ type: "assistant_delta", text: event.delta.text });
            assistantText += event.delta.text;
          }
        }
        final = await stream.finalMessage();
      } catch (error) {
        if (signal?.aborted) return interrupted();
        if (timeout.aborted) return fail(TIMED_OUT);
        return fail(providerError(error));
      }

      inputTokens += final.usage.input_tokens;
      outputTokens += final.usage.output_tokens;

      /*
        A safety refusal is a content outcome, not a transport failure: the
        request succeeded and the model declined. It is reported as its own
        recoverable state rather than as the provider being unavailable, which
        would be untrue and would invite a pointless retry.
      */
      if (final.stop_reason === "refusal") {
        return fail({
          code: "model_output_invalid",
          userMessage:
            "That request could not be answered. Rephrasing it, or asking about a different part of the project, usually works.",
          recoverable: true,
        });
      }

      const toolUses = final.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      if (final.stop_reason !== "tool_use" || toolUses.length === 0) {
        // The turn is over. This is the engine's last direction boundary, so
        // the host seals the steering window here; a failure to seal is not
        // swallowed, because the window would stay open with no step left.
        const direction = await hooks.takeDirection({ final: true });
        if (direction) {
          await hooks.step("considering_direction", async () => {
            hooks.emit({
              type: "assistant_delta",
              text: `\n\nYou added: “${truncate(direction)}”. It arrived after this answer was already being written, so the next turn will take it into account.`,
            });
            return true;
          });
        }
        report("completed");
        return { assistantText };
      }

      if (step === MAX_TOOL_STEPS) {
        // The cap is a real limit and is reported as one. Whatever the model
        // was mid-way through is abandoned rather than half-applied.
        return fail({
          code: "model_output_invalid",
          userMessage:
            "This turn took more steps than it is allowed. Nothing was changed — try asking for one thing at a time.",
          recoverable: true,
        });
      }

      messages.push({ role: "assistant", content: final.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      let invalid = false;
      for (const use of toolUses) {
        const validation = validateToolInput(use.name, use.input);
        if (!validation.ok) {
          invalid = true;
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            is_error: true,
            content: validation.issue,
          });
          continue;
        }
        toolSteps += 1;
        if (validation.tool === "recommend_canvas_scene") {
          // The scene has its own validated crossing, already reported as its
          // own step and audited on rejection.
          await hooks.recommendScene(use.input);
        } else {
          await hooks.proposeOperation(validation.tool, use.input);
        }
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: SUBMITTED,
        });
      }

      if (invalid) {
        schemaRetries += 1;
        if (schemaRetries > MAX_SCHEMA_RETRIES) {
          /*
            One schema-guided retry, then stop (docs/AI_SYSTEM.md §5). Nothing
            partial has been written — every operation this turn went through
            a hook that either authorised it or did not, and a malformed one
            never reached a hook at all.
          */
          return fail({
            code: "model_output_invalid",
            userMessage:
              "The response could not be used. Nothing in your project was changed — send the message again, or rephrase it.",
            recoverable: true,
          });
        }
      }

      messages.push({ role: "user", content: results });

      /*
        A genuine step boundary, which is what makes "next step" an honest
        promise rather than a label. Direction taken here is not the final
        boundary: the turn continues, so the window stays open.
      */
      const direction = await hooks.takeDirection({ final: false });
      if (direction) {
        await hooks.step("considering_direction", async () => {
          messages.push({
            role: "user",
            content: asUntrusted("user_message", direction),
          });
          return true;
        });
      }
    }

    // Unreachable: the loop returns or fails at `step === MAX_TOOL_STEPS`.
    return fail(TIMED_OUT);
  }
}

const TIMED_OUT: SafeError = {
  code: "engine_unavailable",
  userMessage:
    "This turn took too long and was stopped. Your message is saved — send it again when you are ready.",
  recoverable: true,
};

/**
 * Maps a provider failure onto the closed set of errors the interface can
 * show. Provider text is never forwarded: it is not written for this user and
 * may name internal detail (SECURITY_STANDARDS §14.1).
 */
export function providerError(error: unknown): SafeError {
  if (error instanceof Anthropic.RateLimitError) {
    const header = error.headers?.get?.("retry-after");
    const retryAfterSeconds = header ? Number(header) : undefined;
    return {
      code: "rate_limited",
      userMessage:
        "The model is busy right now. Your message is saved — try again shortly.",
      recoverable: true,
      ...(retryAfterSeconds && Number.isFinite(retryAfterSeconds)
        ? { retryAfterSeconds }
        : {}),
    };
  }
  if (error instanceof Anthropic.AuthenticationError) {
    // A misconfigured key is an operational failure, and the person using the
    // product can do nothing about it. Say that plainly instead of implying
    // that retrying might help.
    console.error("discovery engine authentication failed");
    return {
      code: "engine_unavailable",
      userMessage:
        "Discovery analysis is unavailable. Your message is saved; this is being looked into.",
      recoverable: false,
    };
  }
  return {
    code: "engine_unavailable",
    userMessage:
      "The response could not be completed. Your message is saved — try again in a moment.",
    recoverable: true,
  };
}

function emptyContext(input: TurnInput): ProjectContext {
  return {
    fields: [],
    recentMessages: [],
    objectIds: input.context?.objectIds ?? [],
    focalObjectId: input.context?.focalObjectId ?? null,
  };
}

function truncate(value: string, max = 120): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}
