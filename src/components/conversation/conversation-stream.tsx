"use client";

import { useEffect, useRef } from "react";
import type { Message, TurnState } from "@/lib/ai/turn-events";
import { TurnBlock } from "./turn-block";
import { ActivityIndicator } from "@/components/activity/activity-indicator";

function UserTurn({ message }: Readonly<{ message: Message }>) {
  return (
    <article className="border-edge-subtle border-t pt-4">
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
    <article className="text-fg-primary">
      <TurnBlock kind={message.blockKind} heading={message.heading}>
        <span className="whitespace-pre-wrap">{message.content}</span>
      </TurnBlock>
    </article>
  );
}

export function ConversationStream({ state }: Readonly<{ state: TurnState }>) {
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
