import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { applyModelOperation } from "./model-operations";

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

type WriteResult = { error: { code: string } | null };

function stubClient() {
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
  const from = vi.fn((table: string) => ({ table, upsert, insert }));
  return {
    client: { from } as unknown as SupabaseClient,
    from,
    upsert,
    insert,
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
      PROJECT,
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
    await applyModelOperation(stub.client, PROJECT, "update_project_model", {
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
      PROJECT,
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
      PROJECT,
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
      PROJECT,
      "record_assumption",
      {
        statement: "Smaller agencies feel this most.",
        whyItMatters: "It decides who the first customer is.",
        alternatives: ["Larger agencies have more disputes by volume."],
        importance: "material",
        origin: "user_stated",
      },
    );

    expect(outcome).toMatchObject({ applied: true });
    expect(stub.from).toHaveBeenCalledWith("assumptions");
    expect(stub.insert.mock.calls[0][0]).toMatchObject({
      project_id: PROJECT,
      origin: "user_stated",
      alternatives: ["Larger agencies have more disputes by volume."],
    });
  });

  it("reports a failed write as a refusal rather than a success", async () => {
    const stub = stubClient();
    stub.upsert.mockResolvedValueOnce({ error: { code: "42501" } });
    const outcome = await applyModelOperation(
      stub.client,
      PROJECT,
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
        PROJECT,
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
        PROJECT,
        "propose_connected_change",
        { title: "Approved already", items: [] },
      );
      expect(outcome).toMatchObject({ applied: false, reason: "rejected" });
    });

    it("defers a checkpoint", async () => {
      const stub = stubClient();
      const outcome = await applyModelOperation(
        stub.client,
        PROJECT,
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
      PROJECT,
      "recommend_canvas_scene",
      { renderer: "problem_exploration" },
    );
    expect(outcome).toMatchObject({ applied: false, reason: "rejected" });
    expect(stub.from).not.toHaveBeenCalled();
  });
});
