"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  turnReducer,
  INITIAL_TURN_STATE,
  type ActivityLine,
  type ContextualAction,
  type Message,
  type TurnEvent,
  type TurnState,
} from "./turn-events";

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

export interface TurnRuntime {
  state: TurnState;
  draft: string;
  setDraft: (value: string) => void;
  send: () => Promise<void>;
  stop: () => void;
  addDirection: () => Promise<void>;
  onAction: (action: ContextualAction) => void;
}

/**
 * Owns the conversation turn for the whole workspace.
 *
 * This lives above both panes rather than inside the conversation because a
 * turn's output belongs to both: analysis activity is shown by the
 * conversation, canvas activity and scene recommendations by the canvas
 * (DESIGN.md §9.1). It also means switching focus mode no longer discards an
 * in-flight turn.
 */
export function useTurnRuntime({
  projectId,
  initialMessages = [],
  initialActivity = [],
}: Readonly<{
  projectId: string;
  initialMessages?: Message[];
  initialActivity?: ActivityLine[];
}>): TurnRuntime {
  const [state, dispatch] = useReducer(turnReducer, {
    ...INITIAL_TURN_STATE,
    messages: initialMessages,
    activityLog: initialActivity,
  });
  const [draft, setDraft] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  // The dev workspace review route has no project or session; it uses the
  // development-only endpoints with the same engine, events and validation.
  const isDemo = projectId === "demo";
  const turnsEndpoint = isDemo
    ? "/api/dev/turns"
    : `/api/projects/${projectId}/turns`;
  const directionsEndpoint = isDemo
    ? "/api/dev/directions"
    : `/api/projects/${projectId}/directions`;

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
      const response = await fetch(turnsEndpoint, {
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
  }, [draft, turnsEndpoint]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  /**
   * Sends the composer text as direction for the running turn. The server
   * states what it will do with it; the interface repeats that answer rather
   * than assuming one (DESIGN.md §9.3).
   */
  const addDirection = useCallback(async () => {
    const note = draft.trim();
    const turnId = state.streaming?.turnId;
    if (!note || !turnId) return;
    try {
      const response = await fetch(directionsEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ turnId, note }),
      });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        application: "applies_now" | "next_step" | "restart";
      };
      dispatch({
        type: "direction_accepted",
        note,
        application: payload.application,
      });
      setDraft("");
    } catch {
      // The direction was not recorded, so nothing is claimed about it and
      // the user's text stays in the composer for a retry.
    }
  }, [draft, directionsEndpoint, state.streaming?.turnId]);

  const onAction = useCallback((action: ContextualAction) => {
    // Contextual actions become real in later steps; until then the row
    // explains itself rather than doing nothing silently.
    setDraft((current) => current || action.label);
  }, []);

  return { state, draft, setDraft, send, stop, addDirection, onAction };
}
