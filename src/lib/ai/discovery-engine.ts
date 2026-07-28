import type { TurnEvent } from "./turn-events";

export interface TurnInput {
  projectId: string;
  userMessage: string;
}

export interface TurnResult {
  /** Assistant text to persist; empty when the turn failed. */
  assistantText: string;
}

/**
 * The seam between the application and the model (docs/ARCHITECTURE.md §8).
 * T9 adds AnthropicDiscoveryEngine behind this same interface; nothing in
 * the UI or route handler changes when it does.
 */
export interface DiscoveryEngine {
  runTurn(
    input: TurnInput,
    emit: (event: TurnEvent) => void,
    signal?: AbortSignal,
  ): Promise<TurnResult>;
}

const REFLECTION_PREFIX = "You said";

/**
 * Deterministic engine used for development, tests and CI. It performs no
 * analysis: it reflects the user's message and states plainly that real
 * discovery is not connected yet, so no screen can imply capability the
 * product does not have.
 */
export class ScriptedDiscoveryEngine implements DiscoveryEngine {
  constructor(private readonly deltaDelayMs = 0) {}

  async runTurn(
    input: TurnInput,
    emit: (event: TurnEvent) => void,
    signal?: AbortSignal,
  ): Promise<TurnResult> {
    const turnId = crypto.randomUUID();
    emit({ type: "turn_started", turnId });
    emit({
      type: "activity",
      kind: "analysis",
      label: "Recording your message…",
    });

    const trimmed = input.userMessage.trim();
    const preview =
      trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
    const text = [
      `${REFLECTION_PREFIX}: “${preview}”`,
      "",
      "This message is saved to the project. Discovery analysis is not connected yet, so nothing here has been interpreted, challenged or added to the project model.",
    ].join("\n");

    emit({ type: "block", kind: "plain" });

    for (const chunk of chunkText(text)) {
      if (signal?.aborted) {
        emit({
          type: "turn_failed",
          error: {
            code: "turn_interrupted",
            userMessage:
              "The response was stopped. Your message is saved; send another when you are ready.",
            recoverable: true,
          },
        });
        return { assistantText: "" };
      }
      emit({ type: "assistant_delta", text: chunk });
      if (this.deltaDelayMs > 0) await delay(this.deltaDelayMs);
    }

    emit({
      type: "actions",
      actions: [
        {
          id: "explain-reasoning",
          label: "Explain my reasoning",
          hint: "Available once discovery analysis is connected.",
        },
      ],
    });
    emit({ type: "done" });
    return { assistantText: text };
  }
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
