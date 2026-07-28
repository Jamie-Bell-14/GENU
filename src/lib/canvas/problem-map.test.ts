import { describe, expect, it } from "vitest";
import type { CanvasObject } from "./model";
import {
  branchKey,
  buildProblemMap,
  defaultFocalObjectId,
  scopeForFocus,
  EMPTY_MAP_VIEW,
} from "./problem-map";
import type { ProjectRelationship } from "./relationships";

const PROBLEM = "aaaaaaaa-0000-4000-8000-000000000001";
const CAUSE = "aaaaaaaa-0000-4000-8000-000000000002";
const CONSEQUENCE = "aaaaaaaa-0000-4000-8000-000000000003";
const ORPHAN = "aaaaaaaa-0000-4000-8000-000000000004";

function object(
  id: string,
  overrides: Partial<CanvasObject> = {},
): CanvasObject {
  return {
    id,
    kind: "concept",
    zone: "related",
    title: `Object ${id.slice(-1)}`,
    origin: "ai_inferred",
    ...overrides,
  };
}

const objects = [
  object(PROBLEM, { zone: "subject", title: "Problem", origin: "user_stated" }),
  object(CAUSE, { title: "Missing evidence" }),
  object(CONSEQUENCE, { title: "Deposit dispute" }),
  object(ORPHAN, { title: "Unrelated note" }),
];

function relationship(
  id: string,
  from: string,
  to: string,
  relation: ProjectRelationship["relation"],
): ProjectRelationship {
  return {
    id,
    fromObjectId: from,
    toObjectId: to,
    relation,
    origin: "ai_inferred",
    support: "hypothesis",
  };
}

const relationships = [
  relationship(
    "bbbbbbbb-0000-4000-8000-000000000001",
    CAUSE,
    PROBLEM,
    "possible_cause_of",
  ),
  relationship(
    "bbbbbbbb-0000-4000-8000-000000000002",
    CONSEQUENCE,
    PROBLEM,
    "consequence_of",
  ),
];

describe("buildProblemMap", () => {
  it("groups related objects into branches by stored relationship type", () => {
    const map = buildProblemMap(objects, relationships, PROBLEM);
    expect(map.focal?.id).toBe(PROBLEM);
    const labels = map.branches.map((branch) => branch.label);
    expect(labels).toContain("Possible causes");
    expect(labels).toContain("Consequences");
  });

  it("never invents a relationship that is not stored", () => {
    // Same objects, no relationships at all: the map must show no branches
    // rather than grouping objects by proximity or zone.
    const map = buildProblemMap(objects, [], PROBLEM);
    expect(map.branches).toEqual([]);
    expect(map.unconnectedCount).toBe(objects.length - 1);
  });

  it("only follows relationships touching the focal object", () => {
    const distant = relationship(
      "bbbbbbbb-0000-4000-8000-000000000003",
      CAUSE,
      CONSEQUENCE,
      "affects",
    );
    const map = buildProblemMap(objects, [...relationships, distant], PROBLEM);
    const affects = map.branches.find(
      (branch) => branch.relation === "affects",
    );
    expect(affects).toBeUndefined();
  });

  it("skips endpoints the caller cannot see rather than rendering placeholders", () => {
    const dangling = relationship(
      "bbbbbbbb-0000-4000-8000-000000000004",
      "cccccccc-0000-4000-8000-000000000009",
      PROBLEM,
      "possible_cause_of",
    );
    const map = buildProblemMap(objects, [...relationships, dangling], PROBLEM);
    const causes = map.branches.find(
      (branch) => branch.key === branchKey("possible_cause_of", "incoming"),
    );
    expect(causes?.members).toHaveLength(1);
  });

  it("collapses a branch and hides members while reporting the count", () => {
    const collapsed = buildProblemMap(objects, relationships, PROBLEM, {
      ...EMPTY_MAP_VIEW,
      collapsedBranches: [branchKey("possible_cause_of", "incoming")],
    });
    const branch = collapsed.branches.find(
      (candidate) =>
        candidate.key === branchKey("possible_cause_of", "incoming"),
    );
    expect(branch?.collapsed).toBe(true);
    expect(branch?.members).toEqual([]);

    const hidden = buildProblemMap(objects, relationships, PROBLEM, {
      ...EMPTY_MAP_VIEW,
      hidden: [CAUSE],
    });
    const hiddenBranch = hidden.branches.find(
      (candidate) =>
        candidate.key === branchKey("possible_cause_of", "incoming"),
    );
    expect(hiddenBranch?.members).toEqual([]);
    expect(hiddenBranch?.hiddenCount).toBe(1);
  });

  it("sorts pinned members first", () => {
    const extra = relationship(
      "bbbbbbbb-0000-4000-8000-000000000005",
      ORPHAN,
      PROBLEM,
      "possible_cause_of",
    );
    const map = buildProblemMap(objects, [...relationships, extra], PROBLEM, {
      ...EMPTY_MAP_VIEW,
      pinned: [ORPHAN],
    });
    const causes = map.branches.find(
      (branch) => branch.key === branchKey("possible_cause_of", "incoming"),
    );
    expect(causes?.members[0].object.id).toBe(ORPHAN);
  });

  it("reports no focus when the focal object does not exist", () => {
    const map = buildProblemMap(objects, relationships, "missing");
    expect(map.focal).toBeNull();
    expect(map.branches).toEqual([]);
  });
});

describe("defaultFocalObjectId", () => {
  it("prefers the active problem", () => {
    expect(defaultFocalObjectId(objects, relationships)).toBe(PROBLEM);
  });

  it("falls back to the most connected object, then the first", () => {
    const withoutSubject = objects.filter((object) => object.id !== PROBLEM);
    expect(defaultFocalObjectId(withoutSubject, relationships)).toBe(CAUSE);
    expect(defaultFocalObjectId(withoutSubject, [])).toBe(CAUSE);
    expect(defaultFocalObjectId([], [])).toBeNull();
  });
});

describe("scopeForFocus", () => {
  it("declares only the focal object, its neighbours and their edges", () => {
    const scope = scopeForFocus(objects, relationships, PROBLEM);
    expect(scope.objectIds).toContain(PROBLEM);
    expect(scope.objectIds).toContain(CAUSE);
    expect(scope.objectIds).not.toContain(ORPHAN);
    expect(scope.relationshipIds).toHaveLength(2);
  });
});
