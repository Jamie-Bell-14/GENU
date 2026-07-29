"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { TurnStatus } from "@/lib/services/turn-status";
import {
  turnReducer,
  INITIAL_TURN_STATE,
  type ActivityLine,
  type ContextualAction,
  type Message,
  type SafeError,
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
  /** A direction is in flight; the control is disabled until it resolves. */
  directionPending: boolean;
  onAction: (action: ContextualAction) => void;
}

/**
 * Catch-up polling. Bounded on purpose: a turn that is still finishing gets a
 * few chances to land, and after that the interface says what it knows rather
 * than waiting indefinitely.
 */
const CATCH_UP_ATTEMPTS = 4;
const CATCH_UP_DELAY_MS = 400;

interface CatchUpResponse {
  status: TurnStatus;
  activity?: ActivityLine[];
  message?: Message | null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DIRECTION_UNAVAILABLE: SafeError = {
  code: "engine_unavailable",
  userMessage:
    "Your direction could not be recorded, so it has not been applied. Your text is unchanged — try again.",
  recoverable: true,
};

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
  const [directionPending, setDirectionPending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  /** Set only by the Stop control, so a deliberate stop is never mistaken for
   *  a dropped connection — they need different recoveries. */
  const stoppedRef = useRef(false);
  /** Mirrors `state.recovering` for the guard, which cannot read state. */
  const recoveringRef = useRef(false);

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

  /**
   * Recovers a turn whose stream was lost.
   *
   * The byte stream cannot be resumed, but everything that mattered was
   * recorded under the turn id, so the client asks what the server actually
   * holds. Two things it must not do: conclude "the turn produced nothing"
   * from a single read taken while the server is still finishing, and report a
   * failed lookup as a failed turn. So it polls a bounded number of times
   * while the server says the turn is still running, and reports a lookup
   * failure as exactly that.
   */
  const catchUp = useCallback(
    async (turnId: string) => {
      recoveringRef.current = true;
      try {
        if (isDemo) {
          // The dev endpoints persist nothing, so there is nothing to recover
          // and the state says so rather than implying a lost result exists.
          dispatch({
            type: "recovered",
            outcome: "unfinished",
            activityLog: [],
            message: null,
          });
          return;
        }

        for (let attempt = 0; attempt < CATCH_UP_ATTEMPTS; attempt += 1) {
          if (attempt > 0) await wait(CATCH_UP_DELAY_MS * attempt);
          let payload: CatchUpResponse | null = null;
          try {
            const response = await fetch(
              `/api/projects/${projectId}/turns/${turnId}`,
              { cache: "no-store" },
            );
            if (response.ok)
              payload = (await response.json()) as CatchUpResponse;
          } catch {
            payload = null;
          }

          if (!payload || payload.status === "lookup_failed") {
            // Try again: a failed read says nothing about the turn.
            continue;
          }
          // Still finishing — wait rather than declaring it produced nothing.
          if (payload.status === "running" && attempt < CATCH_UP_ATTEMPTS - 1) {
            continue;
          }

          dispatch({
            type: "recovered",
            outcome: payload.message ? "completed" : "unfinished",
            activityLog: payload.activity ?? [],
            message: payload.message ?? null,
          });
          return;
        }

        // Every attempt failed to reach a usable answer.
        dispatch({
          type: "recovered",
          outcome: "lookup_failed",
          activityLog: [],
          message: null,
        });
      } finally {
        recoveringRef.current = false;
      }
    },
    [isDemo, projectId],
  );

  const send = useCallback(async () => {
    const message = draft.trim();
    // Guard against rapid double-submits racing the state update, and against
    // starting a new turn while the previous one is still being recovered.
    if (!message || sendingRef.current || recoveringRef.current) return;
    sendingRef.current = true;
    stoppedRef.current = false;

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
    let turnId: string | null = null;
    let completed = false;
    /* Without a turn id there is nothing to look up, and saying the turn did
       not finish is the only honest answer. */
    const recover = async (id: string | null) =>
      id
        ? catchUp(id)
        : dispatch({
            type: "recovered",
            outcome: "unfinished",
            activityLog: [],
            message: null,
          });

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
        for (const event of events) {
          if (event.type === "turn_started") turnId = event.turnId;
          if (event.type === "done" || event.type === "turn_failed") {
            completed = true;
          }
          dispatch({ type: "event", event });
        }
      }
      if (!completed) {
        // The body ended without the turn resolving: the connection was lost,
        // not the turn finished. Partial text is discarded and the server is
        // asked what it actually recorded.
        dispatch({ type: "connection_lost" });
        await recover(turnId);
        return;
      }
      dispatch({ type: "event", event: { type: "done" } });
    } catch (error) {
      if ((error as Error).name === "AbortError" && stoppedRef.current) {
        // Deliberate: the partial answer is discarded rather than presented as
        // a finished one, and the user's message stays.
        dispatch({ type: "turn_stopped" });
      } else if ((error as Error).name === "AbortError") {
        // Aborted without the Stop control — the component unmounted.
        dispatch({ type: "turn_stopped" });
      } else {
        dispatch({ type: "connection_lost" });
        await recover(turnId);
      }
    } finally {
      sendingRef.current = false;
      abortRef.current = null;
      stoppedRef.current = false;
    }
  }, [catchUp, draft, turnsEndpoint]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    abortRef.current?.abort();
  }, []);

  /**
   * Sends the composer text as direction for the running turn. The server
   * states what it will do with it; the interface repeats that answer rather
   * than assuming one (DESIGN.md §9.3). A refusal is shown, not swallowed.
   */
  const addDirection = useCallback(async () => {
    const note = draft.trim();
    const turnId = state.streaming?.turnId;
    if (!note || !turnId || directionPending) return;
    setDirectionPending(true);
    try {
      const response = await fetch(directionsEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ turnId, note }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        // The direction was not recorded, so nothing is claimed about it and
        // the user's text stays in the composer for a retry.
        dispatch({
          type: "direction_failed",
          error: payload?.error ?? DIRECTION_UNAVAILABLE,
        });
        return;
      }
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
      dispatch({ type: "direction_failed", error: DIRECTION_UNAVAILABLE });
    } finally {
      setDirectionPending(false);
    }
  }, [directionPending, draft, directionsEndpoint, state.streaming?.turnId]);

  const onAction = useCallback((action: ContextualAction) => {
    // Contextual actions become real in later steps; until then the row
    // explains itself rather than doing nothing silently.
    setDraft((current) => current || action.label);
  }, []);

  return {
    state,
    draft,
    setDraft,
    send,
    stop,
    addDirection,
    directionPending,
    onAction,
  };
}
