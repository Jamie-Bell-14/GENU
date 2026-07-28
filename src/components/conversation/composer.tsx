"use client";

import { useRef } from "react";
import { SendIcon, SquareIcon } from "lucide-react";
import type { ContextualAction, TurnState } from "@/lib/ai/turn-events";
import { MAX_MESSAGE_LENGTH } from "@/lib/validation/turns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** DESIGN.md §8.4: the composer adapts its placeholder but never moves. */
function placeholderFor(status: TurnState["status"]): string {
  return status === "streaming"
    ? "Add direction to the current response…"
    : "Ask, answer or direct the project…";
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  onAction,
  state,
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onAction: (action: ContextualAction) => void;
  state: TurnState;
}>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const busy = state.status !== "idle";
  const tooLong = value.length > MAX_MESSAGE_LENGTH;
  const canSend = value.trim().length > 0 && !busy && !tooLong;

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) onSend();
    }
  }

  return (
    <div className="border-edge-subtle bg-surface-primary border-t p-4">
      <div className="mx-auto flex max-w-(--composer-max-width) flex-col gap-2">
        {state.actions.length > 0 && (
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Suggested actions"
          >
            {state.actions.map((action) => (
              <Button
                key={action.id}
                variant="outline"
                size="sm"
                title={action.hint}
                onClick={() => onAction(action)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Message"
            aria-invalid={tooLong || undefined}
            placeholder={placeholderFor(state.status)}
            rows={2}
            className="max-h-40 min-h-16 flex-1 resize-y"
          />
          {state.status === "streaming" ? (
            <Button variant="outline" onClick={onStop}>
              <SquareIcon data-icon="inline-start" aria-hidden />
              Stop
            </Button>
          ) : (
            <Button onClick={onSend} disabled={!canSend} aria-busy={busy}>
              <SendIcon data-icon="inline-start" aria-hidden />
              Send
            </Button>
          )}
        </div>

        {tooLong && (
          <p role="alert" className="text-state-error text-xs">
            This message is{" "}
            {(value.length - MAX_MESSAGE_LENGTH).toLocaleString("en-GB")}{" "}
            characters over the limit. Shorten it to send.
          </p>
        )}
      </div>
    </div>
  );
}
