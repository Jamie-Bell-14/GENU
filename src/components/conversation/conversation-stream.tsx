"use client";

import { useEffect, useRef } from "react";
import type { Message, TurnState } from "@/lib/ai/turn-events";
import { TurnBlock } from "./turn-block";
import { Button } from "@/components/ui/button";
import { ActivityIndicator } from "@/components/activity/activity-indicator";

/*
  Each turn is a labelled region. The label is what lets a reader — and a test
  — address "the message you wrote" as distinct from the assistant quoting it
  back, which is otherwise the same words twice on one screen.
*/
function UserTurn({ message }: Readonly<{ message: Message }>) {
  return (
    <article
      aria-label="Your turn"
      className="border-edge-subtle border-t pt-4"
    >
      <p className="text-fg-tertiary mb-1 text-xs font-medium">You</p>
      <p className="text-sm leading-relaxed whitespace-pre-wrap">
        {message.content}
      </p>
    </article>
  );
}

function AssistantTurn({
  message,
}: Readonly<{ message: Pick<Message, "content" | "blockKind" | "heading"> }>) {
  return (
    <article aria-label="Response" className="text-fg-primary">
      <TurnBlock kind={message.blockKind} heading={message.heading}>
        <span className="whitespace-pre-wrap">{message.content}</span>
      </TurnBlock>
    </article>
  );
}

export function ConversationStream({
  state,
  onCheckAgain,
  onDismissRecovery,
}: Readonly<{
  state: TurnState;
  onCheckAgain?: (turnId: string) => void;
  onDismissRecovery?: (turnId: string) => void;
}>) {
  const endRef = useRef<HTMLDivElement>(null);
  const count = state.messages.length;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [count, state.streaming?.text]);

  if (count === 0 && !state.streaming) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
        <p className="font-display text-lg font-medium">
          What problem are you trying to solve?
        </p>
        <p className="text-fg-secondary max-w-sm text-sm">
          Describe it in your own words. It does not need to be well formed yet.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      {state.messages.map((message) =>
        message.role === "user" ? (
          <UserTurn key={message.id} message={message} />
        ) : (
          <AssistantTurn key={message.id} message={message} />
        ),
      )}

      {state.streaming && state.streaming.text && (
        <AssistantTurn
          message={{
            content: state.streaming.text,
            blockKind: state.streaming.blockKind,
            heading: state.streaming.heading,
          }}
        />
      )}

      {/* Observable activity: specific, subtle, and it fades when done.
          Only ordinary analysis belongs here — research and canvas work is
          reported at the canvas instead (DESIGN.md §9.1). */}
      <div className="min-h-5">
        <ActivityIndicator activity={state.activity.conversation} />
        {state.status === "sending" && !state.activity.conversation && (
          <p className="text-fg-tertiary text-xs">Sending…</p>
        )}
      </div>

      {/* Stopping is a decision, not a failure: it is stated plainly and
          without error styling, and the partial answer is not shown. */}
      {state.stopped && (
        <p className="text-fg-tertiary text-xs">
          You stopped this response. Your message is saved.
        </p>
      )}

      {/* Recovery states, each saying only what is known, and each belonging
          to its own turn — checking one never disturbs another. A turn the
          server still reports as running has not failed, so the interface
          offers another look rather than a verdict. */}
      {state.recoveries.map((recovery) => (
        <div
          key={recovery.turnId}
          className="flex flex-wrap items-center gap-2"
        >
          <p className="text-fg-tertiary text-xs">
            {recovery.state === "checking"
              ? "The connection dropped. Checking what was recorded…"
              : recovery.state === "still_running"
                ? "The connection dropped, and that turn is still being processed. Your message is saved."
                : "The connection dropped, and that turn could not be checked just now. Your message is saved."}
          </p>
          {recovery.state !== "checking" && (
            <>
              {onCheckAgain && (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => onCheckAgain(recovery.turnId)}
                >
                  Check again
                </Button>
              )}
              {onDismissRecovery && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => onDismissRecovery(recovery.turnId)}
                >
                  Dismiss
                </Button>
              )}
            </>
          )}
        </div>
      ))}

      {state.error && (
        <p
          role="alert"
          className="text-state-error border-risk-edge bg-risk-subtle rounded-md border p-3 text-sm"
        >
          {state.error.userMessage}
        </p>
      )}

      <div ref={endRef} />
    </div>
  );
}
