"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  turnReducer,
  INITIAL_TURN_STATE,
  type ContextualAction,
  type Message,
  type TurnEvent,
} from "@/lib/ai/turn-events";
import { ConversationStream } from "./conversation-stream";
import { Composer } from "./composer";

function parseEvents(buffer: string): { events: TurnEvent[]; rest: string } {
  const events: TurnEvent[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    const line = part.trim();
    if (!line.startsWith("data:")) continue;
    try {
      events.push(JSON.parse(line.slice(5).trim()) as TurnEvent);
    } catch {
      // A malformed frame is dropped rather than crashing the stream; the
      // turn still resolves through `done` or `turn_failed`.
    }
  }
  return { events, rest };
}

export function ConversationPane({
  projectId,
  initialMessages = [],
}: Readonly<{ projectId: string; initialMessages?: Message[] }>) {
  const [state, dispatch] = useReducer(turnReducer, {
    ...INITIAL_TURN_STATE,
    messages: initialMessages,
  });
  const [draft, setDraft] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(async () => {
    const message = draft.trim();
    // Guard against rapid double-submits racing the state update.
    if (!message || sendingRef.current) return;
    sendingRef.current = true;

    dispatch({
      type: "user_message_sent",
      message: {
        id: crypto.randomUUID(),
        role: "user",
        content: message,
        blockKind: "plain",
        createdAt: new Date().toISOString(),
      },
    });
    setDraft("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // The dev workspace review route has no project or session; it uses
      // the development-only endpoint with the same engine and events.
      const endpoint =
        projectId === "demo"
          ? "/api/dev/turns"
          : `/api/projects/${projectId}/turns`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        dispatch({
          type: "event",
          event: {
            type: "turn_failed",
            error: payload?.error ?? {
              code: "engine_unavailable",
              userMessage:
                "The message could not be sent. Your text is restored below — try again.",
              recoverable: true,
            },
          },
        });
        // Failure preserves the user's input for a retry.
        setDraft(message);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseEvents(buffer);
        buffer = rest;
        for (const event of events) dispatch({ type: "event", event });
      }
      dispatch({ type: "event", event: { type: "done" } });
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        dispatch({ type: "event", event: { type: "done" } });
      } else {
        dispatch({
          type: "event",
          event: {
            type: "turn_failed",
            error: {
              code: "engine_unavailable",
              userMessage:
                "The connection was lost mid-response. Your message is saved; reload to see the stored result.",
              recoverable: true,
            },
          },
        });
      }
    } finally {
      sendingRef.current = false;
      abortRef.current = null;
    }
  }, [draft, projectId]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const onAction = useCallback((action: ContextualAction) => {
    // Contextual actions become real in later steps; until then the row
    // explains itself rather than doing nothing silently.
    setDraft((current) => current || action.label);
  }, []);

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
        value={draft}
        onChange={setDraft}
        onSend={send}
        onStop={stop}
        onAction={onAction}
        state={state}
      />
    </section>
  );
}
