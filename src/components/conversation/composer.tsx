"use client";

import { useRef } from "react";
import { SendIcon, SquareIcon } from "lucide-react";
import {
  DIRECTION_APPLICATION_MESSAGES,
  type ContextualAction,
  type TurnState,
} from "@/lib/ai/turn-events";
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
  onAddDirection,
  directionPending = false,
  onAction,
  state,
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onAddDirection: () => void;
  /** A direction is in flight; the control is disabled until it resolves. */
  directionPending?: boolean;
  onAction: (action: ContextualAction) => void;
  state: TurnState;
}>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /*
    Recovery counts as busy. The runtime refuses a send while catch-up is in
    flight, so an enabled Send button would be a control that silently does
    nothing.
  */
  const checking = state.recoveries.some((entry) => entry.state === "checking");
  const busy = state.status !== "idle" || checking;
  const tooLong = value.length > MAX_MESSAGE_LENGTH;
  const canSend = value.trim().length > 0 && !busy && !tooLong;
  const streaming = state.status === "streaming";
  const canDirect =
    streaming && value.trim().length > 0 && !tooLong && !directionPending;

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
        {/* What happened to added direction, stated only once it is true: the
            promise while the turn runs, then whether it was actually reached
            (DESIGN.md §9.3). */}
        {state.direction && (
          <p className="text-fg-tertiary text-xs">
            {state.direction.rejectedReason
              ? state.direction.rejectedReason
              : state.direction.applied
                ? "Your direction was picked up by this turn."
                : streaming
                  ? DIRECTION_APPLICATION_MESSAGES[state.direction.application]
                  : "Your direction was recorded, but this turn had already passed its last step."}
          </p>
        )}

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
          {streaming ? (
            /* Steerable work (DESIGN.md §9.3): both controls are available
               while the turn runs, and neither moves the composer. */
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={onAddDirection}
                disabled={!canDirect}
                aria-busy={directionPending || undefined}
                title={
                  canDirect
                    ? undefined
                    : "Type the direction you want to add first."
                }
              >
                Add direction
              </Button>
              <Button variant="outline" onClick={onStop}>
                <SquareIcon data-icon="inline-start" aria-hidden />
                Stop
              </Button>
            </div>
          ) : (
            <Button onClick={onSend} disabled={!canSend} aria-busy={busy}>
              <SendIcon data-icon="inline-start" aria-hidden />
              {checking ? "Recovering…" : "Send"}
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
