import { describe, expect, it, vi } from "vitest";
import type { StagedOperation } from "@/lib/ai/discovery-engine";
import { commitTurn, verifiedQuotation } from "./model-operations";
import type { CompleteTurnRecord } from "./trusted-writer";

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

interface Writes {
  assistantText: string;
  fields: unknown[];
  assumptions: unknown[];
}

/** The slot a staged row carries, which is how outcomes stay per operation. */
const slotOf = (row: unknown) => String((row as { slot: number }).slot);

const ANSWER = "Recorded, and here is what I would test next.";

/**
 * Stands in for the one transaction. By default it reports every staged row as
 * written, keyed by the slot the row carried — which is how the real function
 * answers, and what lets an outcome describe its own operation.
 */
function stubCommit(
  result?: CompleteTurnRecord | ((writes: Writes) => CompleteTurnRecord),
) {
  const commit = vi.fn(async (writes: Writes) => {
    if (typeof result === "function") return result(writes);
    if (result) return result;
    const written: Record<string, number> = {};
    for (const row of [...writes.fields, ...writes.assumptions]) {
      const slot = slotOf(row);
      written[slot] = (written[slot] ?? 0) + 1;
    }
    return { outcome: "completed", written, refused: {} } as CompleteTurnRecord;
  });
  return {
    commit,
    /** What the single transaction was asked to write. */
    sent: () => commit.mock.calls[0]?.[0] as Writes | undefined,
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

describe("commitTurn", () => {
  it("applies a low-risk field update with its origin intact", async () => {
    const stub = stubCommit();
    const { outcomes, changed } = await commitTurn(
      stub.commit,
      ctx,
      [op("update_project_model", validUpdate)],
      ANSWER,
    );

    expect(outcomes).toEqual([
      { applied: true, kind: "update_project_model", count: 1 },
    ]);
    expect(changed).toBe(true);
    // The answer travels with the writes: they are one transaction.
    expect(stub.sent()?.assistantText).toBe(ANSWER);
    expect(stub.sent()?.fields).toEqual([
      expect.objectContaining({ origin: "ai_inferred", support: "hypothesis" }),
    ]);
  });

  it("sends every accepted write in one transaction, not one call each", async () => {
    /*
      The all-or-none property, from this side. A loop that wrote each operation
      separately could land the field and fail the assumption, leaving the
      project half-changed by a turn reported as failed.
    */
    const stub = stubCommit();
    await commitTurn(
      stub.commit,
      ctx,
      [
        op("update_project_model", validUpdate),
        op("record_assumption", validAssumption),
      ],
      ANSWER,
    );

    expect(stub.commit).toHaveBeenCalledTimes(1);
    expect(stub.sent()?.fields).toHaveLength(1);
    expect(stub.sent()?.assumptions).toHaveLength(1);
  });

  it("names no project at all: the host tells the transaction which one", async () => {
    const stub = stubCommit();
    /*
      The schema already rejects an unknown field, so a candidate carrying
      `project_id` never parses. This states the property from the other end:
      nothing a staged row carries can influence which project is written, because
      the project and turn are bound by the caller of the transaction and never
      appear in the payload at all.
    */
    await commitTurn(
      stub.commit,
      ctx,
      [op("update_project_model", validUpdate)],
      ANSWER,
    );
    const payload = JSON.stringify(stub.sent());
    expect(payload).not.toContain(OTHER_PROJECT);
    expect(payload).not.toContain(PROJECT);
    expect(payload).not.toContain("project_id");
  });

  it("refuses a proposal carrying an extra field, and writes nothing", async () => {
    const stub = stubCommit();
    const { outcomes, changed } = await commitTurn(
      stub.commit,
      ctx,
      [
        op("update_project_model", {
          ...validUpdate,
          project_id: OTHER_PROJECT,
        }),
      ],
      ANSWER,
    );

    expect(outcomes[0]).toMatchObject({ applied: false, reason: "rejected" });
    expect(changed).toBe(false);
    // Refused means nothing was staged for the transaction, not
    // written-then-reverted. The answer is still stored: a proposal the
    // application would not act on does not cost the person their reply.
    expect(stub.sent()?.fields).toEqual([]);
  });

  it("re-validates rather than trusting the engine's own check", async () => {
    const stub = stubCommit();
    const { outcomes } = await commitTurn(
      stub.commit,
      ctx,
      [
        op("update_project_model", {
          updates: [{ ...validUpdate.updates[0], origin: "user_stated" }],
        }),
      ],
      ANSWER,
    );
    expect(outcomes[0]).toMatchObject({ applied: false, reason: "rejected" });
    expect(stub.sent()?.fields).toEqual([]);
  });

  it("refuses one malformed operation without abandoning a valid one", async () => {
    // Validation refuses individually; only the *writes* are all-or-none. A
    // malformed checkpoint must not cost the user a recorded field.
    const stub = stubCommit();
    const { outcomes } = await commitTurn(
      stub.commit,
      ctx,
      [
        op("suggest_checkpoint", { name: "Nothing else" }),
        op("update_project_model", validUpdate),
      ],
      ANSWER,
    );

    expect(outcomes[0]).toMatchObject({ applied: false, reason: "rejected" });
    expect(outcomes[1]).toMatchObject({ applied: true });
    expect(stub.sent()?.fields).toHaveLength(1);
  });

  it("records an assumption with the alternatives it offered", async () => {
    const stub = stubCommit();
    const { outcomes } = await commitTurn(
      stub.commit,
      ctx,
      [op("record_assumption", validAssumption)],
      ANSWER,
    );

    expect(outcomes[0]).toMatchObject({ applied: true });
    expect(stub.sent()?.assumptions).toEqual([
      expect.objectContaining({
        // No verified quote, so it is the model's inference — which is what it is.
        origin: "ai_inferred",
        alternatives: ["Larger agencies have more disputes by volume."],
      }),
    ]);
  });

  it("reports every write as refused when the transaction did not happen", async () => {
    /*
      Nothing was written — not one field, and not the answer either — so
      reporting any of them as applied would put a claim in the audit trail the
      database does not support.
    */
    const stub = stubCommit({ outcome: "unavailable" });
    const { outcome, outcomes, changed } = await commitTurn(
      stub.commit,
      ctx,
      [
        op("update_project_model", validUpdate),
        op("record_assumption", validAssumption),
      ],
      ANSWER,
    );

    expect(outcome).toBe("unavailable");
    expect(outcomes.every((entry) => !entry.applied)).toBe(true);
    expect(changed).toBe(false);
  });

  it("reports a write the transaction refused, in words a person can act on", async () => {
    // The database decides this under the row's own lock, so the refusal comes
    // back per slot rather than being predicted here.
    const stub = stubCommit({
      outcome: "completed",
      written: {},
      refused: { "0": ["user_owned_field"] },
    });
    const { outcomes, changed } = await commitTurn(
      stub.commit,
      ctx,
      [op("update_project_model", validUpdate)],
      ANSWER,
    );
    expect(outcomes[0]).toMatchObject({
      applied: false,
      reason: "rejected",
      issue:
        "A field the person stated themselves cannot be replaced automatically.",
    });
    expect(changed).toBe(false);
  });

  it("reports part of an operation landing and part being refused", async () => {
    /*
      One `update_project_model` call may carry eight field updates. "Seven
      written, one refused" is a different fact from either applied or rejected,
      and the audit trail should say which.
    */
    const stub = stubCommit({
      outcome: "completed",
      written: { "0": 1 },
      refused: { "0": ["user_owned_field"] },
    });
    const { outcomes, changed } = await commitTurn(
      stub.commit,
      ctx,
      [
        op("update_project_model", {
          updates: [
            validUpdate.updates[0],
            { ...validUpdate.updates[0], key: "secondary_pain" },
          ],
        }),
      ],
      ANSWER,
    );
    expect(outcomes[0]).toEqual({
      applied: true,
      kind: "update_project_model",
      count: 1,
      refused: 1,
    });
    expect(changed).toBe(true);
  });

  it("still commits when a turn proposed nothing to write", async () => {
    /*
      The answer and the terminal state are part of the same transaction, so
      there is no path on which a turn ends without one. `changed` is false
      because project truth did not move — not because nothing happened.
    */
    const stub = stubCommit();
    const { outcome, changed } = await commitTurn(
      stub.commit,
      ctx,
      [
        op("suggest_checkpoint", {
          name: "Problem defined",
          reason: "area_defined",
          summary: "The problem statement is settled enough to build on.",
        }),
      ],
      ANSWER,
    );
    expect(outcome).toBe("completed");
    expect(changed).toBe(false);
    expect(stub.commit).toHaveBeenCalledTimes(1);
    expect(stub.sent()?.fields).toEqual([]);
    expect(stub.sent()?.assistantText).toBe(ANSWER);
  });

  describe("consequential operations are not applied here", () => {
    it("defers a connected change to the approval machinery", async () => {
      const stub = stubCommit();
      const { outcomes } = await commitTurn(
        stub.commit,
        ctx,
        [
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
        ],
        ANSWER,
      );

      expect(outcomes[0]).toEqual({
        applied: false,
        kind: "propose_connected_change",
        reason: "deferred",
      });
      // Nothing about it is written: approval is a deterministic state machine
      // (T11), and prose cannot stand in for it (docs/AI_SYSTEM.md §6).
      expect(stub.sent()?.fields).toEqual([]);
      expect(stub.sent()?.assumptions).toEqual([]);
    });

    it("still refuses a malformed connected change", async () => {
      const stub = stubCommit();
      const { outcomes } = await commitTurn(
        stub.commit,
        ctx,
        [
          op("propose_connected_change", {
            title: "Approved already",
            items: [],
          }),
        ],
        ANSWER,
      );
      expect(outcomes[0]).toMatchObject({ applied: false, reason: "rejected" });
    });

    it("defers a checkpoint", async () => {
      const stub = stubCommit();
      const { outcomes } = await commitTurn(
        stub.commit,
        ctx,
        [
          op("suggest_checkpoint", {
            name: "Problem defined",
            reason: "area_defined",
            summary: "The problem statement is settled enough to build on.",
          }),
        ],
        ANSWER,
      );
      expect(outcomes[0]).toMatchObject({ applied: false, reason: "deferred" });
    });
  });

  it("refuses a scene, which belongs to a different boundary", async () => {
    const stub = stubCommit();
    const { outcomes } = await commitTurn(
      stub.commit,
      ctx,
      [op("recommend_canvas_scene", { renderer: "problem_exploration" })],
      ANSWER,
    );
    expect(outcomes[0]).toMatchObject({ applied: false, reason: "rejected" });
    // It reaches no write path: the transaction is asked for nothing.
    expect(stub.sent()?.fields).toEqual([]);
    expect(stub.sent()?.assumptions).toEqual([]);
  });

  describe("add_evidence is staged, not applied immediately (T10 review round 2, P0-B)", () => {
    it("stages the receipt from context, never a target — the target is the receipt's own", async () => {
      const stub = stubCommit((writes) => ({
        outcome: "completed",
        written: {
          "0": (writes as unknown as { evidence: unknown[] }).evidence.length,
        },
        refused: {},
      }));
      const { outcomes, changed } = await commitTurn(
        stub.commit,
        { ...ctx, activeFindingId: "receipt-1" },
        [
          op("add_evidence", {
            consequenceSummary: "It supports X but not Y.",
            direction: "supports",
          }),
        ],
        ANSWER,
      );

      expect(outcomes).toEqual([
        { applied: true, kind: "add_evidence", count: 1 },
      ]);
      expect(changed).toBe(true);
      expect(
        (stub.sent() as unknown as { evidence: unknown[] })?.evidence,
      ).toEqual([
        {
          slot: 0,
          receipt_id: "receipt-1",
          consequence_summary: "It supports X but not Y.",
          direction: "supports",
        },
      ]);
    });

    it("refuses without reaching the database when there is no receipt in context", async () => {
      const stub = stubCommit();
      const { outcomes } = await commitTurn(
        stub.commit,
        ctx, // no activeFindingId
        [
          op("add_evidence", {
            consequenceSummary: "It supports X.",
            direction: "supports",
          }),
        ],
        ANSWER,
      );
      expect(outcomes[0]).toMatchObject({
        applied: false,
        reason: "rejected",
        issue: "no_active_research",
      });
      // Refused here, in TypeScript — never sent to the database at all.
      expect(
        (stub.sent() as unknown as { evidence: unknown[] } | undefined)
          ?.evidence,
      ).toEqual([]);
    });

    it("refuses a candidate missing a direction, never defaulting one", async () => {
      const stub = stubCommit();
      const { outcomes } = await commitTurn(
        stub.commit,
        { ...ctx, activeFindingId: "receipt-1" },
        [op("add_evidence", { consequenceSummary: "It supports X." })],
        ANSWER,
      );
      expect(outcomes[0]).toMatchObject({ applied: false, reason: "rejected" });
    });

    it("surfaces a database refusal (already linked, no focal object) in words a person can act on", async () => {
      const stub = stubCommit({
        outcome: "completed",
        written: {},
        refused: { "0": ["already_linked"] },
      });
      const { outcomes, changed } = await commitTurn(
        stub.commit,
        { ...ctx, activeFindingId: "receipt-1" },
        [
          op("add_evidence", {
            consequenceSummary: "It supports X.",
            direction: "supports",
          }),
        ],
        ANSWER,
      );
      expect(outcomes[0]).toMatchObject({
        applied: false,
        reason: "rejected",
        issue: "This finding was already added as evidence.",
      });
      expect(changed).toBe(false);
    });
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
    const stub = stubCommit();
    await commitTurn(
      stub.commit,
      ctx,
      [op("update_project_model", fieldWithQuote(value, quote))],
      ANSWER,
    );
    return stub.sent()?.fields[0] as {
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
    const stub = stubCommit();
    await commitTurn(
      stub.commit,
      ctx,
      [
        op("record_assumption", {
          ...validAssumption,
          statement: "at the end of a tenancy",
          quotedFromMessage: "at the end of a tenancy",
        }),
      ],
      ANSWER,
    );
    expect(stub.sent()?.assumptions[0]).toMatchObject({
      origin: "user_stated",
      source_excerpt: "at the end of a tenancy",
    });
  });

  it("refuses `researched` outright, since no research exists yet", async () => {
    const stub = stubCommit();
    const { outcomes } = await commitTurn(
      stub.commit,
      ctx,
      [
        op("update_project_model", {
          updates: [{ ...validUpdate.updates[0], origin: "researched" }],
        }),
      ],
      ANSWER,
    );
    // A turn claiming research before T10 is claiming evidence that cannot
    // exist, so the shape is refused rather than downgraded.
    expect(outcomes[0]).toMatchObject({ applied: false, reason: "rejected" });
    expect(stub.sent()?.fields).toEqual([]);
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
