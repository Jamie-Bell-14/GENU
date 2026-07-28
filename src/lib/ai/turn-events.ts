import type { CanvasScene } from "@/lib/canvas/scene";

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

export interface ActivityLine {
  id: string;
  label: string;
  kind: ActivityKind;
  /** ISO timestamp; present on persisted history, absent on live events. */
  at?: string;
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
  | { type: "reset_error" }
  | { type: "hydrate"; messages: Message[]; activityLog?: ActivityLine[] };

const MAX_ACTIVITY_LOG = 200;

function appendActivity(
  log: ActivityLine[],
  activity: ActivityLine,
): ActivityLine[] {
  // Re-delivered lines (a reconnect replaying part of a stream) must not
  // duplicate in the history panel.
  if (log.some((line) => line.id === activity.id)) return log;
  return [...log, activity].slice(-MAX_ACTIVITY_LOG);
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
        status: "sending",
      };

    case "direction_accepted":
      return {
        ...state,
        direction: {
          note: action.note,
          application: action.application,
          applied: false,
        },
      };

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
