import { describe, expect, it } from "vitest";
import { DISCOVERY_TOOLS, validateToolInput } from "./discovery-tools";

/**
 * The tool boundary (docs/AI_SYSTEM.md §5, §10, §13).
 *
 * These tests are written from the position that the model output is hostile,
 * because the boundary has to hold whether it is hostile or merely wrong. A
 * schema that only rejects malformed input is a parser; one that rejects
 * plausible-looking input carrying an extra field is a boundary.
 */

const validUpdate = {
  updates: [
    {
      area: "problem",
      key: "primary_pain",
      label: "Primary pain",
      value: "Deposit disputes at tenancy end.",
      origin: "ai_inferred",
      support: "hypothesis",
      rationale: "Stated by the person in their own words.",
    },
  ],
};

describe("structured tool input", () => {
  it("accepts a well-formed proposal", () => {
    const result = validateToolInput("update_project_model", validUpdate);
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown tool rather than ignoring it", () => {
    const result = validateToolInput("delete_everything", {});
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? "" : result.issue).toContain("Unknown tool");
  });

  describe("unknown-field rejection", () => {
    it("refuses an extra field on the operation", () => {
      const result = validateToolInput("update_project_model", {
        ...validUpdate,
        // A field the application never reads today, but might tomorrow.
        approved: true,
      });
      expect(result.ok).toBe(false);
    });

    it("refuses an extra field inside an item", () => {
      const result = validateToolInput("update_project_model", {
        updates: [
          {
            ...validUpdate.updates[0],
            // The most dangerous shape: an id the application might trust.
            project_id: "00000000-0000-4000-8000-000000000001",
          },
        ],
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("claims a model may not make", () => {
    it("refuses to let the model say the person stated a field", () => {
      /*
        Origin is the whole basis of "facts and inference stay distinct"
        (docs/AI_SYSTEM.md §2). If a turn could mark its own inference as
        user_stated, the distinction would exist only as a label.
      */
      const result = validateToolInput("update_project_model", {
        updates: [{ ...validUpdate.updates[0], origin: "user_stated" }],
      });
      expect(result.ok).toBe(false);
    });

    it("refuses a support state that would require evidence", () => {
      for (const support of ["credible", "strongly_evidenced"]) {
        const result = validateToolInput("update_project_model", {
          updates: [{ ...validUpdate.updates[0], support }],
        });
        expect(result.ok, `support: ${support}`).toBe(false);
      }
    });

    it("does allow an assumption to be attributed to the person", () => {
      // The opposite rule, for the opposite reason: an assumption's origin is
      // the point of recording it (VERTICAL_SLICE_SPEC Step 3).
      const result = validateToolInput("record_assumption", {
        statement: "Smaller agencies feel this most.",
        whyItMatters: "It decides who the first customer is.",
        alternatives: ["Larger agencies have more disputes by volume."],
        importance: "material",
        origin: "user_stated",
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("content that is not text", () => {
    const smuggled = [
      "<script>alert(1)</script>",
      "javascript:alert(1)",
      "See https://example.com/exfiltrate",
      '<div style="position:absolute">',
      "{{constructor.constructor('return 1')()}}",
    ];

    it("refuses markup, links and styling in user-visible text", () => {
      for (const value of smuggled) {
        const result = validateToolInput("update_project_model", {
          updates: [{ ...validUpdate.updates[0], rationale: value }],
        });
        expect(result.ok, value).toBe(false);
      }
    });

    it("refuses the same content in a scene reason", () => {
      for (const value of smuggled) {
        const result = validateToolInput("recommend_canvas_scene", {
          renderer: "problem_exploration",
          purpose: "explore_problem",
          focalObjectId: "aaaaaaaa-0000-4000-8000-000000000001",
          visibleObjectIds: ["aaaaaaaa-0000-4000-8000-000000000001"],
          visibleRelationshipIds: [],
          emphasis: "none",
          reason: value,
          transition: "preserve",
        });
        expect(result.ok, value).toBe(false);
      }
    });

    it("refuses coordinates smuggled as extra scene fields", () => {
      const result = validateToolInput("recommend_canvas_scene", {
        renderer: "problem_exploration",
        purpose: "explore_problem",
        focalObjectId: "aaaaaaaa-0000-4000-8000-000000000001",
        visibleObjectIds: ["aaaaaaaa-0000-4000-8000-000000000001"],
        visibleRelationshipIds: [],
        emphasis: "none",
        reason: "Showing the problem.",
        transition: "preserve",
        x: 40,
        y: 120,
      });
      expect(result.ok).toBe(false);
    });

    it("refuses a renderer the application does not own", () => {
      const result = validateToolInput("recommend_canvas_scene", {
        renderer: "raw_html",
        purpose: "explore_problem",
        focalObjectId: "aaaaaaaa-0000-4000-8000-000000000001",
        visibleObjectIds: ["aaaaaaaa-0000-4000-8000-000000000001"],
        visibleRelationshipIds: [],
        emphasis: "none",
        reason: "Showing the problem.",
        transition: "preserve",
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("bounds", () => {
    it("refuses more items than one turn may propose", () => {
      const result = validateToolInput("update_project_model", {
        updates: Array.from({ length: 9 }, () => validUpdate.updates[0]),
      });
      expect(result.ok).toBe(false);
    });

    it("refuses an oversized value", () => {
      const result = validateToolInput("update_project_model", {
        updates: [{ ...validUpdate.updates[0], value: "x".repeat(2_001) }],
      });
      expect(result.ok).toBe(false);
    });

    it("refuses a key that is prose rather than an identifier", () => {
      const result = validateToolInput("update_project_model", {
        updates: [
          { ...validUpdate.updates[0], key: "the primary pain point!" },
        ],
      });
      expect(result.ok).toBe(false);
    });
  });

  it("reports a failure without echoing project content", () => {
    const secret = "Acme Ltd is our launch customer";
    const result = validateToolInput("update_project_model", {
      updates: [{ ...validUpdate.updates[0], value: secret, support: "bogus" }],
    });
    expect(result.ok).toBe(false);
    // The issue string is sent back to the provider on the retry, so it must
    // name the field that was wrong and nothing else.
    expect(result.ok ? "" : result.issue).not.toContain(secret);
  });
});

describe("provider tool definitions", () => {
  it("closes every tool to unknown fields at the provider too", () => {
    for (const tool of DISCOVERY_TOOLS) {
      expect(tool.strict, tool.name).toBe(true);
      expect(tool.input_schema.additionalProperties, tool.name).toBe(false);
      expect(tool.input_schema.required.length, tool.name).toBeGreaterThan(0);
    }
  });

  it("offers exactly the tools the application can dispose of", () => {
    // A tool the model can call but the host cannot handle is a dead end the
    // user experiences as a turn that did nothing.
    expect(DISCOVERY_TOOLS.map((tool) => tool.name)).toEqual([
      "update_project_model",
      "record_assumption",
      "propose_connected_change",
      "suggest_checkpoint",
      "recommend_canvas_scene",
    ]);
  });
});
