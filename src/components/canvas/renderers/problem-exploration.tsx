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
  emphasised,
  onInspect,
}: Readonly<{
  object: CanvasObject;
  emphasised: boolean;
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
        emphasised && "ring-edge-focus ring-1",
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
  operations,
}: Readonly<{
  member: Branch["members"][number];
  pinned: boolean;
  operations: MapOperations;
}>) {
  const { object, relationship } = member;
  return (
    <li>
      {/* Compact row, not a card: avoids the uniform card treatment
          DESIGN.md §21 and UI acceptance §4 warn against. */}
      <div className="border-edge-subtle hover:bg-surface-secondary flex items-start justify-between gap-2 border-b py-2 last:border-b-0">
        <div className="min-w-0">
          <p className="text-sm break-words">{object.title}</p>
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
  operations,
}: Readonly<{
  map: ProblemMap;
  pinned: string[];
  emphasis: "none" | "impact_review";
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

  const hasBranches = map.branches.length > 0;

  return (
    <div className="flex flex-col gap-4 p-3">
      <FocalObject
        object={map.focal}
        emphasised={emphasis === "impact_review"}
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
