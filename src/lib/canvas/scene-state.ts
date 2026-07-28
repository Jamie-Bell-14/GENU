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
   */
  queued: CanvasScene | null;
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
  /** A validated scene the user asked for: applied immediately. */
  | { type: "user_scene"; scene: CanvasScene }
  /** A validated recommendation: queued, never applied under the cursor. */
  | { type: "recommend_scene"; scene: CanvasScene }
  | { type: "accept_queued" }
  | { type: "dismiss_queued" }
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
      return { ...state, queued: action.scene, lastRejection: null };

    case "accept_queued":
      if (!state.queued) return state;
      return {
        ...state,
        current: state.queued,
        history: state.current
          ? push(state.history, state.current)
          : state.history,
        queued: null,
      };

    case "dismiss_queued":
      return { ...state, queued: null };

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
