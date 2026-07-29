import Anthropic from "@anthropic-ai/sdk";
import {
  approximateTokens,
  assembleContext,
  type ProjectContext,
} from "./context";
import { resolveActions } from "./contextual-actions";
import type {
  DiscoveryEngine,
  StagedOperation,
  TurnHooks,
  TurnInput,
  TurnResult,
} from "./discovery-engine";
import {
  DISCOVERY_EFFORT,
  DISCOVERY_MODEL,
  MAX_CONTEXT_TOKENS,
  MAX_PROVIDER_ROUNDS,
  MAX_REQUEST_OUTPUT_TOKENS,
  MAX_SCHEMA_RETRIES,
  MAX_TOOL_CALLS,
  TURN_OUTPUT_ALLOWANCE,
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
  /** Tool blocks actually executed, which is what the cap counts. */
  toolCalls: number;
  /** Provider round-trips the turn made. */
  providerRounds: number;
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
 * It says what is true — the proposal is staged and will be considered when the
 * turn finishes — and no more. Reporting acceptance would let a turn discover
 * which shapes survive validation and adapt towards them, and reporting a
 * fabricated success would invite the model to tell the person their project
 * was updated when it was not. Silence about the outcome is the only answer
 * that is neither.
 */
const STAGED =
  "Recorded against this turn. The application validates and authorises proposals when the turn completes; the outcome is not reported back to you. Do not tell the person it has been applied.";

/**
 * Sent for a well-formed block in a batch that also contained a malformed one.
 * The batch is refused whole, so this block did not run — and saying so is what
 * stops the retry re-sending only the broken member and assuming the rest
 * landed.
 */
const NOT_RUN =
  "Not run: another tool call in the same response was invalid, so the whole batch was discarded. Send the complete set again.";

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
    let toolCalls = 0;
    let providerRounds = 0;
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
        toolCalls,
        providerRounds,
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

    /*
      The system prompt and tool definitions are sent on every request, so they
      are part of what a turn costs. Charging the context budget only for the
      snapshot and recent messages would understate the input by a fixed amount
      that happens to be large.
    */
    const overhead =
      approximateTokens(DISCOVERY_SYSTEM_PROMPT) +
      approximateTokens(JSON.stringify(DISCOVERY_TOOLS));
    const assembled = assembleContext(
      context,
      Math.max(0, MAX_CONTEXT_TOKENS - overhead),
    );

    /*
      One chronological sequence: history oldest → newest, then this turn's
      message. Building it by unshifting inside a forward loop reversed the
      history, so the provider received the newest exchange first and the
      oldest last — a transcript that reads as though the conversation ran
      backwards, and one that can place two same-role messages side by side.
    */
    const messages: Anthropic.MessageParam[] = assembled.messages.map(
      (message) => ({ role: message.role, content: message.content }),
    );
    messages.push({
      role: "user",
      content: [
        assembled.snapshot,
        asUntrusted("user_message", input.userMessage),
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

    let assistantText = "";
    let blockOpened = false;
    let directionConsumed = false;

    /*
      Project-truth operations are *staged*, not applied as they arrive.

      Applying inside the loop means a turn that later fails has already
      written — and the failure messages then say "nothing in your project was
      changed" while a field sits changed in the database. Canonical rule
      (docs/AI_SYSTEM.md §5): a second schema failure produces no partial
      write. Staging is what makes that true for every failure path, not just
      the schema one.
    */
    const staged: StagedOperation[] = [];

    const emitText = (text: string) => {
      if (!blockOpened) {
        hooks.emit({ type: "block", kind: "plain" });
        blockOpened = true;
      }
      hooks.emit({ type: "assistant_delta", text });
      // Appended as well as emitted, so the persisted answer and the answer the
      // user watched arrive are the same text after a reload.
      assistantText += text;
    };

    /** Commits staged writes, then reports the turn as completed. */
    const complete = async (): Promise<TurnResult> => {
      if (staged.length) await hooks.commitOperations(staged);
      report("completed");
      return { assistantText };
    };

    for (let round = 0; round < MAX_PROVIDER_ROUNDS; round += 1) {
      providerRounds += 1;
      if (combined.aborted) {
        return signal?.aborted ? interrupted() : fail(TIMED_OUT);
      }

      /*
        The turn's own output allowance, not the request's. `max_tokens` is a
        per-request ceiling, so sending the same value on every request bounds
        each one and the turn not at all — six rounds of 8,000 is 48,000. Only
        what is left is offered to the next request.
      */
      const remaining = TURN_OUTPUT_ALLOWANCE - outputTokens;
      if (remaining <= 0) return fail(OUTPUT_EXHAUSTED);

      let final: Anthropic.Message;
      try {
        const stream = this.client.messages.stream(
          {
            model: DISCOVERY_MODEL,
            max_tokens: Math.min(MAX_REQUEST_OUTPUT_TOKENS, remaining),
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
            emitText(event.delta.text);
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

      /*
        The response was cut off at the ceiling. Previously this fell through as
        a normal completion, which persisted a sentence that stops mid-word and
        called it the answer. A truncated response is a bounded failure: the
        partial text is discarded along with everything staged.
      */
      if (final.stop_reason === "max_tokens") {
        return fail({
          code: "model_output_invalid",
          userMessage:
            "The response grew too long and was cut off, so it has not been kept. Nothing in your project was changed — try asking for one thing at a time.",
          recoverable: true,
        });
      }

      const toolUses = final.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      if (final.stop_reason !== "tool_use" || toolUses.length === 0) {
        /*
          The model has finished answering. This is the final direction
          boundary, so the host seals the steering window here; a failure to
          seal is not swallowed, because the window would stay open with no
          step left to consume anything.
        */
        const direction = await hooks.takeDirection({ final: true });
        if (!direction) return complete();

        /*
          A direction that arrives here has not been used yet, and saying
          otherwise was the defect: the host used to announce
          `direction_applied` the moment a note existed, while the engine only
          promised the *next* turn would consider it — a promise nothing in the
          system kept. So the turn spends one more round actually giving it to
          the model, and only then is it applied.
        */
        const roundsLeft = MAX_PROVIDER_ROUNDS - (round + 1);
        const budgetLeft = TURN_OUTPUT_ALLOWANCE - outputTokens > 0;
        if (roundsLeft > 0 && budgetLeft) {
          await hooks.step("considering_direction", async () => {
            messages.push({ role: "assistant", content: final.content });
            messages.push({
              role: "user",
              content: asUntrusted("user_message", direction),
            });
            hooks.directionApplied(direction);
            directionConsumed = true;
            return true;
          });
          continue;
        }

        /*
          No room left to use it. The honest outcome is to say so — recorded,
          not applied — and to leave `direction_applied` unemitted, because it
          was not.
        */
        await hooks.step(
          "considering_direction",
          async () => {
            emitText(
              `\n\nYou added: “${truncate(direction)}”. This turn had no step left to use it, so it has been recorded against the turn but not applied. Send it again to act on it.`,
            );
            return false;
          },
          () => "failed",
        );
        return complete();
      }

      /*
        Every tool block counts, not every round. A round limit bounds nothing
        on its own: one response may carry a dozen parallel `tool_use` blocks,
        and each is a real operation. The batch is refused whole rather than
        executed up to the cap, so the turn never half-applies a plan.
      */
      if (toolCalls + toolUses.length > MAX_TOOL_CALLS) {
        return fail({
          code: "model_output_invalid",
          userMessage:
            "This turn tried to do more at once than it is allowed. Nothing in your project was changed — try asking for one thing at a time.",
          recoverable: true,
        });
      }

      messages.push({ role: "assistant", content: final.content });

      /*
        Validate the whole batch before executing any of it. Validating and
        executing in one pass means a valid first block is already staged — and
        under the old code, already *written* — when a later block in the same
        response turns out to be malformed.
      */
      const validations = toolUses.map((use) => ({
        use,
        validation: validateToolInput(use.name, use.input),
      }));
      const invalid = validations.filter((entry) => !entry.validation.ok);

      if (invalid.length > 0) {
        schemaRetries += 1;
        if (schemaRetries > MAX_SCHEMA_RETRIES) {
          /*
            One schema-guided retry, then stop (docs/AI_SYSTEM.md §5). Nothing
            has been written: every operation this turn produced is still
            staged, and staged work is discarded with the turn.
          */
          return fail({
            code: "model_output_invalid",
            userMessage:
              "The response could not be used. Nothing in your project was changed — send the message again, or rephrase it.",
            recoverable: true,
          });
        }
        // Report every block, so the retry corrects the batch rather than
        // guessing which member of it was wrong.
        messages.push({
          role: "user",
          content: validations.map(({ use, validation }) =>
            validation.ok
              ? {
                  type: "tool_result" as const,
                  tool_use_id: use.id,
                  content: NOT_RUN,
                }
              : {
                  type: "tool_result" as const,
                  tool_use_id: use.id,
                  is_error: true,
                  content: validation.issue,
                },
          ),
        });
        continue;
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const { use, validation } of validations) {
        if (!validation.ok) continue;
        toolCalls += 1;
        if (validation.tool === "recommend_canvas_scene") {
          /*
            Scenes are exempt from staging because they mutate nothing: a scene
            is a view of project truth, validated against ids the host loaded,
            with no write path (docs/AI_SYSTEM.md §9.3). Deferring one would
            delay the canvas for no safety gain.
          */
          await hooks.recommendScene(use.input);
        } else if (validation.tool === "suggest_actions") {
          // Resolved to application-owned labels; the ids are all the model
          // supplied and all it could supply.
          hooks.emit({
            type: "actions",
            actions: resolveActions(
              (validation.value as { actionIds: string[] }).actionIds,
            ),
          });
        } else {
          staged.push({ name: validation.tool, candidate: use.input });
        }
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: STAGED,
        });
      }

      messages.push({ role: "user", content: results });

      /*
        A genuine step boundary, which is what makes "next step" an honest
        promise rather than a label. Direction taken here is not the final
        boundary: the turn continues, so the window stays open — and the model
        really does receive it on the next request.
      */
      if (!directionConsumed) {
        const direction = await hooks.takeDirection({ final: false });
        if (direction) {
          await hooks.step("considering_direction", async () => {
            messages.push({
              role: "user",
              content: asUntrusted("user_message", direction),
            });
            hooks.directionApplied(direction);
            directionConsumed = true;
            return true;
          });
        }
      }
    }

    /*
      Rounds exhausted with the model still calling tools. A real limit,
      reported as one, with nothing committed.
    */
    return fail({
      code: "model_output_invalid",
      userMessage:
        "This turn took more steps than it is allowed. Nothing in your project was changed — try asking for one thing at a time.",
      recoverable: true,
    });
  }
}

const OUTPUT_EXHAUSTED: SafeError = {
  code: "model_output_invalid",
  userMessage:
    "This turn reached its length limit before finishing, so nothing has been kept. Your message is saved — try asking for one thing at a time.",
  recoverable: true,
};

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
    objects: (input.context?.objectIds ?? []).map((id) => ({
      id,
      kind: "concept",
      label: "Project object",
    })),
    relationshipIds: [],
    focalObjectId: input.context?.focalObjectId ?? null,
  };
}

function truncate(value: string, max = 120): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}
