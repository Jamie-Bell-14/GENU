import type { CanvasScene } from "@/lib/canvas/scene";
import {
  activityLabel,
  ACTIVITY_STEPS,
  type ActivityState,
  type ActivityStep,
} from "./activity-steps";

/**
 * The turn event vocabulary (docs/ARCHITECTURE.md §8). Every event the UI
 * consumes is emitted by application code — activity labels describe real
 * orchestration steps and are never authored by the model
 * (docs/UI_ACCEPTANCE_CRITERIA.md §7).
 */
export type ActivityKind =
  "analysis" | "research" | "model_update" | "document_update";

/**
 * Where a line of activity belongs on screen (DESIGN.md §9.1): ordinary
 * analysis sits near the active turn, research and canvas work sits at the top
 * of the canvas. Placement follows from the kind, so a surface never has to
 * guess.
 */
export function activitySurface(kind: ActivityKind): "conversation" | "canvas" {
  return kind === "analysis" ? "conversation" : "canvas";
}

/**
 * One reported operation. `state` is what makes the report honest: a step is
 * announced when it starts and announced again when it finishes, so nothing
 * that has completed keeps a live indicator while other work continues.
 *
 * The id is stable across both reports of the same operation, so a surface
 * replaces the active line rather than accumulating two, and a replayed stream
 * cannot duplicate it.
 */
export interface ActivityLine {
  id: string;
  step: ActivityStep;
  state: ActivityState;
  label: string;
  kind: ActivityKind;
  /** ISO timestamp; present on persisted history, absent on live events. */
  at?: string;
}

/**
 * The line id is derived from the turn and the step rather than generated, so
 * the active and complete reports of one operation share it — and so a stream
 * replayed after a reconnect resolves to the same line instead of a duplicate.
 */
export function activityLineId(turnId: string, step: ActivityStep): string {
  return `${turnId}:${step}`;
}

export function activityLineFor(
  turnId: string,
  step: ActivityStep,
  state: ActivityState,
  at?: string,
): ActivityLine {
  return {
    id: activityLineId(turnId, step),
    step,
    state,
    label: activityLabel(step, state),
    kind: ACTIVITY_STEPS[step].kind,
    ...(at ? { at } : {}),
  };
}

/** How a mid-turn direction will be used (DESIGN.md §9.3). */
export const DIRECTION_APPLICATIONS = [
  "applies_now",
  "next_step",
  "restart",
] as const;
export type DirectionApplication = (typeof DIRECTION_APPLICATIONS)[number];

/** Stated verbatim to the user when a direction is accepted. */
export const DIRECTION_APPLICATION_MESSAGES: Record<
  DirectionApplication,
  string
> = {
  applies_now: "Your direction is being applied to the work in progress.",
  next_step: "Your direction will be applied at the next step of this turn.",
  restart: "Your direction requires restarting this task.",
};

/** Rich conversation blocks (DESIGN.md §8.1). */
export type TurnBlockKind =
  "plain" | "challenge" | "assumption" | "finding" | "proposal" | "checkpoint";

export interface ContextualAction {
  id: string;
  label: string;
  /** Short explanation for unusual actions (DESIGN.md §8.3). */
  hint?: string;
}

export interface SafeError {
  code:
    | "model_output_invalid"
    | "rate_limited"
    | "session_expired"
    | "message_too_long"
    | "turn_interrupted"
    | "engine_unavailable";
  /** What happened, what remains usable, what to do next (DESIGN.md §16). */
  userMessage: string;
  recoverable: boolean;
  retryAfterSeconds?: number;
}

export type TurnEvent =
  | { type: "turn_started"; turnId: string }
  | { type: "activity"; activity: ActivityLine }
  | { type: "assistant_delta"; text: string }
  | { type: "block"; kind: TurnBlockKind; heading?: string }
  | { type: "actions"; actions: ContextualAction[] }
  /**
   * A canvas scene the application has already validated (docs/AI_SYSTEM.md
   * §9.1). It is not in `EngineEvent`, so an engine cannot emit one: only
   * application code that has run `validateScene` against the project's own
   * ids can put a scene on this stream.
   */
  | { type: "scene_recommended"; scene: CanvasScene }
  /** Emitted when the running turn actually picked the direction up. */
  | { type: "direction_applied"; note: string }
  | { type: "turn_failed"; error: SafeError }
  | { type: "done" };

/**
 * The subset an engine may emit. Scene recommendations and direction receipts
 * are application-owned, so the type system — not a code review — is what stops
 * an engine minting them.
 */
export type EngineEvent = Exclude<
  TurnEvent,
  { type: "scene_recommended" } | { type: "direction_applied" }
>;

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  blockKind: TurnBlockKind;
  heading?: string;
  createdAt: string;
}

/**
 * The activity on show, one line per surface. A turn does analysis and canvas
 * work in sequence, so a single shared slot would leave whichever surface was
 * not last with nothing to show — each surface keeps the most recent line that
 * belongs to it, and both clear when the turn ends.
 */
export interface ActivityBySurface {
  conversation: ActivityLine | null;
  canvas: ActivityLine | null;
}

export const NO_ACTIVITY: ActivityBySurface = {
  conversation: null,
  canvas: null,
};

export interface TurnState {
  messages: Message[];
  /** Assistant text arriving for the in-flight turn, if any. */
  streaming: {
    turnId: string;
    text: string;
    blockKind: TurnBlockKind;
    heading?: string;
  } | null;
  /** Current work per surface; cleared when the turn ends. */
  activity: ActivityBySurface;
  /** Everything that happened this session, newest last. Never cleared. */
  activityLog: ActivityLine[];
  actions: ContextualAction[];
  /** The most recent validated scene recommendation, for the canvas host. */
  recommendedScene: CanvasScene | null;
  /**
   * Steering the user added to the running turn. `applied` separates the
   * promise made when it was accepted from the moment the turn actually used
   * it, so the interface never claims the second before it happens.
   */
  direction: {
    note: string;
    application: DirectionApplication;
    applied: boolean;
  } | null;
  error: SafeError | null;
  /**
   * The user stopped the turn. Distinct from `error`: stopping is a deliberate
   * act, not a failure, and the partial answer is discarded rather than
   * presented as complete.
   */
  stopped: boolean;
  /** The stream was lost unintentionally and catch-up is in progress. */
  recovering: boolean;
  status: "idle" | "sending" | "streaming";
}

export const INITIAL_TURN_STATE: TurnState = {
  messages: [],
  streaming: null,
  activity: NO_ACTIVITY,
  activityLog: [],
  actions: [],
  recommendedScene: null,
  direction: null,
  error: null,
  stopped: false,
  recovering: false,
  status: "idle",
};

export type TurnAction =
  | { type: "user_message_sent"; message: Message }
  | { type: "event"; event: TurnEvent }
  /** The direction endpoint accepted the note and stated what it will do. */
  | {
      type: "direction_accepted";
      note: string;
      application: DirectionApplication;
    }
  /** The direction endpoint refused or could not be reached. */
  | { type: "direction_failed"; error: SafeError }
  /** The user pressed Stop. */
  | { type: "turn_stopped" }
  /** The stream ended unintentionally; catch-up begins. */
  | { type: "connection_lost" }
  /** Catch-up finished: what the server actually recorded for this turn. */
  | {
      type: "recovered";
      activityLog: ActivityLine[];
      message: Message | null;
    }
  | { type: "reset_error" }
  | { type: "hydrate"; messages: Message[]; activityLog?: ActivityLine[] };

const MAX_ACTIVITY_LOG = 200;

/**
 * Merges a line into the history. One operation is reported twice — active,
 * then complete — under a single id, so the later report replaces the earlier
 * one rather than adding a second entry. That also means a stream replayed
 * after a reconnect cannot duplicate anything.
 */
function appendActivity(
  log: ActivityLine[],
  activity: ActivityLine,
): ActivityLine[] {
  const existing = log.findIndex((line) => line.id === activity.id);
  if (existing === -1) return [...log, activity].slice(-MAX_ACTIVITY_LOG);
  const next = [...log];
  next[existing] = activity;
  return next;
}

/**
 * Reduces the SSE stream into renderable state. Deliberately total: any
 * event may arrive at any time (including after a failure), and the reducer
 * never drops the user's message.
 */
export function turnReducer(state: TurnState, action: TurnAction): TurnState {
  switch (action.type) {
    case "hydrate":
      return {
        ...state,
        messages: action.messages,
        activityLog: action.activityLog ?? state.activityLog,
      };

    case "user_message_sent":
      return {
        ...state,
        messages: [...state.messages, action.message],
        actions: [],
        direction: null,
        error: null,
        stopped: false,
        recovering: false,
        status: "sending",
      };

    /*
      Stopping discards whatever text had arrived. A truncated answer must not
      be presented as a completed one, and the reducer is the only place that
      could turn streamed text into a message, so this is where the rule
      belongs. The user's own message stays.
    */
    case "turn_stopped":
      return {
        ...state,
        streaming: null,
        activity: NO_ACTIVITY,
        stopped: true,
        status: "idle",
      };

    case "connection_lost":
      // Same discard rule: nothing partial is promoted. What the server
      // actually recorded is fetched instead.
      return {
        ...state,
        streaming: null,
        activity: NO_ACTIVITY,
        recovering: true,
        status: "idle",
      };

    case "recovered": {
      const known = new Set(state.messages.map((message) => message.id));
      return {
        ...state,
        activityLog: action.activityLog.reduce(
          appendActivity,
          state.activityLog,
        ),
        messages:
          action.message && !known.has(action.message.id)
            ? [...state.messages, action.message]
            : state.messages,
        recovering: false,
        error: action.message
          ? null
          : {
              code: "turn_interrupted",
              userMessage:
                "The connection dropped and this turn did not finish. Your message is saved — send another when you are ready.",
              recoverable: true,
            },
      };
    }

    case "direction_accepted":
      return {
        ...state,
        direction: {
          note: action.note,
          application: action.application,
          applied: false,
        },
      };

    // A refused direction is not a failed turn: the turn keeps running and
    // only the direction is reported as not recorded.
    case "direction_failed":
      return { ...state, error: action.error };

    case "reset_error":
      return { ...state, error: null };

    case "event":
      switch (action.event.type) {
        case "turn_started":
          return {
            ...state,
            status: "streaming",
            streaming: {
              turnId: action.event.turnId,
              text: "",
              blockKind: "plain",
            },
          };

        case "activity":
          return {
            ...state,
            activity: {
              ...state.activity,
              [activitySurface(action.event.activity.kind)]:
                action.event.activity,
            },
            activityLog: appendActivity(
              state.activityLog,
              action.event.activity,
            ),
          };

        case "block":
          return state.streaming
            ? {
                ...state,
                streaming: {
                  ...state.streaming,
                  blockKind: action.event.kind,
                  heading: action.event.heading,
                },
              }
            : state;

        case "assistant_delta":
          return state.streaming
            ? {
                ...state,
                streaming: {
                  ...state.streaming,
                  text: state.streaming.text + action.event.text,
                },
              }
            : state;

        case "actions":
          // DESIGN.md §8.3: never more than three suggested actions.
          return { ...state, actions: action.event.actions.slice(0, 3) };

        case "scene_recommended":
          // Held for the canvas host, which applies its own validation before
          // rendering. Nothing here touches project truth.
          return { ...state, recommendedScene: action.event.scene };

        case "direction_applied":
          return state.direction
            ? { ...state, direction: { ...state.direction, applied: true } }
            : state;

        case "turn_failed":
          return {
            ...state,
            error: action.event.error,
            // Partial assistant text is discarded rather than persisted as a
            // truncated answer; the user's own message stays in the stream.
            streaming: null,
            activity: NO_ACTIVITY,
            status: "idle",
          };

        case "done": {
          if (!state.streaming) {
            return { ...state, status: "idle", activity: NO_ACTIVITY };
          }
          const completed: Message = {
            id: state.streaming.turnId,
            role: "assistant",
            content: state.streaming.text,
            blockKind: state.streaming.blockKind,
            heading: state.streaming.heading,
            createdAt: new Date().toISOString(),
          };
          return {
            ...state,
            messages: completed.content
              ? [...state.messages, completed]
              : state.messages,
            streaming: null,
            // Temporary activity fades; the result and the retrievable history
            // remain (UI acceptance §7).
            activity: NO_ACTIVITY,
            status: "idle",
          };
        }
      }
  }
}
