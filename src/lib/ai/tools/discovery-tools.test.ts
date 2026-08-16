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

    it("refuses an assumption that declares its own origin", () => {
      /*
        An earlier version of this schema accepted `origin: user_stated` on an
        assumption, reasoning that a misattribution would be visible on the
        canvas. That was too weak — "the user can spot it" is not a control.
        Origin is now derived by the host from a verified quotation, so the
        field does not exist here at all.
      */
      const result = validateToolInput("record_assumption", {
        statement: "Smaller agencies feel this most.",
        whyItMatters: "It decides who the first customer is.",
        alternatives: ["Larger agencies have more disputes by volume."],
        importance: "material",
        origin: "user_stated",
      });
      expect(result.ok).toBe(false);
    });

    it("accepts an assumption offering a quotation as evidence", () => {
      // The model may offer evidence of what was said; the host decides.
      const result = validateToolInput("record_assumption", {
        statement: "Smaller agencies feel this most.",
        whyItMatters: "It decides who the first customer is.",
        alternatives: ["Larger agencies have more disputes by volume."],
        importance: "material",
        quotedFromMessage: "smaller agencies have fewer resources",
      });
      expect(result.ok).toBe(true);
    });

    it("refuses `researched`, which no provider can yet support", () => {
      const result = validateToolInput("update_project_model", {
        updates: [{ ...validUpdate.updates[0], origin: "researched" }],
      });
      expect(result.ok).toBe(false);
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

  /*
    The two schemas have to describe the same shape.

    They are written separately on purpose — the provider schema is a hint, the
    Zod schema is the boundary — but "separately" must not mean "differently". A
    provider-valid call the boundary rejects burns the turn's single schema retry
    and can fail Step 3 on a well-behaved response, which is the worst kind of
    disagreement: it looks like the model misbehaved.
  */
  describe("the provider schema and the boundary agree", () => {
    /**
     * Under `strict`, a property left out of `required` is not optional to the
     * provider. So every property must be required, and anything that may be
     * empty has to say so by being nullable.
     */
    function requiredNames(schema: unknown): void {
      const node = schema as {
        type?: string | string[];
        properties?: Record<string, unknown>;
        required?: string[];
        items?: unknown;
      };
      if (node.properties) {
        expect(Object.keys(node.properties).sort()).toEqual(
          [...(node.required ?? [])].sort(),
        );
        for (const child of Object.values(node.properties)) {
          requiredNames(child);
        }
      }
      if (node.items) requiredNames(node.items);
    }

    it("requires every property of every tool, nested objects included", () => {
      for (const tool of DISCOVERY_TOOLS) {
        requiredNames(tool.input_schema);
      }
    });

    it("accepts the exact payload a strict schema produces for an inference", () => {
      // `quotedFromMessage: null` is what a correct provider call looks like
      // when the record is the model's own inference. The boundary used to
      // reject it outright.
      const field = validateToolInput("update_project_model", {
        updates: [{ ...validUpdate.updates[0], quotedFromMessage: null }],
      });
      expect(field.ok).toBe(true);

      const assumption = validateToolInput("record_assumption", {
        statement: "Smaller agencies feel this most.",
        whyItMatters: "It decides who the first customer is.",
        alternatives: ["Larger agencies have more disputes by volume."],
        importance: "material",
        quotedFromMessage: null,
      });
      expect(assumption.ok).toBe(true);
    });

    it("still refuses a quotation too short to be evidence of anything", () => {
      const result = validateToolInput("record_assumption", {
        statement: "Smaller agencies feel this most.",
        whyItMatters: "It decides who the first customer is.",
        alternatives: [],
        importance: "material",
        quotedFromMessage: "and",
      });
      expect(result).toMatchObject({ ok: false });
    });
  });

  it("offers exactly the tools the application can dispose of", () => {
    // A tool the model can call but the host cannot handle is a dead end the
    // user experiences as a turn that did nothing.
    expect(DISCOVERY_TOOLS.map((tool) => tool.name)).toEqual([
      "update_project_model",
      "record_assumption",
      "propose_connected_change",
      "suggest_checkpoint",
      "suggest_actions",
      "recommend_canvas_scene",
      "start_research",
      "add_evidence",
    ]);
  });

  describe("start_research / add_evidence (T10)", () => {
    it("accepts a short topic and rejects markup smuggled through it", () => {
      expect(
        validateToolInput("start_research", { topic: "Deposit disputes" }),
      ).toMatchObject({
        ok: true,
      });
      expect(
        validateToolInput("start_research", {
          topic: "<script>alert(1)</script>",
        }),
      ).toMatchObject({ ok: false });
    });

    it("rejects unknown fields on start_research", () => {
      expect(
        validateToolInput("start_research", { topic: "x", extra: 1 }),
      ).toMatchObject({ ok: false });
    });

    it("accepts a bounded consequence summary with a direction, and rejects an empty summary", () => {
      expect(
        validateToolInput("add_evidence", {
          consequenceSummary: "It supports X but not Y.",
          direction: "supports",
        }),
      ).toMatchObject({ ok: true });
      expect(
        validateToolInput("add_evidence", {
          consequenceSummary: "",
          direction: "supports",
        }),
      ).toMatchObject({ ok: false });
    });

    it("requires a direction from the closed vocabulary, never a free-form guess", () => {
      expect(
        validateToolInput("add_evidence", {
          consequenceSummary: "It supports X.",
        }),
      ).toMatchObject({ ok: false });
      expect(
        validateToolInput("add_evidence", {
          consequenceSummary: "It supports X.",
          direction: "probably",
        }),
      ).toMatchObject({ ok: false });
    });

    it("rejects an add_evidence call naming a finding or object id", () => {
      // The model may never assert which finding or object this concerns —
      // only the host derives that (docs/AI_SYSTEM.md §10).
      expect(
        validateToolInput("add_evidence", {
          consequenceSummary: "It supports X.",
          direction: "supports",
          objectId: "aaaaaaaa-0000-4000-8000-000000000001",
        }),
      ).toMatchObject({ ok: false });
    });
  });
});

/*
  T11 entry-gate live smoke test (issue #14), Attempt 2: a live request was
  rejected with `providerFailure: { status: 400, errorType:
  "invalid_request_error" }` before any tokens were processed. Confirmed
  against Anthropic's documented strict-mode JSON Schema subset
  (platform.claude.com/docs/en/build-with-claude/structured-outputs):
  `maxItems`, and `minItems` above 1, are outside that subset and reject the
  *entire* request, not just the array carrying them — as do numeric bounds
  (minimum/maximum/multipleOf) and string-length bounds (minLength/maxLength).
  Every `DISCOVERY_TOOLS` entry sets `strict: true`, so this walks each
  provider-facing schema and guards against the unsupported subset drifting
  back in — easy to do by analogy with the Zod schemas, which legitimately
  use these keywords at the application boundary.
*/
describe("provider-facing schemas stay inside Anthropic's strict tool-use subset", () => {
  const UNSUPPORTED_KEYS = [
    "maxItems",
    "minimum",
    "maximum",
    "multipleOf",
    "minLength",
    "maxLength",
  ] as const;

  function walk(
    schema: unknown,
    path: string,
    visit: (node: Record<string, unknown>, path: string) => void,
  ): void {
    if (schema === null || typeof schema !== "object") return;
    const node = schema as Record<string, unknown>;
    visit(node, path);
    if (node.properties && typeof node.properties === "object") {
      for (const [key, value] of Object.entries(
        node.properties as Record<string, unknown>,
      )) {
        walk(value, `${path}.${key}`, visit);
      }
    }
    if (node.items) walk(node.items, `${path}[]`, visit);
  }

  for (const tool of DISCOVERY_TOOLS) {
    it(`${tool.name}: never uses a JSON Schema keyword outside the strict-mode subset`, () => {
      walk(tool.input_schema, tool.name, (node, path) => {
        for (const key of UNSUPPORTED_KEYS) {
          expect(
            node,
            `${path} used unsupported keyword "${key}"`,
          ).not.toHaveProperty(key);
        }
        if (typeof node.minItems === "number") {
          expect(
            node.minItems,
            `${path}.minItems must be 0 or 1, not ${node.minItems}`,
          ).toBeLessThanOrEqual(1);
        }
      });
    });

    it(`${tool.name}: every object schema sets additionalProperties: false and requires every property`, () => {
      walk(tool.input_schema, tool.name, (node, path) => {
        if (node.type !== "object") return;
        expect(
          node.additionalProperties,
          `${path} must set additionalProperties: false`,
        ).toBe(false);
        const propertyNames = Object.keys(
          (node.properties as Record<string, unknown>) ?? {},
        ).sort();
        const required = ((node.required as string[]) ?? []).slice().sort();
        expect(
          required,
          `${path}: required must list exactly ${JSON.stringify(propertyNames)}`,
        ).toEqual(propertyNames);
      });
    });
  }
});
