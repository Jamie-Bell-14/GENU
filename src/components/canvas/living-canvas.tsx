"use client";

import { useCallback, useMemo, useReducer } from "react";
import type { CanvasObject } from "@/lib/canvas/model";
import {
  buildProblemMap,
  defaultFocalObjectId,
  scopeForFocus,
  EMPTY_MAP_VIEW,
  type MapView,
} from "@/lib/canvas/problem-map";
import type { ProjectRelationship } from "@/lib/canvas/relationships";
import {
  validateScene,
  type CanvasScene,
  type ProjectScope,
} from "@/lib/canvas/scene";
import {
  canReturnToPrevious,
  initialSceneState,
  sceneReducer,
  type SceneState,
  type ViewMode,
} from "@/lib/canvas/scene-state";
import { ProblemExplorationRenderer } from "./renderers/problem-exploration";
import { StructuredInspector } from "./structured-inspector";
import type { EditSubmit } from "./object-editor";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/**
 * Scene host (docs/ADAPTIVE_CANVAS_MVP.md §4, §6, §7).
 *
 * Owns the canvas pane, the explicit visual/structured switch, scene history
 * and the validation boundary. Renderers are selected from an application-owned
 * registry keyed by the validated scene's renderer key — never by anything a
 * model supplies directly.
 */

/** Local view operations for the relationship map. */
type MapAction =
  | { type: "toggle_branch"; key: string }
  | { type: "pin"; id: string }
  | { type: "hide"; id: string }
  | { type: "reset" };

function mapViewReducer(view: MapView, action: MapAction): MapView {
  switch (action.type) {
    case "toggle_branch":
      return {
        ...view,
        collapsedBranches: view.collapsedBranches.includes(action.key)
          ? view.collapsedBranches.filter((key) => key !== action.key)
          : [...view.collapsedBranches, action.key],
      };
    case "pin":
      return {
        ...view,
        pinned: view.pinned.includes(action.id)
          ? view.pinned.filter((id) => id !== action.id)
          : [...view.pinned, action.id],
        hidden: view.hidden.filter((id) => id !== action.id),
      };
    case "hide":
      return {
        ...view,
        hidden: view.hidden.includes(action.id)
          ? view.hidden
          : [...view.hidden, action.id],
        pinned: view.pinned.filter((id) => id !== action.id),
      };
    case "reset":
      return EMPTY_MAP_VIEW;
  }
}

function EmptyCanvas() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
      <p className="text-fg-secondary text-sm">
        The canvas fills in as the conversation goes on.
      </p>
      <p className="text-fg-tertiary max-w-xs text-xs">
        It starts sparse on purpose: only what you have said, and what has been
        inferred from it, appear here.
      </p>
    </div>
  );
}

export function LivingCanvas({
  objects,
  relationships = [],
  initialScene = null,
  loading = false,
  error = null,
  onEdit,
}: Readonly<{
  objects: CanvasObject[];
  relationships?: ProjectRelationship[];
  initialScene?: CanvasScene | null;
  loading?: boolean;
  error?: string | null;
  /**
   * Saves edited wording. Editing lives in the structured inspector
   * (docs/ADAPTIVE_CANVAS_MVP.md §4.4), so the visual map never mutates text.
   */
  onEdit?: EditSubmit;
}>) {
  /*
    When no scene is supplied, the host derives one for the active problem and
    puts it through the same validation as any other scene, so the default view
    is never an unvalidated special case.
  */
  const derivedScene = useMemo(() => {
    if (initialScene) return initialScene;
    const focalObjectId = defaultFocalObjectId(objects, relationships);
    if (!focalObjectId) return null;
    const { objectIds, relationshipIds } = scopeForFocus(
      objects,
      relationships,
      focalObjectId,
    );
    const result = validateScene(
      {
        renderer: "problem_exploration",
        purpose: "explore_problem",
        focalObjectId,
        visibleObjectIds: objectIds,
        visibleRelationshipIds: relationshipIds,
        emphasis: "none",
        reason: "Showing the problem currently being explored.",
        transition: "preserve",
      },
      {
        objectIds: new Set(objects.map((object) => object.id)),
        relationshipIds: new Set(
          relationships.map((relationship) => relationship.id),
        ),
      },
    );
    return result.ok ? result.scene : null;
  }, [initialScene, objects, relationships]);

  const [sceneState, dispatchScene] = useReducer(
    sceneReducer,
    derivedScene,
    initialSceneState,
  );
  const [mapView, dispatchMap] = useReducer(mapViewReducer, EMPTY_MAP_VIEW);

  // Everything the caller loaded under RLS: the outer bound of what any scene
  // may reference.
  const scope: ProjectScope = useMemo(
    () => ({
      objectIds: new Set(objects.map((object) => object.id)),
      relationshipIds: new Set(
        relationships.map((relationship) => relationship.id),
      ),
    }),
    [objects, relationships],
  );

  /**
   * Builds and validates a user-initiated scene. User intent still goes
   * through the same validation boundary as a model recommendation — the
   * boundary is about what may be rendered, not about who asked.
   */
  const focusOn = useCallback(
    (objectId: string) => {
      const { objectIds, relationshipIds } = scopeForFocus(
        objects,
        relationships,
        objectId,
      );
      const object = objects.find((candidate) => candidate.id === objectId);
      const result = validateScene(
        {
          renderer: "problem_exploration",
          purpose: "explore_problem",
          focalObjectId: objectId,
          visibleObjectIds: objectIds,
          visibleRelationshipIds: relationshipIds,
          emphasis: "none",
          reason: object
            ? `Showing how ${object.title} connects to the project.`
            : "Showing the selected object's relationships.",
          transition: "replace",
        },
        scope,
      );
      if (!result.ok) {
        dispatchScene({ type: "scene_rejected", rejection: result.rejection });
        return;
      }
      dispatchScene({ type: "user_scene", scene: result.scene });
      dispatchMap({ type: "reset" });
      dispatchScene({ type: "set_view", view: "visual" });
    },
    [objects, relationships, scope],
  );

  const scene = sceneState.current;
  const map = useMemo(
    () =>
      buildProblemMap(
        objects,
        // Only relationships this scene declares visible are laid out.
        scene
          ? relationships.filter((relationship) =>
              scene.visibleRelationshipIds.includes(relationship.id),
            )
          : [],
        scene?.focalObjectId ?? null,
        mapView,
      ),
    [objects, relationships, scene, mapView],
  );

  const showVisual = sceneState.view === "visual";

  return (
    <section
      id="canvas-pane"
      aria-label="Living canvas"
      tabIndex={-1}
      className="bg-surface-canvas flex h-full min-h-0 flex-col"
    >
      <div className="border-edge-subtle flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3">
        <h2 className="text-fg-secondary text-xs font-medium tracking-wide uppercase">
          Project canvas
        </h2>
        <div className="flex items-center gap-2">
          {canReturnToPrevious(sceneState) && showVisual && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => dispatchScene({ type: "return_to_previous" })}
            >
              Return to previous
            </Button>
          )}
          <ToggleGroup
            type="single"
            value={sceneState.view}
            onValueChange={(value) =>
              value &&
              dispatchScene({ type: "set_view", view: value as ViewMode })
            }
            aria-label="Canvas representation"
          >
            <ToggleGroupItem value="visual">Visual view</ToggleGroupItem>
            <ToggleGroupItem value="structured">
              Structured view
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {/* Queued recommendations are announced, never applied under the
          cursor (docs/ADAPTIVE_CANVAS_MVP.md §7). */}
      <div aria-live="polite">
        {sceneState.queued && (
          <div className="border-edge-subtle bg-surface-secondary flex items-center justify-between gap-2 border-b px-3 py-2">
            <p className="text-fg-secondary text-xs">
              Canvas updated · {sceneState.queued.reason}
            </p>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="xs"
                onClick={() => dispatchScene({ type: "accept_queued" })}
              >
                Show it
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => dispatchScene({ type: "dismiss_queued" })}
              >
                Stay here
              </Button>
            </div>
          </div>
        )}
        {sceneState.lastRejection && (
          <p
            role="alert"
            className="text-state-error border-edge-subtle border-b px-3 py-2 text-xs"
          >
            {sceneState.lastRejection.message} The current view is unchanged.
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p
            role="alert"
            className="text-state-error border-risk-edge bg-risk-subtle m-3 rounded-md border p-3 text-sm"
          >
            {error}
          </p>
        ) : loading ? (
          <p className="text-fg-tertiary p-3 text-sm">
            Loading the project model…
          </p>
        ) : objects.length === 0 ? (
          <EmptyCanvas />
        ) : showVisual ? (
          <ProblemExplorationRenderer
            map={map}
            pinned={mapView.pinned}
            emphasis={scene?.emphasis ?? "none"}
            operations={{
              onFocus: focusOn,
              onToggleBranch: (key) =>
                dispatchMap({ type: "toggle_branch", key }),
              onPin: (id) => dispatchMap({ type: "pin", id }),
              onHide: (id) => dispatchMap({ type: "hide", id }),
              onRecentre: () => dispatchMap({ type: "reset" }),
              onInspect: () =>
                dispatchScene({ type: "set_view", view: "structured" }),
            }}
          />
        ) : (
          <StructuredInspector
            objects={objects}
            onFocusObject={focusOn}
            onEdit={onEdit}
          />
        )}
      </div>
    </section>
  );
}

export type { SceneState };
