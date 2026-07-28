/**
 * The turn event vocabulary (docs/ARCHITECTURE.md §8). Every event the UI
 * consumes is emitted by application code — activity labels describe real
 * orchestration steps and are never authored by the model
 * (docs/UI_ACCEPTANCE_CRITERIA.md §7).
 */
export type ActivityKind =
  "analysis" | "research" | "model_update" | "document_update";

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
  | { type: "activity"; label: string; kind: ActivityKind }
  | { type: "assistant_delta"; text: string }
  | { type: "block"; kind: TurnBlockKind; heading?: string }
  | { type: "actions"; actions: ContextualAction[] }
  | { type: "turn_failed"; error: SafeError }
  | { type: "done" };

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  blockKind: TurnBlockKind;
  heading?: string;
  createdAt: string;
}

export interface TurnState {
  messages: Message[];
  /** Assistant text arriving for the in-flight turn, if any. */
  streaming: {
    turnId: string;
    text: string;
    blockKind: TurnBlockKind;
    heading?: string;
  } | null;
  activity: string | null;
  actions: ContextualAction[];
  error: SafeError | null;
  status: "idle" | "sending" | "streaming";
}

export const INITIAL_TURN_STATE: TurnState = {
  messages: [],
  streaming: null,
  activity: null,
  actions: [],
  error: null,
  status: "idle",
};

export type TurnAction =
  | { type: "user_message_sent"; message: Message }
  | { type: "event"; event: TurnEvent }
  | { type: "reset_error" }
  | { type: "hydrate"; messages: Message[] };

/**
 * Reduces the SSE stream into renderable state. Deliberately total: any
 * event may arrive at any time (including after a failure), and the reducer
 * never drops the user's message.
 */
export function turnReducer(state: TurnState, action: TurnAction): TurnState {
  switch (action.type) {
    case "hydrate":
      return { ...state, messages: action.messages };

    case "user_message_sent":
      return {
        ...state,
        messages: [...state.messages, action.message],
        actions: [],
        error: null,
        status: "sending",
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
          return { ...state, activity: action.event.label };

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

        case "turn_failed":
          return {
            ...state,
            error: action.event.error,
            // Partial assistant text is discarded rather than persisted as a
            // truncated answer; the user's own message stays in the stream.
            streaming: null,
            activity: null,
            status: "idle",
          };

        case "done": {
          if (!state.streaming) {
            return { ...state, status: "idle", activity: null };
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
            // Temporary activity fades; the result remains (UI acceptance §7).
            activity: null,
            status: "idle",
          };
        }
      }
  }
}
