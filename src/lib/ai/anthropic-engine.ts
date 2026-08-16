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
  TURN_INPUT_ALLOWANCE,
  TURN_OUTPUT_ALLOWANCE,
  TURN_TIMEOUT_MS,
} from "./engine-config";
import {
  asUntrusted,
  DISCOVERY_PROMPT_VERSION,
  DISCOVERY_SYSTEM_PROMPT,
} from "./prompts/discovery";
import type { AddEvidence } from "./tools/discovery-tools";
import {
  DISCOVERY_TOOLS,
  isDiscoveryToolName,
  validateToolInput,
} from "./tools/discovery-tools";
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
  /**
   * The validated tool name for each executed block, in call order (T11
   * entry-gate smoke test, issue #14). Always one of the closed set
   * `validateToolInput` recognises — never the model's raw input, so this can
   * never carry an argument or message body regardless of what the model sent.
   *
   * Populated only for blocks that actually ran, which excludes a real tool
   * requested with arguments that failed schema validation — exactly the
   * provider/schema incompatibility this gate exists to catch. See
   * `requestedToolNames` for that case.
   */
  toolNames: string[];
  /**
   * The application-recognised tool name for every `tool_use` block a
   * response contained this turn, in the order the provider sent them —
   * recorded *before* argument validation, so a known tool named with
   * malformed arguments still leaves a safe trace here even though it never
   * reaches `toolNames` (T11 entry gate, issue #14). Checked against the same
   * closed catalogue `validateToolInput` uses (`isDiscoveryToolName`), so an
   * unrecognised name is never recorded and this can never carry an argument
   * or message body regardless of what the model sent.
   */
  requestedToolNames: string[];
  /** Provider round-trips the turn made. */
  providerRounds: number;
  schemaRetries: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  outcome: "completed" | "failed";
  errorCode?: SafeError["code"];
  /**
   * Present only when `outcome` is `"failed"` and the failure came from a
   * provider request (T11 entry-gate live smoke test, issue #14).
   * `errorCode` alone collapses every non-rate-limit, non-auth provider
   * failure into `"engine_unavailable"` — a 400, a 404, a 5xx and a
   * connection failure are all indistinguishable from each other on that
   * field. This adds the SDK's own safe classification of the exception so a
   * real incompatibility can be told apart from a transient outage without
   * ever touching provider-authored text. See `classifyProviderError`.
   */
  providerFailure?: ProviderFailureDiagnostics;
}

/**
 * Safe, non-content classification of a provider request failure (T11
 * entry-gate live smoke test, issue #14).
 *
 * Every error the Anthropic SDK throws for a failed request is an
 * `Anthropic.APIError`, which exposes `status`, `requestID` and a
 * closed-vocabulary `type` string from the API's own error envelope (e.g.
 * `"overloaded_error"`, `"invalid_request_error"`) as distinct properties
 * from `.message` and `.error` (the parsed response body). The latter two
 * can carry provider-authored text and are never read here or forwarded
 * anywhere (SECURITY_STANDARDS §14.1) — only the class name, status,
 * request id and closed-vocabulary type are recorded.
 */
export interface ProviderFailureDiagnostics {
  /** The SDK exception's own class name, e.g. `"RateLimitError"`, `"APIConnectionError"`. */
  errorClass: string;
  /** HTTP status code, when the failure reached the API at all. */
  status?: number;
  /** The API's own closed-vocabulary error type from its response envelope. */
  errorType?: string;
  /** Anthropic's request id, for correlating with their side out of band. */
  requestId?: string;
}

export function classifyProviderError(
  error: unknown,
): ProviderFailureDiagnostics {
  if (error instanceof Anthropic.APIError) {
    return {
      errorClass: error.constructor.name,
      ...(typeof error.status === "number" ? { status: error.status } : {}),
      ...(error.type ? { errorType: error.type } : {}),
      ...(error.requestID ? { requestId: error.requestID } : {}),
    };
  }
  if (error instanceof Error) {
    return { errorClass: error.constructor.name };
  }
  return { errorClass: "unknown" };
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
    /** Validated tool names only — see `TurnDiagnostics.toolNames`. */
    const toolNames: string[] = [];
    /** Every requested tool, pre-validation — see `TurnDiagnostics.requestedToolNames`. */
    const requestedToolNames: string[] = [];
    let providerRounds = 0;
    let schemaRetries = 0;
    /** What the engine has committed to sending, checked before each request. */
    let plannedInputTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    /** Set only on a provider-request failure — see `TurnDiagnostics.providerFailure`. */
    let providerFailure: ProviderFailureDiagnostics | undefined;

    const report = (
      outcome: "completed" | "failed",
      errorCode?: SafeError["code"],
    ) =>
      this.options.onDiagnostics?.({
        promptVersion: DISCOVERY_PROMPT_VERSION,
        model: DISCOVERY_MODEL,
        turnId: input.turnId,
        toolCalls,
        toolNames: [...toolNames],
        requestedToolNames: [...requestedToolNames],
        providerRounds,
        schemaRetries,
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - startedAt,
        outcome,
        errorCode,
        ...(providerFailure ? { providerFailure } : {}),
      });

    const fail = (error: SafeError): TurnResult => {
      hooks.emit({ type: "turn_failed", turnId: input.turnId, error });
      report("failed", error.code);
      // No operations: staged work is discarded with the turn.
      return { assistantText: "", operations: [] };
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
      (message) => ({
        role: message.role,
        /*
          A stored user message can carry injection text just as a live one can,
          so history crosses inside a data region too. Assistant turns are the
          model's own words and are replayed as they were.
        */
        content:
          message.role === "user"
            ? asUntrusted("user_message", message.content)
            : message.content,
      }),
    );
    /*
      Both regions are delimited, and for the same reason: stored field values
      and object labels are user-editable, so a project's own snapshot is no
      more trustworthy than a chat message. Leaving it undelimited put
      user-authored text outside the regions the system prompt declares as data.
    */
    /*
      Sent verbatim rather than through `assembleContext`'s budget: without
      it, an `add_evidence` call this turn makes has nothing to genuinely
      compare and must be refused down to `unclear` regardless of what the
      model returns (T10 review round 3, P0-1) — trimming it silently would
      turn an honest turn into a wrongly-ungrounded one for a reason nobody
      could see.
    */
    const groundingText =
      context.researchGrounding?.grounded === true
        ? context.researchGrounding.text
        : null;

    /*
      Whether `suggest_actions` may honour a model-supplied `add_as_evidence`
      id (T10 review round 9, P1; corrected round 10, P1). A closed action id
      only proves the model named a real action, not that pressing the
      resulting button can succeed — the application owns the label, so it
      owns this promise too, the same way it already owns the tool-result
      wording (above) and reload hydration
      (`project-model-store.ts`'s `loadLatestResearchReceipt`).

      Deliberately *not* seeded from `groundingText`. `groundingText` answers
      a different question — may *this turn* trust a comparison against the
      receipt it was sent, for its own `add_evidence` call — not whether a
      button offered for a *later* turn will still work. Even a genuinely
      grounded prior receipt is retired by this very turn: the client clears
      `activeResearch` the moment a turn other than the receipt's own is
      identified, which happens as this turn starts, well before its
      response is produced. Seeding eligibility from it would offer a button
      the receipt can no longer back by the time this turn's answer reaches
      the person.

      Starts `false`. Only a fresh, successful, focused `start_research`
      *this turn produces* can set it — because that receipt's own turn is
      this turn, so it is still current once this turn's answer is the
      project's newest message. Updated once per provider round, at the end
      of that round's tool processing (see `addEvidenceEligibleNextRound`
      below) rather than as each tool result is produced, so a
      `start_research` call and a `suggest_actions` call in the *same* batch
      cannot make each other eligible: the model generated both without
      seeing either result, so a `suggest_actions` call in that batch is
      filtered against eligibility as it stood before the round started,
      never against what the round itself just produced.
    */
    let addEvidenceEligible: boolean = false;

    messages.push({
      role: "user",
      content: [
        assembled.snapshot
          ? asUntrusted("project_context", assembled.snapshot)
          : "",
        groundingText ? asUntrusted("research", groundingText) : "",
        asUntrusted("user_message", input.userMessage),
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

    let assistantText = "";
    let blockOpened = false;
    /*
      Steering is sealed *before* the last round the engine could spend on it,
      not after the model finishes.

      The previous shape accepted a direction at the final boundary and then, if
      no round remained, reported it as recorded-but-not-applied. That is honest
      after the fact but still breaks the promise made when it was accepted —
      "applied at the next step of this turn". Sealing early means a direction
      arriving too late is *refused* by the database before any promise is made,
      and every accepted direction has a round waiting for it.
    */
    let directionsSealed = false;

    /**
     * A direction attached to the transcript whose request has not returned yet.
     *
     * `direction_applied` may only be emitted once the model has actually
     * received the note, and adding it to a local array is not that. Input
     * exhaustion, output exhaustion or a provider failure can all happen between
     * attaching it and the model seeing it, and each of those used to leave the
     * interface saying "applied" for a request that never completed.
     */
    let carried: string | null = null;

    /** Announces a carried direction, now that a response really carried it. */
    const announceCarried = async () => {
      if (!carried) return;
      const note = carried;
      carried = null;
      // Reported around the fact rather than around the intention: the step and
      // the event now describe the same moment.
      await hooks.step("considering_direction", async () => {
        hooks.directionApplied(note);
        return true;
      });
    };

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

    /**
     * Reports the turn as completed and hands its staged writes back.
     *
     * The engine does not commit them. Project truth, the assistant row and the
     * turn's terminal state have to move together, and only the host can order
     * those — see `finishTurn`, which is the single documented durable boundary.
     */
    const complete = (): TurnResult => {
      report("completed");
      return { assistantText, operations: staged };
    };

    for (let round = 0; round < MAX_PROVIDER_ROUNDS; round += 1) {
      providerRounds += 1;
      if (combined.aborted) {
        return signal?.aborted ? interrupted() : fail(TIMED_OUT);
      }

      /*
        One round is reserved for steering. On the last round the engine could
        possibly spend, the window closes first — so nothing can be accepted
        that this turn has no capacity to use. A note taken here is fed into
        this very request.
      */
      if (!directionsSealed && round === MAX_PROVIDER_ROUNDS - 1) {
        directionsSealed = true;
        const late = await hooks.takeDirection({ final: true });
        if (late) {
          messages.push({
            role: "user",
            content: asUntrusted("user_message", late),
          });
          carried = late;
        }
      }

      /*
        The turn's own output allowance, not the request's. `max_tokens` is a
        per-request ceiling, so sending the same value on every request bounds
        each one and the turn not at all — six rounds of 8,000 is 48,000. Only
        what is left is offered to the next request.
      */
      const remaining = TURN_OUTPUT_ALLOWANCE - outputTokens;
      if (remaining <= 0) return fail(OUTPUT_EXHAUSTED);

      /*
        Input is bounded *before* the request, not accumulated from responses
        afterwards. The transcript grows every round — assistant content, tool
        results, a direction — and all of it is re-sent, so a per-assembly
        budget says nothing about what a turn costs. Measuring the payload the
        engine is about to send is the only version of this check that can stop
        anything.
      */
      const payloadTokens =
        overhead + approximateTokens(JSON.stringify(messages));
      if (plannedInputTokens + payloadTokens > TURN_INPUT_ALLOWANCE) {
        return fail(INPUT_EXHAUSTED);
      }
      plannedInputTokens += payloadTokens;

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
        providerFailure = classifyProviderError(error);
        return fail(providerError(error));
      }

      inputTokens += final.usage.input_tokens;
      outputTokens += final.usage.output_tokens;

      /*
        The model has now genuinely received anything carried into this request,
        so this is the first honest moment to say a direction was applied.
      */
      await announceCarried();

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
      /*
        Recorded before argument validation and independent of whatever
        happens to this round next (cap, retry, success) — this is what the
        provider actually asked for, not what survived (T11 entry gate,
        issue #14). `isDiscoveryToolName` is the same closed catalogue check
        `validateToolInput` uses, so an unrecognised name is never recorded.
      */
      for (const use of toolUses) {
        if (isDiscoveryToolName(use.name)) requestedToolNames.push(use.name);
      }

      if (final.stop_reason !== "tool_use" || toolUses.length === 0) {
        /*
          The model has finished answering. If the window is still open there is
          a reserved round available by construction, so anything taken here can
          actually be used — there is no path on which an accepted direction
          ends unapplied.
        */
        if (directionsSealed) return complete();

        directionsSealed = true;
        const direction = await hooks.takeDirection({ final: true });
        if (!direction) return complete();

        messages.push({ role: "assistant", content: final.content });
        messages.push({
          role: "user",
          content: asUntrusted("user_message", direction),
        });
        // Announced by the round that carries it, not by this one.
        carried = direction;
        continue;
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
      // Frozen for the duration of this round's processing (T10 review
      // round 9, P1) — see `addEvidenceEligible` above.
      let addEvidenceEligibleNextRound: boolean = addEvidenceEligible;
      for (const { use, validation } of validations) {
        if (!validation.ok) continue;
        toolCalls += 1;
        toolNames.push(validation.tool);
        let content: string = STAGED;
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
          // supplied and all it could supply. `add_as_evidence` is withheld
          // unless eligibility was already established before this round —
          // a closed action id proves the model named a real action, not
          // that this one can actually succeed right now (T10 review
          // round 9, P1).
          const requestedIds = (validation.value as { actionIds: string[] })
            .actionIds;
          const allowedIds = addEvidenceEligible
            ? requestedIds
            : requestedIds.filter((id) => id !== "add_as_evidence");
          hooks.emit({
            type: "actions",
            actions: resolveActions(allowedIds),
          });
        } else if (validation.tool === "start_research") {
          /*
            Runs to completion inside this tool round, like a scene: research
            activity has to stream while the model is still working, not after
            the turn ends, so it cannot be staged (docs/ARCHITECTURE.md §14).
          */
          const focalObjectId = input.context?.focalObjectId ?? null;
          const outcome = await hooks.runResearch(
            {
              topic: (validation.value as { topic: string }).topic,
              focalObjectId,
            },
            signal,
          );
          /*
            The scene is queued here, by the host, rather than left to a
            second model tool call the response might never make — the tool
            result below has to describe what queuing actually does, not what
            a second call might later achieve.

            Queuing is not showing (T10 review round 6, P0): `recommendScene`
            only offers the recommendation — `docs/ADAPTIVE_CANVAS_MVP.md`
            requires that a non-urgent scene update never move content under
            the user, so `LivingCanvas` holds the current scene and presents
            "Show it" / "Stay here" rather than applying it. The tool result
            must say the view is ready and selectable, never that it is
            already visible — telling the model otherwise would have it skip
            explaining the finding on the false assumption the user is
            already looking at it.
          */
          if (outcome.ok && focalObjectId) {
            await hooks.recommendScene({
              renderer: "evidence_research",
              purpose: "research_evidence",
              focalObjectId,
              visibleObjectIds: [focalObjectId],
              visibleRelationshipIds: [],
              emphasis: "none",
              reason: `Showing what was found: "${outcome.findingTitle}". This is demonstration data.`,
              transition: "replace",
            });
          }
          /*
            Every pass this round decides next-round eligibility afresh —
            an unconditional assignment, not an OR — so a stopped,
            unavailable or no-focus pass revokes eligibility a prior grounded
            receipt might have implied just as surely as a focused success
            grants it, and a second pass in the same round overrides the
            first's outcome rather than accumulating with it (T10 review
            round 10, P1). Takes effect from the next round onward, once the
            model has actually seen this result — never within this same
            batch (T10 review round 9, P1; see `addEvidenceEligibleNextRound`).
          */
          addEvidenceEligibleNextRound = outcome.ok && focalObjectId !== null;
          /*
            A successful pass with no focal object queues no scene at all
            (the branch above), and its receipt has no target —
            `complete_turn` refuses it as `no_focal_object` (T10 review
            round 7, P1). The tool result has to branch on that too: telling
            the model a view is ready and offering "Add as evidence" would
            be describing a scene that was never queued and inviting an add
            the database will refuse.

            The receipt's target is fixed at the moment it is recorded, and
            currency retires it the instant any later turn is accepted (see
            `complete_turn`'s round-5 rule) — so establishing or selecting a
            claim in a later turn can never make *this* receipt addable; it
            would already be superseded by the turn that did the
            establishing. The honest next step is a fresh pass, not a
            promise this one will become usable (T10 review round 8, P1).
          */
          content = !outcome.ok
            ? outcome.reason === "stopped"
              ? "Research was stopped before it produced a finding. Tell the person plainly; nothing further to report."
              : "Research could not run — none of the demonstration sources were available. Tell the person plainly; nothing was added."
            : focalObjectId
              ? `Research complete. Finding: "${outcome.findingTitle}". This is demonstration data — say so plainly. A validated research view is ready on the canvas; the person can select "Show it" to open it — do not claim it is already visible. Briefly state the conclusion and offer to add it as evidence if that follows, without restating the full research detail.`
              : `Research complete. Finding: "${outcome.findingTitle}". This is demonstration data — say so plainly. No project object was in focus, so no research view was queued and this result cannot be added as evidence — do not offer to add it as evidence, and do not imply it could become addable later. Briefly summarise the finding, and tell the person to establish or focus the relevant claim or object, then run the research again.`;
        } else if (validation.tool === "add_evidence") {
          /*
            The model's `direction` is only ever trusted when this request
            genuinely carried both sides of the comparison it is judging —
            the exact receipt and the target's own stored text
            (`groundingText` above, T10 review round 3, P0-1). Without that,
            `supports`/`contradicts` would be an assertion made from a title
            alone; overriding to `unclear` here, rather than trusting
            whatever the model returned, is what keeps that assertion from
            ever reaching the database ungrounded.
          */
          const value = validation.value as AddEvidence;
          staged.push({
            name: "add_evidence",
            candidate: groundingText
              ? value
              : { ...value, direction: "unclear" as const },
          });
        } else {
          staged.push({ name: validation.tool, candidate: use.input });
        }
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content,
        });
      }

      messages.push({ role: "user", content: results });
      addEvidenceEligible = addEvidenceEligibleNextRound;

      /*
        A genuine step boundary, which is what makes "next step" an honest
        promise rather than a label. Direction taken here is not the final
        boundary: the turn continues, so the window stays open — and the model
        really does receive it on the next request.
      */
      if (!directionsSealed) {
        const direction = await hooks.takeDirection({ final: false });
        if (direction) {
          messages.push({
            role: "user",
            content: asUntrusted("user_message", direction),
          });
          // Announced by the round that carries it: the next request has not
          // been made yet, and it may still fail before it is.
          carried = direction;
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

const INPUT_EXHAUSTED: SafeError = {
  code: "model_output_invalid",
  userMessage:
    "This turn grew too large to continue, so nothing has been kept. Your message is saved — try asking for one thing at a time.",
  recoverable: true,
};

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
