"use client";

import { EyeOffIcon, PinIcon, PinOffIcon, TargetIcon } from "lucide-react";
import {
  KIND_LABELS,
  ORIGIN_LABELS,
  SUPPORT_LABELS,
  type CanvasObject,
} from "@/lib/canvas/model";
import type { Branch, ProblemMap } from "@/lib/canvas/problem-map";
import type { ProjectRelationship } from "@/lib/canvas/relationships";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Problem-exploration relationship map (docs/ADAPTIVE_CANVAS_MVP.md §4.1).
 *
 * Hierarchy is by reasoning purpose, not uniform cards: the focal object is a
 * full editorial block, related objects are compact rows inside labelled
 * relationship branches. Every branch corresponds to a stored relationship
 * type and direction — the renderer never invents an edge.
 */

export interface MapOperations {
  onFocus: (objectId: string) => void;
  onToggleBranch: (branchKey: string) => void;
  onPin: (objectId: string) => void;
  onHide: (objectId: string) => void;
  onRecentre: () => void;
  onInspect: (objectId: string) => void;
}

function StatusLine({
  object,
  relationship,
}: Readonly<{ object: CanvasObject; relationship?: ProjectRelationship }>) {
  return (
    <span className="text-fg-tertiary flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      <span>{ORIGIN_LABELS[object.origin]}</span>
      {object.support && <span>{SUPPORT_LABELS[object.support]}</span>}
      {relationship && relationship.origin === "ai_inferred" && (
        // The relationship's own provenance, distinct from the object's.
        <span>Link inferred</span>
      )}
    </span>
  );
}

function FocalObject({
  object,
  affected,
  onInspect,
}: Readonly<{
  object: CanvasObject;
  /** Impact-review is active and this object is one the proposal names (T11). */
  affected: boolean;
  onInspect: (id: string) => void;
}>) {
  return (
    <section
      aria-label="Object in focus"
      className={cn(
        "border-edge-default bg-surface-primary rounded-md border border-l-2 p-4",
        object.origin === "ai_inferred"
          ? "border-l-assumption border-dashed"
          : "border-l-brand",
        affected && "ring-edge-focus ring-1",
      )}
    >
      <p className="text-fg-tertiary text-xs font-medium tracking-wide uppercase">
        {KIND_LABELS[object.kind]} in focus
      </p>
      <h3 className="font-display mt-1 text-lg font-medium break-words">
        {object.title}
      </h3>
      {object.detail && (
        <p className="text-fg-secondary mt-1 text-sm break-words">
          {object.detail}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <StatusLine object={object} />
        <Button
          variant="ghost"
          size="xs"
          onClick={() => onInspect(object.id)}
          aria-label={`Open ${object.title} in the structured inspector`}
        >
          Inspect
        </Button>
      </div>
    </section>
  );
}

function BranchRow({
  member,
  pinned,
  dimmed,
  onPath,
  operations,
}: Readonly<{
  member: Branch["members"][number];
  pinned: boolean;
  /**
   * Impact-review is active and this object is not one the proposal touches
   * (T11) — reduced prominence, not hidden: docs/ADAPTIVE_CANVAS_MVP.md §4.3
   * asks for unrelated context to recede, never to disappear or become
   * unreachable.
   */
  dimmed: boolean;
  /**
   * This row's own stored relationship connects two objects the proposal
   * touches (T11 review round 2, P1) — the actual path from the change to
   * an affected project area, never a synthetic one: a relationship earns
   * this mark only because it is a real, committed edge between two
   * genuinely affected objects, not because the renderer inferred a
   * connection that was never stored.
   */
  onPath: boolean;
  operations: MapOperations;
}>) {
  const { object, relationship } = member;
  return (
    <li>
      {/* Compact row, not a card: avoids the uniform card treatment
          DESIGN.md §21 and UI acceptance §4 warn against. */}
      <div
        className={cn(
          "border-edge-subtle hover:bg-surface-secondary flex items-start justify-between gap-2 border-b py-2 last:border-b-0",
          dimmed && "opacity-50",
          onPath && "border-l-edge-focus border-l-2 pl-2",
        )}
      >
        <div className="min-w-0">
          <p className="text-sm break-words">
            {object.title}
            {onPath && (
              <span className="text-fg-tertiary ml-2 text-xs font-medium tracking-wide uppercase">
                Part of this change
              </span>
            )}
          </p>
          <StatusLine object={object} relationship={relationship} />
        </div>
        <div className="flex shrink-0 gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Focus on ${object.title}`}
            onClick={() => operations.onFocus(object.id)}
          >
            <TargetIcon aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={
              pinned ? `Unpin ${object.title}` : `Pin ${object.title}`
            }
            aria-pressed={pinned}
            onClick={() => operations.onPin(object.id)}
          >
            {pinned ? <PinOffIcon aria-hidden /> : <PinIcon aria-hidden />}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Hide ${object.title}`}
            onClick={() => operations.onHide(object.id)}
          >
            <EyeOffIcon aria-hidden />
          </Button>
        </div>
      </div>
    </li>
  );
}

export function ProblemExplorationRenderer({
  map,
  pinned,
  emphasis,
  affectedObjectIds = [],
  affectedRelationshipIds = [],
  onReviewProposal,
  operations,
}: Readonly<{
  map: ProblemMap;
  pinned: string[];
  emphasis: "none" | "impact_review";
  /**
   * The proposed change's own objects (T11) — a pending proposal's actually-
   * committed targets, never inferred by the renderer itself. Ignored
   * outside `emphasis === "impact_review"`.
   */
  affectedObjectIds?: string[];
  /**
   * Stored relationships whose *both* endpoints are in `affectedObjectIds`
   * (T11 review round 2, P1) — the real path from the proposed change to the
   * project areas it touches, computed by the caller from genuine stored
   * edges only. Empty when no such edge exists; the renderer never draws a
   * path it cannot back with a real relationship.
   */
  affectedRelationshipIds?: string[];
  /**
   * Opens the focused before/after proposal review
   * (docs/ADAPTIVE_CANVAS_MVP.md §4.3: "links to the focused before/after
   * proposal review"). Only rendered while impact-review is active.
   */
  onReviewProposal?: () => void;
  operations: MapOperations;
}>) {
  if (!map.focal) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
        <p className="text-fg-secondary text-sm">
          No focus is selected for the relationship map.
        </p>
        <p className="text-fg-tertiary max-w-xs text-xs">
          Choose an object in the structured view to explore how it connects to
          the rest of the project.
        </p>
      </div>
    );
  }

  const reviewingImpact = emphasis === "impact_review";
  const isAffected = (objectId: string) => affectedObjectIds.includes(objectId);
  const isOnPath = (relationshipId: string) =>
    affectedRelationshipIds.includes(relationshipId);
  const hasBranches = map.branches.length > 0;

  return (
    <div className="flex flex-col gap-4 p-3">
      {reviewingImpact && (
        <div className="border-brand/40 bg-surface-secondary flex items-center justify-between gap-2 rounded-md border p-3">
          <p className="text-fg-secondary text-xs">
            Reviewing a proposed change. Affected objects are highlighted;
            everything else is dimmed.
          </p>
          {onReviewProposal && (
            <Button variant="outline" size="xs" onClick={onReviewProposal}>
              Review changes
            </Button>
          )}
        </div>
      )}

      <FocalObject
        object={map.focal}
        affected={reviewingImpact && isAffected(map.focal.id)}
        onInspect={operations.onInspect}
      />

      {!hasBranches ? (
        <p className="text-fg-tertiary text-xs">
          No relationships have been recorded for this object yet. Connections
          appear here once they are captured — the map never infers them from
          the layout.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {map.branches.map((branch) => (
            <section key={branch.key} aria-label={branch.label}>
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-fg-secondary text-xs font-medium tracking-wide uppercase">
                  {branch.label}
                </h4>
                <Button
                  variant="ghost"
                  size="xs"
                  aria-expanded={!branch.collapsed}
                  onClick={() => operations.onToggleBranch(branch.key)}
                >
                  {branch.collapsed ? "Expand" : "Collapse"}
                </Button>
              </div>
              {!branch.collapsed && (
                <ul className="mt-1 flex flex-col">
                  {branch.members.map((member) => (
                    <BranchRow
                      key={member.relationship.id}
                      member={member}
                      pinned={pinned.includes(member.object.id)}
                      dimmed={reviewingImpact && !isAffected(member.object.id)}
                      onPath={
                        reviewingImpact && isOnPath(member.relationship.id)
                      }
                      operations={operations}
                    />
                  ))}
                </ul>
              )}
              {branch.hiddenCount > 0 && (
                <p className="text-fg-tertiary mt-1 text-xs">
                  {branch.hiddenCount} hidden
                </p>
              )}
            </section>
          ))}
        </div>
      )}

      {map.unconnectedCount > 0 && (
        <p className="text-fg-tertiary text-xs">
          {map.unconnectedCount} other project{" "}
          {map.unconnectedCount === 1 ? "object is" : "objects are"} not
          connected to this focus. Open the structured view to see everything.
        </p>
      )}
    </div>
  );
}
