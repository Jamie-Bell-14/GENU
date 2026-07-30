import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { StagedOperation } from "@/lib/ai/discovery-engine";
import { commitModelOperations, verifiedQuotation } from "./model-operations";

/**
 * The authorisation boundary for model-proposed operations
 * (docs/AI_SYSTEM.md §5, §6, §10).
 *
 * These tests stub the database, so what they check is what this module decides
 * and what it sends — which is the part that determines whether a proposal can
 * reach a row it should not, and with what provenance attached.
 *
 * The properties that depend on *stored* state — user-owned wording, all-or-none
 * under a real transaction, a concurrent edit racing a commit — are enforced in
 * SQL and tested against a real database in
 * supabase/tests/turn-start-operations-rls.test.ts. A stub cannot prove any of
 * them, which is exactly why they were moved out of TypeScript.
 */
const PROJECT = "11111111-0000-4000-8000-000000000001";
const OTHER_PROJECT = "22222222-0000-4000-8000-000000000002";
const TURN = "dddddddd-0000-4000-8000-000000000001";

/** The message the server actually received, against which quotes are checked. */
const USER_MESSAGE =
  "Landlords and tenants argue about property condition at the end of a tenancy.";

const ctx = { projectId: PROJECT, turnId: TURN, userMessage: USER_MESSAGE };

interface RpcArgs {
  p_project_id: string;
  p_turn_id: string;
  p_fields: Record<string, unknown>[];
  p_assumptions: Record<string, unknown>[];
}

function stubClient(failure?: { message?: string; code?: string }) {
  const rpc = vi.fn(async (name: string, args: unknown) => {
    void name;
    void args;
    return failure
      ? { data: null, error: failure }
      : { data: { fields: 0, assumptions: 0 }, error: null };
  });
  return {
    client: { rpc } as unknown as SupabaseClient,
    rpc,
    /** What the single transaction was asked to write. */
    sent: () => rpc.mock.calls[0]?.[1] as RpcArgs | undefined,
  };
}

const op = (name: string, candidate: unknown): StagedOperation => ({
  name,
  candidate,
});

const validUpdate = {
  updates: [
    {
      area: "problem",
      key: "primary_pain",
      label: "Primary pain",
      value: "Deposit disputes at tenancy end.",
      origin: "ai_inferred",
      support: "hypothesis",
      rationale: "Derived from what the person described.",
    },
  ],
};

const validAssumption = {
  statement: "Smaller agencies feel this most.",
  whyItMatters: "It decides who the first customer is.",
  alternatives: ["Larger agencies have more disputes by volume."],
  importance: "material",
};

describe("commitModelOperations", () => {
  it("applies a low-risk field update with its origin intact", async () => {
    const stub = stubClient();
    const { outcomes, changed } = await commitModelOperations(
      stub.client,
      ctx,
      [op("update_project_model", validUpdate)],
    );

    expect(outcomes).toEqual([
      { applied: true, kind: "update_project_model", count: 1 },
    ]);
    expect(changed).toBe(true);
    expect(stub.rpc).toHaveBeenCalledWith(
      "apply_turn_operations",
      expect.anything(),
    );
    expect(stub.sent()?.p_fields).toEqual([
      expect.objectContaining({ origin: "ai_inferred", support: "hypothesis" }),
    ]);
  });

  it("sends every accepted write in one transaction, not one call each", async () => {
    /*
      The all-or-none property, from this side. A loop that wrote each operation
      separately could land the field and fail the assumption, leaving the
      project half-changed by a turn reported as failed.
    */
    const stub = stubClient();
    await commitModelOperations(stub.client, ctx, [
      op("update_project_model", validUpdate),
      op("record_assumption", validAssumption),
    ]);

    expect(stub.rpc).toHaveBeenCalledTimes(1);
    expect(stub.sent()?.p_fields).toHaveLength(1);
    expect(stub.sent()?.p_assumptions).toHaveLength(1);
  });

  it("takes the project and the turn from the host, never from the proposal", async () => {
    const stub = stubClient();
    /*
      The schema already rejects an unknown field, so a candidate carrying
      `project_id` never parses. This states the property from the other end:
      whatever arrives, the transaction names the authorised project.
    */
    await commitModelOperations(stub.client, ctx, [
      op("update_project_model", validUpdate),
    ]);
    expect(stub.sent()?.p_project_id).toBe(PROJECT);
    expect(stub.sent()?.p_turn_id).toBe(TURN);
    expect(JSON.stringify(stub.sent())).not.toContain(OTHER_PROJECT);
  });

  it("refuses a proposal carrying an extra field, and writes nothing", async () => {
    const stub = stubClient();
    const { outcomes, changed } = await commitModelOperations(
      stub.client,
      ctx,
      [
        op("update_project_model", {
          ...validUpdate,
          project_id: OTHER_PROJECT,
        }),
      ],
    );

    expect(outcomes[0]).toMatchObject({ applied: false, reason: "rejected" });
    expect(changed).toBe(false);
    // Refused means nothing was sent, not written-then-reverted.
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("re-validates rather than trusting the engine's own check", async () => {
    const stub = stubClient();
    const { outcomes } = await commitModelOperations(stub.client, ctx, [
      op("update_project_model", {
        updates: [{ ...validUpdate.updates[0], origin: "user_stated" }],
      }),
    ]);
    expect(outcomes[0]).toMatchObject({ applied: false, reason: "rejected" });
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("refuses one malformed operation without abandoning a valid one", async () => {
    // Validation refuses individually; only the *writes* are all-or-none. A
    // malformed checkpoint must not cost the user a recorded field.
    const stub = stubClient();
    const { outcomes } = await commitModelOperations(stub.client, ctx, [
      op("suggest_checkpoint", { name: "Nothing else" }),
      op("update_project_model", validUpdate),
    ]);

    expect(outcomes[0]).toMatchObject({ applied: false, reason: "rejected" });
    expect(outcomes[1]).toMatchObject({ applied: true });
    expect(stub.sent()?.p_fields).toHaveLength(1);
  });

  it("records an assumption with the alternatives it offered", async () => {
    const stub = stubClient();
    const { outcomes } = await commitModelOperations(stub.client, ctx, [
      op("record_assumption", validAssumption),
    ]);

    expect(outcomes[0]).toMatchObject({ applied: true });
    expect(stub.sent()?.p_assumptions).toEqual([
      expect.objectContaining({
        // No verified quote, so it is the model's inference — which is what it is.
        origin: "ai_inferred",
        alternatives: ["Larger agencies have more disputes by volume."],
      }),
    ]);
  });

  it("reports every write as refused when the transaction raises", async () => {
    /*
      Nothing was written, so reporting one of them as applied would put a claim
      in the audit trail the database does not support.
    */
    const stub = stubClient({ code: "42501" });
    const { outcomes, changed } = await commitModelOperations(
      stub.client,
      ctx,
      [
        op("update_project_model", validUpdate),
        op("record_assumption", validAssumption),
      ],
    );

    expect(outcomes.every((outcome) => !outcome.applied)).toBe(true);
    expect(changed).toBe(false);
  });

  it("explains a refused user-owned field in words a person can act on", async () => {
    const stub = stubClient({
      message: "user_owned_field:problem/primary_pain",
    });
    const { outcomes } = await commitModelOperations(stub.client, ctx, [
      op("update_project_model", validUpdate),
    ]);
    expect(outcomes[0]).toMatchObject({
      applied: false,
      reason: "rejected",
      issue:
        "A field the person stated themselves cannot be replaced automatically.",
    });
  });

  it("does not open a transaction when a turn proposed nothing to write", async () => {
    const stub = stubClient();
    const { changed } = await commitModelOperations(stub.client, ctx, [
      op("suggest_checkpoint", {
        name: "Problem defined",
        reason: "area_defined",
        summary: "The problem statement is settled enough to build on.",
      }),
    ]);
    expect(changed).toBe(false);
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  describe("consequential operations are not applied here", () => {
    it("defers a connected change to the approval machinery", async () => {
      const stub = stubClient();
      const { outcomes } = await commitModelOperations(stub.client, ctx, [
        op("propose_connected_change", {
          title: "Narrow the target customer",
          rationale: "The evidence points at smaller agencies.",
          items: [
            {
              area: "customer",
              key: "primary_customer",
              before: "Letting agencies",
              after: "Letting agencies under 20 staff",
            },
          ],
          remainingUncertainty: "No evidence on willingness to pay yet.",
        }),
      ]);

      expect(outcomes[0]).toEqual({
        applied: false,
        kind: "propose_connected_change",
        reason: "deferred",
      });
      // Nothing is written: approval is a deterministic state machine (T11),
      // and prose cannot stand in for it (docs/AI_SYSTEM.md §6).
      expect(stub.rpc).not.toHaveBeenCalled();
    });

    it("still refuses a malformed connected change", async () => {
      const stub = stubClient();
      const { outcomes } = await commitModelOperations(stub.client, ctx, [
        op("propose_connected_change", {
          title: "Approved already",
          items: [],
        }),
      ]);
      expect(outcomes[0]).toMatchObject({ applied: false, reason: "rejected" });
    });

    it("defers a checkpoint", async () => {
      const stub = stubClient();
      const { outcomes } = await commitModelOperations(stub.client, ctx, [
        op("suggest_checkpoint", {
          name: "Problem defined",
          reason: "area_defined",
          summary: "The problem statement is settled enough to build on.",
        }),
      ]);
      expect(outcomes[0]).toMatchObject({ applied: false, reason: "deferred" });
    });
  });

  it("refuses a scene, which belongs to a different boundary", async () => {
    const stub = stubClient();
    const { outcomes } = await commitModelOperations(stub.client, ctx, [
      op("recommend_canvas_scene", { renderer: "problem_exploration" }),
    ]);
    expect(outcomes[0]).toMatchObject({ applied: false, reason: "rejected" });
    expect(stub.rpc).not.toHaveBeenCalled();
  });
});

/*
  Provenance. The model can offer evidence that something was said; it cannot
  assert it. Every case below is about who gets to decide the origin of a claim,
  which is the distinction the whole product rests on.
*/
describe("provenance is derived, not accepted", () => {
  const fieldWithQuote = (value: string, quote?: string) => ({
    updates: [
      {
        ...validUpdate.updates[0],
        value,
        ...(quote === undefined ? {} : { quotedFromMessage: quote }),
      },
    ],
  });

  async function commitField(value: string, quote?: string) {
    const stub = stubClient();
    await commitModelOperations(stub.client, ctx, [
      op("update_project_model", fieldWithQuote(value, quote)),
    ]);
    return stub.sent()?.p_fields[0] as {
      origin: string;
      source_excerpt: string | null;
    };
  }

  it("records the person's own words as user-stated", async () => {
    const written = await commitField(
      "argue about property condition",
      "argue about property condition",
    );
    expect(written.origin).toBe("user_stated");
    expect(written.source_excerpt).toBe("argue about property condition");
  });

  it("tolerates reformatted whitespace and casing in a real quotation", async () => {
    const written = await commitField(
      "Argue about property condition",
      "Argue  About\nProperty Condition",
    );
    expect(written.origin).toBe("user_stated");
  });

  it("refuses to treat a fabricated quotation as something the person said", async () => {
    const written = await commitField(
      "I want to target enterprise letting agencies",
      "I want to target enterprise letting agencies",
    );
    // Not a failure: the field is still recorded, as the inference it is.
    expect(written.origin).toBe("ai_inferred");
    expect(written.source_excerpt).toBeNull();
  });

  it("refuses a genuine quotation attached to an invented value", async () => {
    /*
      The defect this closes. The earlier check asked only whether the excerpt
      appeared *somewhere* in the message, so a turn could attach a real phrase
      to a value the person never said and have the whole record marked as
      theirs. A quotation next to a claim is not evidence for the claim.
    */
    const written = await commitField(
      "The customer is enterprise letting agencies.",
      "argue about property condition",
    );
    expect(written.origin).toBe("ai_inferred");
    expect(written.source_excerpt).toBeNull();
  });

  it("refuses a paraphrase, which is not a quotation", async () => {
    const written = await commitField(
      "disagreements regarding the state of the property",
      "disagreements regarding the state of the property",
    );
    expect(written.origin).toBe("ai_inferred");
  });

  it("records an assumption as the person's when they really said it", async () => {
    const stub = stubClient();
    await commitModelOperations(stub.client, ctx, [
      op("record_assumption", {
        ...validAssumption,
        statement: "at the end of a tenancy",
        quotedFromMessage: "at the end of a tenancy",
      }),
    ]);
    expect(stub.sent()?.p_assumptions[0]).toMatchObject({
      origin: "user_stated",
      source_excerpt: "at the end of a tenancy",
    });
  });

  it("refuses `researched` outright, since no research exists yet", async () => {
    const stub = stubClient();
    const { outcomes } = await commitModelOperations(stub.client, ctx, [
      op("update_project_model", {
        updates: [{ ...validUpdate.updates[0], origin: "researched" }],
      }),
    ]);
    // A turn claiming research before T10 is claiming evidence that cannot
    // exist, so the shape is refused rather than downgraded.
    expect(outcomes[0]).toMatchObject({ applied: false, reason: "rejected" });
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  describe("verifiedQuotation", () => {
    it("returns the excerpt only when the stored words are that excerpt", () => {
      expect(
        verifiedQuotation(
          "property condition",
          "property condition",
          USER_MESSAGE,
        ),
      ).toBe("property condition");
      expect(
        verifiedQuotation("property condition", "rent arrears", USER_MESSAGE),
      ).toBeNull();
    });

    it("refuses an absent or trivially short excerpt", () => {
      expect(verifiedQuotation("anything", undefined, USER_MESSAGE)).toBeNull();
      // Too short to be evidence of anything: "and" appears in most messages.
      expect(verifiedQuotation("and", "and", USER_MESSAGE)).toBeNull();
    });

    it("allows trailing punctuation to differ", () => {
      expect(
        verifiedQuotation(
          "property condition.",
          "property condition",
          USER_MESSAGE,
        ),
      ).toBe("property condition");
    });
  });
});
