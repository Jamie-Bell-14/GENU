import { describe, expect, it } from "vitest";
import type { CanvasScene } from "./scene";
import {
  canReturnToPrevious,
  initialSceneState,
  sceneReducer,
} from "./scene-state";

function scene(id: string, transition: CanvasScene["transition"] = "replace") {
  return {
    renderer: "problem_exploration",
    purpose: "explore_problem",
    focalObjectId: id,
    visibleObjectIds: [id],
    visibleRelationshipIds: [],
    emphasis: "none",
    reason: `Focused on ${id}`,
    transition,
  } as CanvasScene;
}

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "aaaaaaaa-0000-4000-8000-000000000002";

describe("sceneReducer", () => {
  it("applies a user-requested scene immediately and records history", () => {
    let state = initialSceneState(scene(A));
    state = sceneReducer(state, { type: "user_scene", scene: scene(B) });
    expect(state.current?.focalObjectId).toBe(B);
    expect(canReturnToPrevious(state)).toBe(true);

    state = sceneReducer(state, { type: "return_to_previous" });
    expect(state.current?.focalObjectId).toBe(A);
    expect(canReturnToPrevious(state)).toBe(false);
  });

  it("queues a recommendation instead of moving content under the cursor", () => {
    let state = initialSceneState(scene(A));
    state = sceneReducer(state, { type: "recommend_scene", scene: scene(B) });
    expect(state.current?.focalObjectId).toBe(A);
    expect(state.queued?.focalObjectId).toBe(B);

    state = sceneReducer(state, { type: "accept_queued" });
    expect(state.current?.focalObjectId).toBe(B);
    expect(state.queued).toBeNull();
  });

  it("lets the user decline a recommendation and stay where they are", () => {
    let state = initialSceneState(scene(A));
    state = sceneReducer(state, { type: "recommend_scene", scene: scene(B) });
    state = sceneReducer(state, { type: "dismiss_queued" });
    expect(state.queued).toBeNull();
    expect(state.current?.focalObjectId).toBe(A);
  });

  it("ignores a recommendation that only preserves the current scene", () => {
    const state = initialSceneState(scene(A));
    const next = sceneReducer(state, {
      type: "recommend_scene",
      scene: scene(B, "preserve"),
    });
    expect(next).toBe(state);
  });

  it("leaves the current view untouched when a scene is rejected", () => {
    let state = initialSceneState(scene(A));
    state = sceneReducer(state, {
      type: "scene_rejected",
      rejection: { code: "unknown_renderer", message: "Not available." },
    });
    expect(state.current?.focalObjectId).toBe(A);
    expect(state.lastRejection?.code).toBe("unknown_renderer");
  });

  it("switches representation without changing the scene", () => {
    let state = initialSceneState(scene(A));
    state = sceneReducer(state, { type: "set_view", view: "structured" });
    expect(state.view).toBe("structured");
    expect(state.current?.focalObjectId).toBe(A);
  });

  describe("adopting a default view", () => {
    /*
      A project can go from empty to populated during a turn: the first turn
      writes the first objects, and no scene can exist until they do. Filling
      that vacancy is not the same as choosing a view.
    */
    it("fills a vacancy on a project that has just gained its first objects", () => {
      const adopted = sceneReducer(initialSceneState(null), {
        type: "adopt_default",
        scene: scene(A),
      });
      expect(adopted.current?.focalObjectId).toBe(A);
      // Nothing to return to: the project had no previous view.
      expect(adopted.history).toEqual([]);
    });

    it("never displaces a view the person is already looking at", () => {
      const chosen = initialSceneState(scene(A));
      const after = sceneReducer(chosen, {
        type: "adopt_default",
        scene: scene(B),
      });
      expect(after).toBe(chosen);
    });
  });

  it("bounds history and handles returning with nothing to return to", () => {
    let state = initialSceneState(scene(A));
    for (let i = 0; i < 15; i++) {
      state = sceneReducer(state, {
        type: "user_scene",
        scene: scene(`aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`),
      });
    }
    expect(state.history.length).toBeLessThanOrEqual(10);

    const empty = initialSceneState(null);
    expect(sceneReducer(empty, { type: "return_to_previous" })).toBe(empty);
  });
});
