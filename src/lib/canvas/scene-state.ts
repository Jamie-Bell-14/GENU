import type { CanvasScene, SceneRejection } from "./scene";

/**
 * Which representation the user is looking at. This is an explicit user
 * control (docs/ADAPTIVE_CANVAS_MVP.md §4.4), never chosen silently.
 */
export type ViewMode = "visual" | "structured";

export interface SceneState {
  current: CanvasScene | null;
  /** Previous scenes, most recent last, for "return to previous". */
  history: CanvasScene[];
  view: ViewMode;
  /**
   * A scene recommendation that arrived while the user was reading. It is
   * queued rather than applied so content never moves under the cursor
   * (docs/ADAPTIVE_CANVAS_MVP.md §7).
   *
   * Tagged with the turn that produced it (issue #13, T10 exit gate): the
   * only way `invalidate_queued` can tell "this queued item's own turn just
   * failed" apart from "some other turn failed", so a stale recommendation
   * disappears without ever being able to clear a different turn's live one.
   */
  queued: { scene: CanvasScene; turnId: string } | null;
  lastRejection: SceneRejection | null;
}

export function initialSceneState(scene: CanvasScene | null): SceneState {
  return {
    current: scene,
    history: [],
    view: "visual",
    queued: null,
    lastRejection: null,
  };
}

export type SceneAction =
  /**
   * The application's own default view for a project that has no scene yet.
   *
   * Needed because a project can go from empty to populated *during* a turn:
   * the first turn on a new project writes the first objects, and the scene
   * derived from them cannot exist until they do. Filling that vacancy is not
   * the same as choosing a view — it only ever applies when there is no current
   * scene, so it can never move what a person is already looking at, and it
   * records no history to return to.
   */
  | { type: "adopt_default"; scene: CanvasScene }
  /** A validated scene the user asked for: applied immediately. */
  | { type: "user_scene"; scene: CanvasScene }
  /** A validated recommendation: queued, never applied under the cursor. */
  | { type: "recommend_scene"; scene: CanvasScene; turnId: string }
  | { type: "accept_queued" }
  | { type: "dismiss_queued" }
  /**
   * The turn that produced the currently queued recommendation has failed
   * (issue #13). Clears `queued` only when its own `turnId` still matches —
   * the user may already have accepted or dismissed it, or a newer turn's
   * recommendation may already have replaced it, and neither of those is this
   * action's to undo.
   */
  | { type: "invalidate_queued"; turnId: string }
  /**
   * The currently *accepted* research view's backing receipt is gone (T10
   * review round 10, third correction): a later research pass superseded it
   * and the accepted `evidence_research` scene has nothing left to draw —
   * `EvidenceResearchRenderer` would otherwise sit on "Research is
   * running…" forever, since nothing else ever moves the canvas off a scene
   * the person already accepted. Scoped to the research purpose itself, so
   * it can never touch an unrelated current scene: the host is trusted to
   * fire it only when the backing finding has actually gone, but the guard
   * here means a caller mistake fails safe rather than clearing real content.
   */
  | { type: "retire_stale_research_view"; fallback: CanvasScene | null }
  | { type: "return_to_previous" }
  | { type: "set_view"; view: ViewMode }
  | { type: "scene_rejected"; rejection: SceneRejection };

const MAX_HISTORY = 10;

function push(history: CanvasScene[], scene: CanvasScene): CanvasScene[] {
  return [...history, scene].slice(-MAX_HISTORY);
}

export function sceneReducer(
  state: SceneState,
  action: SceneAction,
): SceneState {
  switch (action.type) {
    case "adopt_default":
      // Only ever fills a vacancy. A user's chosen scene, or one they accepted
      // from a recommendation, is never replaced by a derived default.
      if (state.current) return state;
      return { ...state, current: action.scene };

    case "user_scene":
      return {
        ...state,
        current: action.scene,
        history: state.current
          ? push(state.history, state.current)
          : state.history,
        queued: null,
        lastRejection: null,
      };

    case "recommend_scene":
      // A recommendation that preserves the current representation is not a
      // change at all, so it never interrupts.
      if (action.scene.transition === "preserve" && state.current) {
        return state;
      }
      return {
        ...state,
        queued: { scene: action.scene, turnId: action.turnId },
        lastRejection: null,
      };

    case "accept_queued":
      if (!state.queued) return state;
      return {
        ...state,
        current: state.queued.scene,
        history: state.current
          ? push(state.history, state.current)
          : state.history,
        queued: null,
      };

    case "dismiss_queued":
      return { ...state, queued: null };

    case "invalidate_queued":
      if (state.queued?.turnId !== action.turnId) return state;
      return { ...state, queued: null };

    case "retire_stale_research_view": {
      if (state.current?.purpose !== "research_evidence") return state;
      const previous = state.history.at(-1);
      return previous
        ? { ...state, current: previous, history: state.history.slice(0, -1) }
        : { ...state, current: action.fallback };
    }

    case "return_to_previous": {
      const previous = state.history.at(-1);
      if (!previous) return state;
      return {
        ...state,
        current: previous,
        history: state.history.slice(0, -1),
      };
    }

    case "set_view":
      return { ...state, view: action.view };

    case "scene_rejected":
      // A rejected scene never becomes current, and the existing view stays
      // exactly as it was.
      return { ...state, lastRejection: action.rejection };
  }
}

export function canReturnToPrevious(state: SceneState): boolean {
  return state.history.length > 0;
}
