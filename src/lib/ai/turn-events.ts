import type { CanvasObject } from "@/lib/canvas/model";
import type { ProjectRelationship } from "@/lib/canvas/relationships";
import type { CanvasScene } from "@/lib/canvas/scene";
import type { ResearchFinding, ResearchSource } from "@/lib/research/types";
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
 * announced when it starts and announced again when it finishes, saying
 * whether it achieved what it set out to do — so nothing that has finished
 * keeps a live indicator, and nothing that failed reads as success.
 *
 * The id is the operation's, stable across its reports, so a surface replaces
 * the running line rather than accumulating two and a replayed stream cannot
 * duplicate it.
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
 * Builds a line for one *invocation* of a step.
 *
 * The id identifies the invocation, not the step name: the same real operation
 * can happen more than once in a turn, and collapsing those would lose history
 * as soon as a turn does repeated model, research or direction work. Its
 * running and finished reports share the id, so they resolve to one entry, and
 * a stream replayed after a reconnect resolves to the same entry rather than a
 * duplicate.
 */
export function activityLineFor(
  operationId: string,
  step: ActivityStep,
  state: ActivityState,
  at?: string,
): ActivityLine {
  return {
    id: operationId,
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
    | "engine_unavailable"
    | "research_source_unavailable";
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
   *
   * Carries the turn's own id (issue #13, T10 exit gate): a recommendation
   * queued on the client has to be traceable to the turn that produced it, so
   * a *different* turn's later failure can never invalidate it.
   */
  | { type: "scene_recommended"; scene: CanvasScene; turnId: string }
  /**
   * Research activity for the running turn (docs/ARCHITECTURE.md §9, T10).
   * Sources and the failed one stream as they are found; the finding replaces
   * them once research completes. None of this is project truth — it is
   * ephemeral, pre-evidence content, kept out of `CanvasScene` on purpose
   * (docs/AI_SYSTEM.md §9: a scene may only name existing project objects).
   */
  | { type: "research_source"; source: ResearchSource }
  | { type: "research_failed_source"; source: ResearchSource; reason: string }
  | { type: "research_finding"; finding: ResearchFinding }
  /**
   * A research pass has begun (T10 review round 2, P0-D). Marks the point at
   * which whatever the previous pass left behind — its finding, its
   * unavailable sources — stops being current: a second pass that itself
   * produces nothing (all sources unavailable, stopped) must not leave a
   * stale receipt from an earlier pass still answerable to "Add as
   * evidence".
   */
  | { type: "research_started" }
  /**
   * A direction the direction endpoint already told the user would be
   * applied could not actually be honoured by the research in progress
   * (T10 review round 2, P0-D) — the provider's own answer, not a guess.
   * Distinct from silence: the promise made when the direction was accepted
   * has to be corrected, not merely left unconfirmed forever.
   */
  | { type: "direction_rejected"; note: string; reason: string }
  /**
   * The project model after a turn's accepted writes, re-read by the
   * application from its own tables.
   *
   * Not model-authored render data: the objects here are built by
   * `loadCanvasObjects` from stored rows, so a turn can cause a refresh but
   * cannot describe what appears. Without this event an assumption recorded
   * during a turn only shows after a reload, which makes the canvas look
   * broken at exactly the moment it is supposed to be alive
   * (VERTICAL_SLICE_SPEC Steps 2–3).
   */
  | {
      type: "project_model_updated";
      objects: CanvasObject[];
      relationships: ProjectRelationship[];
    }
  /** Emitted when the running turn actually picked the direction up. */
  | { type: "direction_applied"; note: string }
  /**
   * A staged "Add as evidence" proposal was not written when the turn
   * completed (T10 review round 3, P0-2) — the receipt was reused, its own
   * research turn never produced an answer, or a later turn has since
   * superseded it (not necessarily a research pass — any turn accepted since,
   * round 5).
   * The assistant's own reply speaks in staged, present-progressive terms
   * (see `STAGED` in `anthropic-engine.ts`) precisely because the outcome is
   * not yet known when it is written; this is that outcome, once it is,
   * surfaced durably rather than left recoverable only from audit data.
   */
  | { type: "evidence_refused"; reason: string }
  /**
   * Carries the failing turn's own id (issue #13, T10 exit gate) so the
   * reducer can clear only *that* turn's queued scene recommendation — never
   * a different turn's, whether older or newer.
   */
  | { type: "turn_failed"; turnId: string; error: SafeError }
  | { type: "done" };

/**
 * The subset an engine may emit.
 *
 * Scene recommendations and direction receipts are application-owned. So is
 * `done`: an engine finishing its work is not the same as the turn having
 * succeeded, because the host still has to persist the result and record the
 * outcome — and once the interface has been told a turn is done, a later
 * storage failure cannot honestly take that back. The engine returns its
 * result; the host decides the turn is over.
 */
export type EngineEvent = Exclude<
  TurnEvent,
  | { type: "scene_recommended" }
  | { type: "direction_applied" }
  | { type: "done" }
  /*
   * Research events are emitted by the host's `runResearch` orchestration
   * (turn-hooks.ts), which alone knows a provider event actually happened —
   * an engine only ever awaits `hooks.runResearch(...)` and reacts to its
   * outcome, the same boundary `recommendScene` already draws.
   */
  | { type: "research_source" }
  | { type: "research_failed_source" }
  | { type: "research_finding" }
  | { type: "research_started" }
  | { type: "direction_rejected" }
  /*
   * Only the host knows what `complete_turn` actually did with a staged
   * "Add as evidence" proposal — the engine is never told (see `STAGED`),
   * so it cannot be the one to announce a refusal either.
   */
  | { type: "evidence_refused" }
>;

export interface Message {
  id: string;
  /**
   * The turn this message belongs to.
   *
   * Attribution cannot be positional. A recovered answer arrives after later
   * messages have already been sent, so appending it to a flat list would show
   * it as the response to whatever question happens to precede it. The turn id
   * is what keeps a response with its own question.
   *
   * Absent only on a user message between being sent and the server naming its
   * turn; the message's own id stands in until then.
   */
  turnId?: string;
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

export interface PendingRecovery {
  turnId: string;
  /**
   * `unfinished` is a conclusion about *this* turn and lives here rather than
   * in `state.error` for the same reason the list exists at all: a global
   * error field cannot say which turn it belongs to, so an older turn's
   * verdict would appear against a newer one — and resolving the older turn
   * would clear an error the newer turn or a direction had raised.
   */
  state: "checking" | "still_running" | "unavailable" | "unfinished";
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
  /**
   * The most recent validated scene recommendation, for the canvas host, with
   * the id of the turn that produced it (issue #13: the only way a later
   * `turn_failed` can be checked against the recommendation it actually
   * belongs to, rather than clearing whatever happens to be queued).
   */
  recommendedScene: { scene: CanvasScene; turnId: string } | null;
  /**
   * The research finding this session's most recent research produced, if
   * any (T10). Deliberately not cleared when its turn ends: "Add as evidence"
   * is a *later* turn's action, and this is this client's own record of which
   * finding that later turn concerns while it composes the request (T10
   * review round 6, P1) — the server durably holds the receipt itself
   * (`research_findings`) and re-hydrates the eligible one on reload
   * (`loadLatestResearchReceipt`), but not which one *this* client last saw,
   * so the request still has to name it. The server independently re-checks
   * the named receipt's own currency before trusting it (`complete_turn`),
   * so a stale value sent here is refused, not silently accepted.
   */
  activeResearch: ResearchFinding | null;
  /**
   * The turn that produced `activeResearch`, so its currency can be checked
   * the same way reload hydration already checks it (T10 review round 3,
   * P0-2; see `loadLatestResearchReceipt` in `project-model-store.ts`): a
   * receipt stays addable only while the turn that produced it is still the
   * most recent thing that happened. Set whenever `activeResearch` is —
   * including for a receipt seeded from reload hydration, which starts
   * current by construction and is retired the same way a live one is: the
   * moment any *other* turn is accepted (T10 review round 5 — retirement
   * happens on `turn_identified`, as soon as the server has genuinely
   * stored a new turn's message, not only once that turn later completes;
   * a later turn that is accepted and then itself fails, is stopped, or
   * expires unfinished still retires this receipt, since the conversation
   * has already moved on).
   */
  activeResearchTurnId: string | null;
  /**
   * Sources research has reported unavailable this session (T10 edge case),
   * oldest first. Kept for the same reason `activityLog` is: a source that
   * failed is as real an event as one that succeeded, and the research view
   * should be able to show it plainly rather than only alluding to it in a
   * finding's own limitations text.
   */
  unavailableSources: { source: ResearchSource; reason: string }[];
  /**
   * Why a staged "Add as evidence" proposal was not written, once
   * `complete_turn` has actually decided that (T10 review round 3, P0-2).
   * Cleared on the next message so an old refusal cannot linger against a
   * conversation that has moved on.
   */
  evidenceOutcome: { refused: true; reason: string } | null;
  /**
   * The project model as last re-read by the server during this session; null
   * until a turn changes something, when the server-rendered props still stand.
   */
  projectModel: {
    objects: CanvasObject[];
    relationships: ProjectRelationship[];
  } | null;
  /**
   * Steering the user added to the running turn. `applied` separates the
   * promise made when it was accepted from the moment the turn actually used
   * it, so the interface never claims the second before it happens.
   */
  direction: {
    note: string;
    application: DirectionApplication;
    applied: boolean;
    /**
     * Set when the research provider itself said this direction could not
     * be applied to the pass in progress (T10 review round 2, P0-D) — takes
     * priority over the generic promise text once present, because that
     * promise did not hold.
     */
    rejectedReason?: string;
  } | null;
  error: SafeError | null;
  /**
   * The user stopped the turn. Distinct from `error`: stopping is a deliberate
   * act, not a failure, and the partial answer is discarded rather than
   * presented as complete.
   */
  stopped: boolean;
  /**
   * Lost streams being recovered, keyed by their own turn.
   *
   * A list rather than a slot: an unresolved turn outlives the one that is
   * streaming now, so a single slot would either be destroyed by the next turn
   * or destroy it. Every action here names the turn it concerns, so checking
   * or resolving an older turn cannot touch a newer one.
   *
   * `checking` is active polling; the other two are honest dead ends that
   * offer another look rather than a conclusion — a turn the server still
   * reports as running has *not* failed, and a lookup that could not be
   * completed says nothing about the turn at all.
   */
  recoveries: PendingRecovery[];
  status: "idle" | "sending" | "streaming";
}

export const INITIAL_TURN_STATE: TurnState = {
  messages: [],
  streaming: null,
  activity: NO_ACTIVITY,
  activityLog: [],
  actions: [],
  recommendedScene: null,
  activeResearch: null,
  activeResearchTurnId: null,
  unavailableSources: [],
  evidenceOutcome: null,
  projectModel: null,
  direction: null,
  error: null,
  stopped: false,
  recoveries: [],
  status: "idle",
};

export type TurnAction =
  | { type: "user_message_sent"; message: Message }
  /**
   * The server refused the send and saved nothing, so the optimistic message is
   * withdrawn.
   *
   * Distinct from `turn_failed`, which describes a turn that really started: a
   * refusal leaves the text in the composer for a retry, and a message that
   * stayed in the stream as well would be the same sentence twice — then twice
   * again in the database once the retry succeeded.
   */
  | { type: "send_refused"; messageId: string; error: SafeError }
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
  /** The server named the turn a just-sent message belongs to. */
  | { type: "turn_identified"; messageId: string; turnId: string }
  /** The stream ended unintentionally; catch-up begins for that turn. */
  | { type: "connection_lost"; turnId: string | null }
  /** Another look at an already-recorded recovery, for that turn only. */
  | { type: "recovery_checking"; turnId: string }
  /** The user has finished with an unresolved recovery. */
  | { type: "dismiss_recovery"; turnId: string }
  /** Catch-up finished: what the server actually recorded for this turn. */
  | {
      type: "recovered";
      /** Which turn this concerns; never anything else's state. */
      turnId: string;
      /**
       * How the turn really ended — or that it has not, or that the lookup
       * itself failed. `still_running` is not a failure and must never be
       * reported as one.
       */
      outcome: "completed" | "unfinished" | "still_running" | "lookup_failed";
      activityLog: ActivityLine[];
      message: Message | null;
    }
  | { type: "reset_error" }
  | { type: "hydrate"; messages: Message[]; activityLog?: ActivityLine[] };

function upsertRecovery(
  recoveries: PendingRecovery[],
  entry: PendingRecovery,
): PendingRecovery[] {
  const index = recoveries.findIndex((item) => item.turnId === entry.turnId);
  if (index === -1) return [...recoveries, entry];
  const next = [...recoveries];
  next[index] = entry;
  return next;
}

const MAX_ACTIVITY_LOG = 200;

/**
 * Merges a line into the history. One operation is reported twice — running,
 * then finished — under a single id, so the later report replaces the earlier
 * one rather than adding a second entry. Two invocations of the same step have
 * different ids and stay two entries. A stream replayed after a reconnect
 * cannot duplicate anything.
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
        // A refusal belongs to the turn that staged it; a new message means
        // the conversation has moved on from asking about that outcome.
        evidenceOutcome: null,
        /*
          `recoveries` is deliberately not cleared. An unresolved turn — one
          the server may still be finishing — stays recoverable while the user
          gets on with the next message; sending is not a decision to abandon
          it. Only resolving or dismissing it clears its entry.
        */
        status: "sending",
      };

    case "send_refused":
      return {
        ...state,
        messages: state.messages.filter(
          (message) => message.id !== action.messageId,
        ),
        error: action.error,
        streaming: null,
        activity: NO_ACTIVITY,
        status: "idle",
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

    case "connection_lost": {
      /*
        Same discard rule: nothing partial is promoted. What the server
        actually recorded is fetched instead. Only the turn that was streaming
        loses its stream — a different turn's loss must not clear this one.
      */
      const losingActive =
        action.turnId !== null && state.streaming?.turnId === action.turnId;
      return {
        ...state,
        streaming: losingActive ? null : state.streaming,
        activity: losingActive ? NO_ACTIVITY : state.activity,
        recoveries: action.turnId
          ? upsertRecovery(state.recoveries, {
              turnId: action.turnId,
              state: "checking",
            })
          : state.recoveries,
        status: losingActive ? "idle" : state.status,
      };
    }

    /*
      Looking again at an older turn. Deliberately not `connection_lost`: that
      would clear whatever is streaming now, so checking one turn would destroy
      another.
    */
    case "recovery_checking":
      return {
        ...state,
        recoveries: upsertRecovery(state.recoveries, {
          turnId: action.turnId,
          state: "checking",
        }),
      };

    case "recovered": {
      const known = new Set(state.messages.map((message) => message.id));
      /*
        Four different facts, four different things to say — and each of them
        belongs to this turn alone.

        Only `completed` resolves the recovery. The other three stay in the
        list against their own turn: "we could not find out" must never be
        reported as "your turn produced nothing", a turn the server still
        reports as running has not failed, and a turn that did not finish is a
        verdict about *that* turn and nothing else.

        `state.error` is deliberately untouched here. It is a single field with
        no turn attached, so writing a recovery's outcome into it would attach
        that outcome to whatever is on screen — and clearing it on a successful
        recovery would erase an error belonging to a newer turn or a refused
        direction. Conversation-level failures still use it; per-turn outcomes
        do not.
      */
      const recoveries =
        action.outcome === "completed"
          ? state.recoveries.filter((entry) => entry.turnId !== action.turnId)
          : upsertRecovery(state.recoveries, {
              turnId: action.turnId,
              state:
                action.outcome === "still_running"
                  ? "still_running"
                  : action.outcome === "unfinished"
                    ? "unfinished"
                    : "unavailable",
            });
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
        recoveries,
      };
    }

    case "direction_accepted":
      return {
        ...state,
        // A retry that succeeds clears the failure it replaces, so the two are
        // never shown together.
        error: null,
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

    case "turn_identified": {
      /*
        A later turn has genuinely been accepted (T10 review round 5):
        `start_turn` stores the user's message the instant a turn is
        accepted, and the server sets the `x-turn-id` response header — the
        one thing this action is dispatched from — only once that stored
        message actually exists (see `route.ts`: a refused send returns a
        plain JSON error with no such header, which dispatches
        `send_refused` instead and never reaches here). That acceptance
        alone is what retires an older receipt, regardless of whether this
        new turn goes on to succeed, fail, be stopped, or expire unfinished
        — every one of those still means the conversation has moved past
        the receipt's own turn, and none of them is undone by how this new
        turn ends. Preserved only when the send itself was refused, since
        `turn_identified` then never fires at all.
      */
      const retiringReceipt = state.activeResearchTurnId !== null;
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.messageId
            ? { ...message, turnId: action.turnId }
            : message,
        ),
        activeResearch: retiringReceipt ? null : state.activeResearch,
        activeResearchTurnId: retiringReceipt
          ? null
          : state.activeResearchTurnId,
        unavailableSources: retiringReceipt ? [] : state.unavailableSources,
      };
    }

    case "dismiss_recovery":
      return {
        ...state,
        recoveries: state.recoveries.filter(
          (entry) => entry.turnId !== action.turnId,
        ),
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
          // rendering. Nothing here touches project truth. Tagged with the
          // turn that produced it (issue #13), so a later failure can be
          // checked against the recommendation it actually belongs to.
          return {
            ...state,
            recommendedScene: {
              scene: action.event.scene,
              turnId: action.event.turnId,
            },
          };

        case "research_started":
          /*
            A new pass supersedes the last one, immediately (T10 review
            round 2, P0-D) — not only once it produces its own finding. A
            pass that produces nothing (all sources unavailable, stopped)
            must not leave an earlier pass's finding answerable to "Add as
            evidence", and its unavailable-source list belongs to *that*
            pass, not this one.
          */
          return {
            ...state,
            activeResearch: null,
            activeResearchTurnId: null,
            unavailableSources: [],
          };

        case "research_source":
          // Reported to the activity/history surfaces only.
          return state;

        case "research_failed_source":
          return {
            ...state,
            unavailableSources: [
              ...state.unavailableSources,
              { source: action.event.source, reason: action.event.reason },
            ],
          };

        case "research_finding":
          /*
            Any `research_failed_source` for this same pass already arrived
            before its finding does (the provider reports sources, then the
            finding they informed), so `unavailableSources` is already this
            pass's own list by the time this fires — replacing it wholesale
            here would either duplicate or drop nothing, so it is left as is.

            Stamped with the turn producing it (T10 review round 3, P0-2), so
            currency can later be checked against exactly that turn rather
            than assumed from being "the most recent thing in state".
          */
          return {
            ...state,
            activeResearch: action.event.finding,
            activeResearchTurnId: state.streaming?.turnId ?? null,
          };

        case "direction_rejected":
          return state.direction
            ? {
                ...state,
                direction: {
                  ...state.direction,
                  applied: false,
                  rejectedReason: action.event.reason,
                },
              }
            : state;

        case "evidence_refused":
          return {
            ...state,
            evidenceOutcome: { refused: true, reason: action.event.reason },
          };

        case "project_model_updated":
          /*
            Replaces the model the canvas is drawing from. Safe to take
            wholesale because the server built it by re-reading its own tables,
            so this is the application telling the client what it now holds —
            not the turn describing what it would like drawn.
          */
          return {
            ...state,
            projectModel: {
              objects: action.event.objects,
              relationships: action.event.relationships,
            },
          };

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
            /*
              Actions are emitted as the turn goes, so a turn that then fails
              would otherwise leave buttons belonging to work that was
              abandoned — offering the user next steps for an answer they
              never received.
            */
            actions: [],
            /*
              Issue #13 (T10 exit gate): cleared only when it is *this* turn's
              own recommendation. Without the turn-id check, a stale
              `turn_failed` — one that reaches the reducer after a newer turn
              has already recommended its own scene — would wipe out a
              recommendation that never failed. Scoping the clear to a
              matching id is what keeps "turn A fails" and "turn B owns the
              current recommendation" from being able to interfere with each
              other, whichever order their events arrive in.
            */
            recommendedScene:
              state.recommendedScene?.turnId === action.event.turnId
                ? null
                : state.recommendedScene,
            /*
              A receipt whose *own* turn fails after producing a finding
              (T10 review round 3, P0-2) is retired here rather than left
              addable: no assistant message is ever stored for a failed
              turn, so a reload at this exact point would already show no
              current receipt (`loadLatestResearchReceipt`) — live state
              matching that is the same rule, not a special case of it.

              A *different* turn failing is not handled here at all (T10
              review round 5): retirement for any other, later turn now
              happens the moment that turn is accepted (`turn_identified`),
              well before it could reach `turn_failed` — so by the time a
              different turn's failure arrives, `activeResearchTurnId` is
              already either null or this same failing turn's own id. The
              equality check below is consequently only ever true for this
              turn's own receipt.
            */
            activeResearch:
              state.activeResearchTurnId === action.event.turnId
                ? null
                : state.activeResearch,
            activeResearchTurnId:
              state.activeResearchTurnId === action.event.turnId
                ? null
                : state.activeResearchTurnId,
            unavailableSources:
              state.activeResearchTurnId === action.event.turnId
                ? []
                : state.unavailableSources,
            status: "idle",
          };

        case "done": {
          if (!state.streaming) {
            return { ...state, status: "idle", activity: NO_ACTIVITY };
          }
          const completed: Message = {
            id: state.streaming.turnId,
            turnId: state.streaming.turnId,
            role: "assistant",
            content: state.streaming.text,
            blockKind: state.streaming.blockKind,
            heading: state.streaming.heading,
            createdAt: new Date().toISOString(),
          };
          /*
            A receipt from an *earlier* turn no longer needs retiring here
            (T10 review round 5): that already happened the moment this
            turn was accepted (`turn_identified`), well before it could
            reach `done`. So if `activeResearchTurnId` is set at all by now,
            it is this same completing turn's own — set by its own
            `research_finding` earlier in this same stream — and stays,
            exactly as it should: this completion is what makes it addable
            in the first place.
          */
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
