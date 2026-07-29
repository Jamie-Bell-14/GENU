import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { applyModelOperation, quoteIsFromMessage } from "./model-operations";

/**
 * The authorisation boundary for model-proposed operations
 * (docs/AI_SYSTEM.md §5, §6, §10).
 *
 * These tests stub the database, so what they check is what this module sends
 * and refuses to send — which is the part that decides whether a proposal can
 * reach a row it should not.
 */
const PROJECT = "11111111-0000-4000-8000-000000000001";
const OTHER_PROJECT = "22222222-0000-4000-8000-000000000002";

/** The message the server actually received, against which quotes are checked. */
const USER_MESSAGE =
  "Landlords and tenants argue about property condition at the end of a tenancy.";

const ctx = { projectId: PROJECT, userMessage: USER_MESSAGE };

type WriteResult = { error: { code: string } | null };

interface ExistingField {
  area: string;
  key: string;
  origin: string;
  value: string;
}

function stubClient(existing: ExistingField[] = []) {
  // Typed with their arguments so the assertions below can read what was
  // actually written, which is the thing under test.
  const upsert = vi.fn(
    async (rows: unknown, options?: unknown): Promise<WriteResult> => {
      void rows;
      void options;
      return { error: null };
    },
  );
  const insert = vi.fn(async (row: unknown): Promise<WriteResult> => {
    void row;
    return { error: null };
  });
  /*
    `update_project_model` reads what is already stored before writing over it,
    so the stub has to answer that read. The chain mirrors the query the service
    builds: select → eq → in.
  */
  const select = vi.fn(() => ({
    eq: () => ({
      in: async () => ({ data: existing, error: null }),
    }),
  }));
  const from = vi.fn((table: string) => ({ table, upsert, insert, select }));
  return {
    client: { from } as unknown as SupabaseClient,
    from,
    upsert,
    insert,
    select,
  };
}

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

describe("applyModelOperation", () => {
  it("applies a low-risk field update with its origin intact", async () => {
    const stub = stubClient();
    const outcome = await applyModelOperation(
      stub.client,
      ctx,
      "update_project_model",
      validUpdate,
    );

    expect(outcome).toEqual({
      applied: true,
      kind: "update_project_model",
      count: 1,
    });
    expect(stub.from).toHaveBeenCalledWith("project_fields");
    expect(stub.upsert.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        project_id: PROJECT,
        origin: "ai_inferred",
        support: "hypothesis",
      }),
    ]);
  });

  it("takes the project from the route, never from the proposal", async () => {
    const stub = stubClient();
    /*
      The schema already rejects an unknown field, so a candidate carrying
      `project_id` never parses. This test states the property from the other
      end: whatever arrives, the row written names the authorised project.
    */
    await applyModelOperation(stub.client, ctx, "update_project_model", {
      updates: [{ ...validUpdate.updates[0] }],
    });
    const written = stub.upsert.mock.calls[0][0] as { project_id: string }[];
    expect(written.every((row) => row.project_id === PROJECT)).toBe(true);
    expect(JSON.stringify(written)).not.toContain(OTHER_PROJECT);
  });

  it("refuses a proposal carrying an extra field", async () => {
    const stub = stubClient();
    const outcome = await applyModelOperation(
      stub.client,
      ctx,
      "update_project_model",
      { ...validUpdate, project_id: OTHER_PROJECT },
    );

    expect(outcome).toMatchObject({ applied: false, reason: "rejected" });
    // Refused means nothing was written, not written-then-reverted.
    expect(stub.upsert).not.toHaveBeenCalled();
  });

  it("re-validates rather than trusting the engine's own check", async () => {
    const stub = stubClient();
    const outcome = await applyModelOperation(
      stub.client,
      ctx,
      "update_project_model",
      { updates: [{ ...validUpdate.updates[0], origin: "user_stated" }] },
    );
    expect(outcome).toMatchObject({ applied: false, reason: "rejected" });
    expect(stub.upsert).not.toHaveBeenCalled();
  });

  it("records an assumption with the alternatives it offered", async () => {
    const stub = stubClient();
    const outcome = await applyModelOperation(
      stub.client,
      ctx,
      "record_assumption",
      {
        statement: "Smaller agencies feel this most.",
        whyItMatters: "It decides who the first customer is.",
        alternatives: ["Larger agencies have more disputes by volume."],
        importance: "material",
      },
    );

    expect(outcome).toMatchObject({ applied: true });
    expect(stub.from).toHaveBeenCalledWith("assumptions");
    expect(stub.insert.mock.calls[0][0]).toMatchObject({
      project_id: PROJECT,
      // No verified quote, so it is the model's inference — which is what it is.
      origin: "ai_inferred",
      alternatives: ["Larger agencies have more disputes by volume."],
    });
  });

  it("reports a failed write as a refusal rather than a success", async () => {
    const stub = stubClient();
    stub.upsert.mockResolvedValueOnce({ error: { code: "42501" } });
    const outcome = await applyModelOperation(
      stub.client,
      ctx,
      "update_project_model",
      validUpdate,
    );
    expect(outcome).toMatchObject({ applied: false, reason: "rejected" });
  });

  describe("consequential operations are not applied here", () => {
    it("defers a connected change to the approval machinery", async () => {
      const stub = stubClient();
      const outcome = await applyModelOperation(
        stub.client,
        ctx,
        "propose_connected_change",
        {
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
        },
      );

      expect(outcome).toEqual({
        applied: false,
        kind: "propose_connected_change",
        reason: "deferred",
      });
      // Nothing is written: approval is a deterministic state machine (T11),
      // and prose cannot stand in for it (docs/AI_SYSTEM.md §6).
      expect(stub.from).not.toHaveBeenCalled();
    });

    it("still refuses a malformed connected change", async () => {
      const stub = stubClient();
      const outcome = await applyModelOperation(
        stub.client,
        ctx,
        "propose_connected_change",
        { title: "Approved already", items: [] },
      );
      expect(outcome).toMatchObject({ applied: false, reason: "rejected" });
    });

    it("defers a checkpoint", async () => {
      const stub = stubClient();
      const outcome = await applyModelOperation(
        stub.client,
        ctx,
        "suggest_checkpoint",
        {
          name: "Problem defined",
          reason: "area_defined",
          summary: "The problem statement is settled enough to build on.",
        },
      );
      expect(outcome).toMatchObject({ applied: false, reason: "deferred" });
      expect(stub.from).not.toHaveBeenCalled();
    });
  });

  it("refuses a scene, which belongs to a different boundary", async () => {
    const stub = stubClient();
    const outcome = await applyModelOperation(
      stub.client,
      ctx,
      "recommend_canvas_scene",
      { renderer: "problem_exploration" },
    );
    expect(outcome).toMatchObject({ applied: false, reason: "rejected" });
    expect(stub.from).not.toHaveBeenCalled();
  });
});

/*
  Provenance (finding 8). The model can offer evidence that something was said;
  it cannot assert it. Every case below is about who gets to decide the origin
  of a claim, which is the distinction the whole product rests on.
*/
describe("provenance is derived, not accepted", () => {
  const fieldWithQuote = (quote?: string) => ({
    updates: [
      {
        ...validUpdate.updates[0],
        ...(quote === undefined ? {} : { quotedFromMessage: quote }),
      },
    ],
  });

  it("records a genuine quotation from the current message as user-stated", async () => {
    const stub = stubClient();
    await applyModelOperation(
      stub.client,
      ctx,
      "update_project_model",
      fieldWithQuote("argue about property condition"),
    );
    expect(stub.upsert.mock.calls[0][0]).toEqual([
      expect.objectContaining({ origin: "user_stated" }),
    ]);
  });

  it("tolerates reformatted whitespace and casing in a real quotation", async () => {
    const stub = stubClient();
    await applyModelOperation(
      stub.client,
      ctx,
      "update_project_model",
      fieldWithQuote("Argue  About\nProperty Condition"),
    );
    expect(stub.upsert.mock.calls[0][0]).toEqual([
      expect.objectContaining({ origin: "user_stated" }),
    ]);
  });

  it("refuses to treat a fabricated quotation as something the person said", async () => {
    const stub = stubClient();
    const outcome = await applyModelOperation(
      stub.client,
      ctx,
      "update_project_model",
      fieldWithQuote("I want to target enterprise letting agencies"),
    );
    // Not a failure: the field is still recorded, as the inference it is.
    expect(outcome).toMatchObject({ applied: true });
    expect(stub.upsert.mock.calls[0][0]).toEqual([
      expect.objectContaining({ origin: "ai_inferred" }),
    ]);
  });

  it("refuses a paraphrase, which is not a quotation", async () => {
    const stub = stubClient();
    await applyModelOperation(
      stub.client,
      ctx,
      "update_project_model",
      fieldWithQuote("disagreements regarding the state of the property"),
    );
    expect(stub.upsert.mock.calls[0][0]).toEqual([
      expect.objectContaining({ origin: "ai_inferred" }),
    ]);
  });

  it("records an assumption as the person's when they really said it", async () => {
    const stub = stubClient();
    await applyModelOperation(stub.client, ctx, "record_assumption", {
      statement: "Condition disputes cluster at tenancy end.",
      whyItMatters: "It decides when the product has to intervene.",
      alternatives: ["They happen throughout the tenancy."],
      importance: "material",
      quotedFromMessage: "at the end of a tenancy",
    });
    expect(stub.insert.mock.calls[0][0]).toMatchObject({
      origin: "user_stated",
    });
  });

  it("refuses `researched` outright, since no research exists yet", async () => {
    const stub = stubClient();
    const outcome = await applyModelOperation(
      stub.client,
      ctx,
      "update_project_model",
      { updates: [{ ...validUpdate.updates[0], origin: "researched" }] },
    );
    // A turn claiming research before T10 is claiming evidence that cannot
    // exist, so the shape is refused rather than downgraded.
    expect(outcome).toMatchObject({ applied: false, reason: "rejected" });
    expect(stub.upsert).not.toHaveBeenCalled();
  });

  describe("quoteIsFromMessage", () => {
    it("requires the excerpt to be present in the message", () => {
      expect(quoteIsFromMessage("property condition", USER_MESSAGE)).toBe(true);
      expect(quoteIsFromMessage("rent arrears", USER_MESSAGE)).toBe(false);
    });

    it("refuses an absent or trivially short excerpt", () => {
      expect(quoteIsFromMessage(undefined, USER_MESSAGE)).toBe(false);
      // Too short to be evidence of anything: "and" appears in most messages.
      expect(quoteIsFromMessage("and", USER_MESSAGE)).toBe(false);
    });
  });
});

describe("user-owned meaning is not overwritten automatically", () => {
  const userOwned = {
    area: "problem",
    key: "primary_pain",
    origin: "user_stated",
    value: "The wording I chose myself.",
  };

  it("refuses to replace the value of a field the person stated", async () => {
    const stub = stubClient([userOwned]);
    const outcome = await applyModelOperation(
      stub.client,
      ctx,
      "update_project_model",
      validUpdate,
    );

    /*
      Changing a person's own wording is a consequential change and belongs to
      the approval path, not to a turn. Refused rather than applied-and-audited,
      so nothing is lost in the first place.
    */
    expect(outcome).toMatchObject({ applied: false, reason: "rejected" });
    expect(stub.upsert).not.toHaveBeenCalled();
  });

  it("allows an update that leaves the person's wording alone", async () => {
    const stub = stubClient([userOwned]);
    const outcome = await applyModelOperation(
      stub.client,
      ctx,
      "update_project_model",
      {
        updates: [{ ...validUpdate.updates[0], value: userOwned.value }],
      },
    );
    // Same value: this is a support or label revision, not a rewrite.
    expect(outcome).toMatchObject({ applied: true });
  });

  it("revises a field the AI already owns", async () => {
    const stub = stubClient([
      { ...userOwned, origin: "ai_inferred", value: "An earlier reading." },
    ]);
    const outcome = await applyModelOperation(
      stub.client,
      ctx,
      "update_project_model",
      validUpdate,
    );
    expect(outcome).toMatchObject({ applied: true });
  });

  it("reports a failed read rather than writing blind", async () => {
    const stub = stubClient();
    stub.select.mockReturnValueOnce({
      eq: () => ({
        in: async () => ({ data: null, error: { code: "57014" } }),
      }),
    } as unknown as ReturnType<typeof stub.select>);
    const outcome = await applyModelOperation(
      stub.client,
      ctx,
      "update_project_model",
      validUpdate,
    );
    // Without knowing what is there, the protection above cannot be applied —
    // so the write does not happen.
    expect(outcome).toMatchObject({ applied: false, reason: "rejected" });
    expect(stub.upsert).not.toHaveBeenCalled();
  });
});
