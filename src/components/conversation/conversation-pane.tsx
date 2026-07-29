"use client";

import type { TurnRuntime } from "@/lib/ai/use-turn-runtime";
import { ConversationStream } from "./conversation-stream";
import { Composer } from "./composer";

/**
 * The conversation surface. Turn state is owned above it
 * (`useTurnRuntime`) because a turn's output also belongs to the canvas; this
 * component renders and drives it, and holds no stream state of its own.
 */
export function ConversationPane({
  runtime,
}: Readonly<{ runtime: TurnRuntime }>) {
  const { state } = runtime;

  return (
    <section
      id="conversation-pane"
      aria-label="Conversation"
      tabIndex={-1}
      className="bg-surface-primary flex h-full min-h-0 flex-col"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ConversationStream state={state} />
      </div>
      <Composer
        value={runtime.draft}
        onChange={runtime.setDraft}
        onSend={runtime.send}
        onStop={runtime.stop}
        onAddDirection={runtime.addDirection}
        directionPending={runtime.directionPending}
        onAction={runtime.onAction}
        state={state}
      />
    </section>
  );
}
