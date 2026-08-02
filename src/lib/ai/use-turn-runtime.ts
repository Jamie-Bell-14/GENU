"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { TurnStatus } from "@/lib/services/turn-snapshot";
import type { ResearchFinding, ResearchSource } from "@/lib/research/types";
import { resolveActions } from "./contextual-actions";
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
  /** Looks again for a turn whose recovery has not concluded. */
  checkAgain: (turnId: string) => Promise<void>;
  /** Drops an unresolved recovery the user has finished with. */
  dismissRecovery: (turnId: string) => void;
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
  /**
   * The activity history could not be read. It says nothing about the turn, so
   * it never affects the outcome — only how complete the history looks.
   */
  activityUnavailable?: boolean;
  message?: Message | null;
  /**
   * The durable evidence-refusal outcome for this turn, if it has one
   * (T10 review round 4, P0-3) — recovered from `turn_runs` rather than
   * only ever available on the SSE connection that was open when the turn
   * committed.
   */
  evidenceRefusedReason?: string | null;
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
  initialResearch = null,
  initialEvidenceOutcome = null,
}: Readonly<{
  projectId: string;
  initialMessages?: Message[];
  initialActivity?: ActivityLine[];
  /**
   * A research receipt still current as of the last reload (T10 review
   * round 2, P0-A) — seeded once, the same way `initialMessages` is,
   * rather than through a dispatched action: this is what a fresh mount
   * already knows, not an event that happened during this session.
   */
  initialResearch?: {
    finding: ResearchFinding;
    /** The turn that produced it (T10 review round 3, P0-2) — see
     *  `TurnState.activeResearchTurnId`'s own doc comment. */
    turnId: string;
    unavailableSources: { source: ResearchSource; reason: string }[];
  } | null;
  /**
   * A refused "Add as evidence" still current as of the last reload
   * (T10 review round 4, P0-3) — seeded the same way `initialResearch` is:
   * this is what a fresh mount already knows about its most recent turn,
   * not a live event.
   */
  initialEvidenceOutcome?: { reason: string } | null;
}>): TurnRuntime {
  const [state, dispatch] = useReducer(turnReducer, {
    ...INITIAL_TURN_STATE,
    messages: initialMessages,
    activityLog: initialActivity,
    activeResearch: initialResearch?.finding ?? null,
    activeResearchTurnId: initialResearch?.turnId ?? null,
    evidenceOutcome: initialEvidenceOutcome
      ? { refused: true, reason: initialEvidenceOutcome.reason }
      : null,
    unavailableSources: initialResearch?.unavailableSources ?? [],
    // The action a hydrated receipt actually enables — the only contextual
    // action a fresh mount can honestly offer without a turn having run.
    actions: initialResearch ? resolveActions(["add_as_evidence"]) : [],
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
            turnId,
            outcome: "unfinished",
            activityLog: [],
            message: null,
          });
          return;
        }

        for (let attempt = 0; attempt < CATCH_UP_ATTEMPTS; attempt += 1) {
          if (attempt > 0) await wait(CATCH_UP_DELAY_MS * attempt);
          const last = attempt === CATCH_UP_ATTEMPTS - 1;
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
            // A failed read says nothing about the turn. Try again; if none of
            // them succeed, say the lookup failed — never that the turn did.
            if (last) break;
            continue;
          }

          const activityLog = payload.activity ?? [];
          const message = payload.message ?? null;

          /*
            A stored result settles it, whatever the state says. `running` with
            a persisted message means finalisation has not been recorded yet —
            the answer exists and is not discarded for that.
          */
          if (message) {
            dispatch({
              type: "recovered",
              turnId,
              outcome: "completed",
              activityLog,
              message,
            });
            /*
              Recovered exactly as the live stream would have shown it
              (T10 review round 4, P0-3): a connection lost between
              `complete_turn` committing and the client consuming its
              `evidence_refused` event must still let catch-up surface the
              same correction, not only the stored, staged wording.
            */
            if (payload.evidenceRefusedReason) {
              dispatch({
                type: "event",
                event: {
                  type: "evidence_refused",
                  reason: payload.evidenceRefusedReason,
                },
              });
            }
            return;
          }

          if (payload.status === "completed") {
            /*
              Completed with no result is not a turn that produced nothing; it
              is a view that cannot be right. Look again, and if it persists,
              report an unresolved lookup rather than inventing a verdict.
            */
            if (last) break;
            continue;
          }

          if (payload.status === "running") {
            // Still finishing. Say so; never that it did not finish.
            if (last) {
              dispatch({
                type: "recovered",
                turnId,
                outcome: "still_running",
                activityLog,
                message: null,
              });
              return;
            }
            continue;
          }

          // failed, expired or unknown: the turn is over and produced nothing.
          dispatch({
            type: "recovered",
            turnId,
            outcome: "unfinished",
            activityLog,
            message: null,
          });
          return;
        }

        // Every attempt failed to reach a usable answer.
        dispatch({
          type: "recovered",
          turnId,
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

  /**
   * Another look, on request, when recovery ended without a conclusion. The
   * turn may have finished in the meantime; nothing else can find that out.
   */
  const checkAgain = useCallback(
    async (turnId: string) => {
      /*
        Deliberately not `connection_lost`: that action belongs to the turn
        that lost its stream and would clear whatever is streaming now. Looking
        again at an older turn must leave the current one alone.
      */
      dispatch({ type: "recovery_checking", turnId });
      await catchUp(turnId);
    },
    [catchUp],
  );

  const dismissRecovery = useCallback(
    (turnId: string) => dispatch({ type: "dismiss_recovery", turnId }),
    [],
  );

  const send = useCallback(async () => {
    const message = draft.trim();
    // Guard against rapid double-submits racing the state update, and against
    // starting a new turn while the previous one is still being recovered.
    if (!message || sendingRef.current || recoveringRef.current) return;
    sendingRef.current = true;
    stoppedRef.current = false;

    const messageId = crypto.randomUUID();
    dispatch({
      type: "user_message_sent",
      message: {
        id: messageId,
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
    const recover = async (id: string | null) => {
      if (id) {
        await catchUp(id);
        return;
      }
      /*
        No turn id from the header and none from the body: the request did not
        get far enough to be identified, so nothing can be looked up. Say that
        plainly rather than returning to idle as though nothing happened.
      */
      dispatch({
        type: "event",
        event: {
          type: "turn_failed",
          // The server never named this turn, so the message's own id stands
          // in (see `Message.turnId`'s doc comment) — it cannot collide with
          // a real turn id, so it cannot wrongly clear another turn's queued
          // recommendation either.
          turnId: messageId,
          error: {
            code: "engine_unavailable",
            userMessage:
              "The connection was lost before this turn started. Your message is saved — send it again when you are ready.",
            recoverable: true,
          },
        },
      });
    };

    try {
      const response = await fetch(turnsEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // `activeFindingId` tells the server which research finding this
        // session is looking at (T10, `src/lib/research/types.ts`): nothing
        // about a research run persists server-side between turns, so
        // "Add as evidence" would otherwise have nothing to link.
        body: JSON.stringify({
          message,
          activeFindingId: state.activeResearch?.id ?? null,
        }),
        signal: controller.signal,
      });
      /*
        Take the turn id from the header before touching the body. A connection
        that dies before the first SSE frame would otherwise leave nothing to
        recover by, and the turn would vanish silently.
      */
      turnId = response.headers?.get?.("x-turn-id") ?? null;
      // Bind the message to its turn as soon as the server names it, so a
      // response recovered later still renders under this question.
      if (turnId) dispatch({ type: "turn_identified", messageId, turnId });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        /*
          A refused send stored nothing, so the optimistic message is withdrawn
          rather than left in the stream. Keeping it there while also restoring
          the draft showed the same sentence twice, and the retry then wrote a
          second copy of a message the server had already saved.
        */
        dispatch({
          type: "send_refused",
          messageId,
          error: payload?.error ?? {
            code: "engine_unavailable",
            userMessage:
              "The message could not be sent. Your text is restored below — try again.",
            recoverable: true,
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
          if (event.type === "turn_started") {
            turnId = event.turnId;
            dispatch({ type: "turn_identified", messageId, turnId });
          }
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
        dispatch({ type: "connection_lost", turnId });
        await recover(turnId);
      }
      // When `done` or `turn_failed` did arrive, the reducer has already
      // acted on it; there is nothing left to resolve here.
    } catch (error) {
      if ((error as Error).name === "AbortError" && stoppedRef.current) {
        // Deliberate: the partial answer is discarded rather than presented as
        // a finished one, and the user's message stays.
        dispatch({ type: "turn_stopped" });
      } else if ((error as Error).name === "AbortError") {
        // Aborted without the Stop control — the component unmounted.
        dispatch({ type: "turn_stopped" });
      } else if (completed) {
        /*
          The terminal frame had already arrived, so this is only the socket
          closing badly afterwards. The turn is not lost and must not be
          recovered as though it were.
        */
      } else {
        dispatch({ type: "connection_lost", turnId });
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
    checkAgain,
    dismissRecovery,
    directionPending,
    onAction,
  };
}
