import type { CanvasObject } from "./model";
import {
  BRANCH_ORDER,
  RELATIONSHIP_BRANCH_LABELS,
  type ProjectRelationship,
  type RelationshipType,
} from "./relationships";

/**
 * Layout grammar for the problem-exploration relationship map
 * (docs/ADAPTIVE_CANVAS_MVP.md §4.1).
 *
 * The focal object is the visual anchor; everything else is grouped into
 * branches **by stored relationship type and direction**. Nothing here derives
 * a relationship from proximity, ordering or layout — if an edge is not in
 * `relationships`, it does not appear (docs/AI_SYSTEM.md §9.2).
 */

export interface BranchMember {
  object: CanvasObject;
  relationship: ProjectRelationship;
}

export interface Branch {
  /** Stable key: relation type plus direction relative to the focal object. */
  key: string;
  relation: RelationshipType;
  direction: "outgoing" | "incoming";
  label: string;
  members: BranchMember[];
  collapsed: boolean;
  hiddenCount: number;
}

export interface ProblemMap {
  focal: CanvasObject | null;
  branches: Branch[];
  /** Objects with no stored relationship to the focal object. */
  unconnectedCount: number;
}

export interface MapView {
  collapsedBranches: string[];
  hidden: string[];
  pinned: string[];
}

export const EMPTY_MAP_VIEW: MapView = {
  collapsedBranches: [],
  hidden: [],
  pinned: [],
};

export function branchKey(
  relation: RelationshipType,
  direction: "outgoing" | "incoming",
): string {
  return `${relation}:${direction}`;
}

/**
 * Builds the map for one focal object. Only relationships with the focal
 * object as an endpoint produce branches, so the map shows one reasoning step
 * at a time rather than the whole project graph
 * (DESIGN.md §3.3: "should not display the entire project graph by default").
 */
export function buildProblemMap(
  objects: CanvasObject[],
  relationships: ProjectRelationship[],
  focalObjectId: string | null,
  view: MapView = EMPTY_MAP_VIEW,
): ProblemMap {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const focal = focalObjectId ? (byId.get(focalObjectId) ?? null) : null;
  if (!focal) {
    return { focal: null, branches: [], unconnectedCount: objects.length };
  }

  const grouped = new Map<string, BranchMember[]>();
  const connected = new Set<string>([focal.id]);

  for (const relationship of relationships) {
    const isOutgoing = relationship.fromObjectId === focal.id;
    const isIncoming = relationship.toObjectId === focal.id;
    if (!isOutgoing && !isIncoming) continue;

    const otherId = isOutgoing
      ? relationship.toObjectId
      : relationship.fromObjectId;
    const other = byId.get(otherId);
    // An endpoint the caller cannot see is skipped rather than rendered as a
    // placeholder: the map never implies an object it cannot show.
    if (!other) continue;

    connected.add(other.id);
    const direction = isOutgoing ? "outgoing" : "incoming";
    const key = branchKey(relationship.relation, direction);
    const members = grouped.get(key) ?? [];
    members.push({ object: other, relationship });
    grouped.set(key, members);
  }

  const branches: Branch[] = [];
  for (const relation of BRANCH_ORDER) {
    for (const direction of ["incoming", "outgoing"] as const) {
      const key = branchKey(relation, direction);
      const all = grouped.get(key);
      if (!all || all.length === 0) continue;

      const hiddenCount = all.filter((member) =>
        view.hidden.includes(member.object.id),
      ).length;
      const shown = all
        .filter((member) => !view.hidden.includes(member.object.id))
        .sort(
          (a, b) =>
            Number(view.pinned.includes(b.object.id)) -
            Number(view.pinned.includes(a.object.id)),
        );

      branches.push({
        key,
        relation,
        direction,
        label: RELATIONSHIP_BRANCH_LABELS[relation][direction],
        members: view.collapsedBranches.includes(key) ? [] : shown,
        collapsed: view.collapsedBranches.includes(key),
        hiddenCount,
      });
    }
  }

  return {
    focal,
    branches,
    unconnectedCount: objects.filter((object) => !connected.has(object.id))
      .length,
  };
}

/**
 * The object the map focuses on when the user has not chosen one: the active
 * problem (docs/ADAPTIVE_CANVAS_MVP.md §4.1, "The active problem is the visual
 * focus"), falling back to the most connected object, then the first object.
 */
export function defaultFocalObjectId(
  objects: CanvasObject[],
  relationships: ProjectRelationship[],
): string | null {
  if (objects.length === 0) return null;

  const subject = objects.find((object) => object.zone === "subject");
  if (subject) return subject.id;

  const degree = new Map<string, number>();
  for (const relationship of relationships) {
    for (const id of [relationship.fromObjectId, relationship.toObjectId]) {
      degree.set(id, (degree.get(id) ?? 0) + 1);
    }
  }
  const ranked = objects
    .filter((object) => degree.has(object.id))
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));

  return ranked[0]?.id ?? objects[0].id;
}

/**
 * Objects and relationships a scene should declare visible for a focal object.
 * Used to build user-initiated scenes so they pass the same validation as any
 * other scene.
 */
export function scopeForFocus(
  objects: CanvasObject[],
  relationships: ProjectRelationship[],
  focalObjectId: string,
): { objectIds: string[]; relationshipIds: string[] } {
  const objectIds = new Set<string>([focalObjectId]);
  const relationshipIds: string[] = [];
  const known = new Set(objects.map((object) => object.id));

  for (const relationship of relationships) {
    const isOutgoing = relationship.fromObjectId === focalObjectId;
    const isIncoming = relationship.toObjectId === focalObjectId;
    if (!isOutgoing && !isIncoming) continue;
    const otherId = isOutgoing
      ? relationship.toObjectId
      : relationship.fromObjectId;
    if (!known.has(otherId)) continue;
    objectIds.add(otherId);
    relationshipIds.push(relationship.id);
  }

  return { objectIds: [...objectIds], relationshipIds };
}
