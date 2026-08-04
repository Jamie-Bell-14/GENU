import { describe, expect, it } from "vitest";
import {
  isRendererRegistered,
  validateScene,
  RENDERER_KEYS,
  type ProjectScope,
} from "./scene";

const OBJECT_A = "33333333-3333-4333-8333-000000000001";
const OBJECT_B = "33333333-3333-4333-8333-000000000002";
const FOREIGN_OBJECT = "44444444-4444-4444-8444-000000000009";
const REL_A = "55555555-5555-4555-8555-000000000001";
const FOREIGN_REL = "55555555-5555-4555-8555-000000000009";

const scope: ProjectScope = {
  objectIds: new Set([OBJECT_A, OBJECT_B]),
  relationshipIds: new Set([REL_A]),
};

function scene(overrides: Record<string, unknown> = {}) {
  return {
    renderer: "problem_exploration",
    purpose: "explore_problem",
    focalObjectId: OBJECT_A,
    visibleObjectIds: [OBJECT_A, OBJECT_B],
    visibleRelationshipIds: [REL_A],
    emphasis: "none",
    reason: "Showing how the problem connects to the project.",
    transition: "replace",
    ...overrides,
  };
}

describe("renderer allow-list", () => {
  it("registers only renderers the application implements", () => {
    expect(RENDERER_KEYS).toEqual(["problem_exploration", "evidence_research"]);
    expect(isRendererRegistered("problem_exploration")).toBe(true);
    // Joined the registry in T10, alongside its own renderer
    // (EvidenceResearchRenderer) — the two ship together.
    expect(isRendererRegistered("evidence_research")).toBe(true);
    expect(isRendererRegistered("custom_iframe")).toBe(false);
  });

  it("rejects an unregistered renderer key", () => {
    const result = validateScene(scene({ renderer: "custom_graph" }), scope);
    expect(result).toMatchObject({
      ok: false,
      rejection: { code: "unknown_renderer" },
    });
  });
});

describe("validateScene", () => {
  it("accepts a well-formed scene inside the project scope", () => {
    const result = validateScene(scene(), scope);
    expect(result.ok).toBe(true);
  });

  it("rejects objects belonging to another project", () => {
    const result = validateScene(
      scene({ visibleObjectIds: [OBJECT_A, FOREIGN_OBJECT] }),
      scope,
    );
    expect(result).toMatchObject({
      ok: false,
      rejection: { code: "object_not_in_project" },
    });
  });

  it("rejects relationships belonging to another project", () => {
    const result = validateScene(
      scene({ visibleRelationshipIds: [FOREIGN_REL] }),
      scope,
    );
    expect(result).toMatchObject({
      ok: false,
      rejection: { code: "relationship_not_in_project" },
    });
  });

  it("rejects a focal object that is not visible in its own scene", () => {
    const result = validateScene(
      scene({ focalObjectId: OBJECT_B, visibleObjectIds: [OBJECT_A] }),
      scope,
    );
    expect(result).toMatchObject({
      ok: false,
      rejection: { code: "focal_not_visible" },
    });
  });

  it("rejects unknown fields rather than ignoring them", () => {
    const result = validateScene(
      { ...scene(), coordinates: [{ x: 10, y: 20 }] },
      scope,
    );
    expect(result.ok).toBe(false);
  });

  it.each([
    ["markup", "<script>alert(1)</script>"],
    ["styling", 'style="position:absolute"'],
    ["a link", "See https://example.com for more"],
    ["a component name", "{CustomRenderer}"],
  ])("rejects %s smuggled through the reason text", (_label, reason) => {
    const result = validateScene(scene({ reason }), scope);
    expect(result.ok).toBe(false);
  });

  it("rejects non-uuid identifiers", () => {
    const result = validateScene(
      scene({
        focalObjectId: "subject-problem",
        visibleObjectIds: ["subject-problem"],
      }),
      scope,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an empty scene and an oversized one", () => {
    expect(validateScene(scene({ visibleObjectIds: [] }), scope).ok).toBe(
      false,
    );
    const many = Array.from(
      { length: 61 },
      (_, i) => `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`,
    );
    expect(validateScene(scene({ visibleObjectIds: many }), scope).ok).toBe(
      false,
    );
  });

  it("rejects entirely malformed input without throwing", () => {
    for (const input of [null, undefined, "scene", 42, []]) {
      expect(validateScene(input, scope).ok).toBe(false);
    }
  });
});
