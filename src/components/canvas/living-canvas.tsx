"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { activitySurface, type ActivityLine } from "@/lib/ai/turn-events";
import { ActivityIndicator } from "@/components/activity/activity-indicator";
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
import type { ResearchFinding, ResearchSource } from "@/lib/research/types";
import { EvidenceResearchRenderer } from "./renderers/evidence-research";
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
  recommendedScene = null,
  activeResearch = null,
  unavailableSources = [],
  activity = null,
  loading = false,
  error = null,
  onEdit,
  onReviewProposal,
}: Readonly<{
  objects: CanvasObject[];
  relationships?: ProjectRelationship[];
  initialScene?: CanvasScene | null;
  /**
   * A scene the running turn recommended, tagged with the turn that produced
   * it (issue #13, T10 exit gate). It has already passed server-side
   * validation; the host validates it again against the ids it actually
   * rendered, because the boundary belongs to whatever is about to draw.
   */
  recommendedScene?: { scene: CanvasScene; turnId: string } | null;
  /**
   * The current research finding (T10), for the `evidence_research`
   * renderer. Not part of `CanvasScene`: it is ephemeral, pre-evidence
   * content, never a project object a scene could name
   * (docs/AI_SYSTEM.md §9).
   */
  activeResearch?: ResearchFinding | null;
  /** Sources research has reported unavailable this session (T10 edge case). */
  unavailableSources?: { source: ResearchSource; reason: string }[];
  /** Research and canvas activity for the running turn (DESIGN.md §9.1). */
  activity?: ActivityLine | null;
  loading?: boolean;
  error?: string | null;
  /**
   * Saves edited wording. Editing lives in the structured inspector
   * (docs/ADAPTIVE_CANVAS_MVP.md §4.4), so the visual map never mutates text.
   */
  onEdit?: EditSubmit;
  /**
   * Opens the focused before/after proposal review (T11,
   * docs/ADAPTIVE_CANVAS_MVP.md §4.3). Only offered while the canvas is in
   * its impact-review emphasis state; omit where there is nothing pending to
   * review.
   */
  onReviewProposal?: () => void;
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

  /*
    A project can go from empty to populated while the user watches: the first
    turn writes the first objects, and the scene derived from them cannot exist
    until they do. `useReducer` does not re-run its initialiser when the derived
    value changes, so without this the visual view kept saying no focus was
    selected for the whole of the turn that had just created the project model.

    The default is adopted, never imposed — the reducer ignores it once any scene
    is current — and it is the same application-derived, validated scene as on
    first render, so nothing the model said decides what is shown.
  */
  // Read out first: the lint rule treats any `.current` as a ref, and a ref is
  // not a valid dependency.
  const hasScene = sceneState.current !== null;
  useEffect(() => {
    if (derivedScene && !hasScene) {
      dispatchScene({ type: "adopt_default", scene: derivedScene });
    }
  }, [derivedScene, hasScene]);
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

  /*
    A recommendation is queued, never applied: the scene reducer decides
    whether it even reaches the queue, and the user decides whether to take it
    (docs/ADAPTIVE_CANVAS_MVP.md §7). Re-validating here is deliberate
    duplication — the server validated against the project, this validates
    against what is actually on screen, and neither trusts the other.
  */
  const lastRecommendation = useRef<{
    scene: CanvasScene;
    turnId: string;
  } | null>(null);
  useEffect(() => {
    if (!recommendedScene) {
      /*
        Issue #13 (T10 exit gate): `recommendedScene` only ever becomes null
        because `turnReducer` cleared *its own matching turn's* entry — on
        `turn_failed`, or, since T10 review round 10's second correction, the
        moment a later research pass supersedes the receipt behind a queued
        `evidence_research` recommendation (`research_started`). Either way,
        the turn or pass that owned the last recommendation this host
        received is the one that just ended, and a copy still queued from it
        is stale. `invalidate_queued` clears it only if it is still that same
        entry — a newer recommendation the user has not acted on yet, or one
        they already accepted or dismissed, is untouched either way.
      */
      if (lastRecommendation.current) {
        dispatchScene({
          type: "invalidate_queued",
          turnId: lastRecommendation.current.turnId,
        });
        lastRecommendation.current = null;
      }
      return;
    }
    if (recommendedScene === lastRecommendation.current) return;
    lastRecommendation.current = recommendedScene;
    const result = validateScene(recommendedScene.scene, scope);
    dispatchScene(
      result.ok
        ? {
            type: "recommend_scene",
            scene: result.scene,
            turnId: recommendedScene.turnId,
          }
        : { type: "scene_rejected", rejection: result.rejection },
    );
  }, [recommendedScene, scope]);

  /*
    The queued-recommendation case above only ever retires a copy the person
    has not acted on. Once they have selected "Show it", that same scene
    moves into `sceneState.current` — and a later research pass superseding
    its receipt (`research_started` in `turn-events.ts`, clearing
    `activeResearch`) has nothing left to tell this host, because
    `recommendedScene` was already consumed and cannot become `null` a
    second time for the same recommendation. Without this, the accepted
    `evidence_research` view is never moved off, and `EvidenceResearchRenderer`
    sits on "Research is running…" indefinitely once the pass that would
    have resolved it ends without a finding (T10 review round 10, third
    correction). Scoped by the reducer itself to a `research_evidence`
    current scene, so an unrelated accepted view is never touched.
  */
  const currentResearchViewStale =
    sceneState.current?.purpose === "research_evidence" && !activeResearch;
  useEffect(() => {
    if (currentResearchViewStale) {
      dispatchScene({
        type: "retire_stale_research_view",
        fallback: derivedScene,
      });
    }
  }, [currentResearchViewStale, derivedScene]);

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
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="text-fg-secondary shrink-0 text-xs font-medium tracking-wide uppercase">
            Project canvas
          </h2>
          {/* Research and canvas work is reported here, beside the canvas it
              concerns, rather than in the conversation (DESIGN.md §9.1). */}
          <ActivityIndicator
            activity={
              activity && activitySurface(activity.kind) === "canvas"
                ? activity
                : null
            }
            className="min-w-0"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
              Canvas updated · {sceneState.queued.scene.reason}
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
        ) : showVisual && scene?.renderer === "evidence_research" ? (
          <EvidenceResearchRenderer
            finding={activeResearch}
            unavailableSources={unavailableSources}
          />
        ) : showVisual ? (
          <ProblemExplorationRenderer
            map={map}
            pinned={mapView.pinned}
            emphasis={scene?.emphasis ?? "none"}
            affectedObjectIds={
              scene?.emphasis === "impact_review" ? scene.visibleObjectIds : []
            }
            onReviewProposal={
              scene?.emphasis === "impact_review" ? onReviewProposal : undefined
            }
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
