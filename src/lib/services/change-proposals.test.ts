import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  ApplyChangeProposalRequestSchema,
  ChangeProposalActionRequestSchema,
  UndoChangeProposalRequestSchema,
  applyChangeProposal,
  findOwnedProposalProjectId,
  loadChangeProposalDetail,
  loadPendingProposal,
  undoChangeProposal,
} from "./change-proposals";

/**
 * The client-facing side of connected-change decisions (T11): what this
 * module sends to `apply_change_proposal`/`undo_change_proposal`, and how it
 * turns their returned jsonb back into a typed result. The RPCs' own
 * transactional and ownership behaviour is proved against a real database in
 * supabase/tests/change-proposals-rls.test.ts — a stub cannot prove any of
 * that, which is exactly why it lives there instead.
 */

const PROPOSAL = "cccccccc-0000-4000-8000-000000000001";
const ITEM = "dddddddd-0000-4000-8000-000000000001";

describe("ChangeProposalActionRequestSchema", () => {
  it("accepts an approve action with zero or more decisions", () => {
    expect(
      ApplyChangeProposalRequestSchema.safeParse({
        action: "approve",
        decisions: [{ itemId: ITEM, included: true }],
      }).success,
    ).toBe(true);
    expect(
      ApplyChangeProposalRequestSchema.safeParse({
        action: "approve",
        decisions: [],
      }).success,
    ).toBe(true);
  });

  it("accepts an edited value only when it is non-empty and within bounds", () => {
    expect(
      ApplyChangeProposalRequestSchema.safeParse({
        action: "approve",
        decisions: [{ itemId: ITEM, included: true, after: "" }],
      }).success,
    ).toBe(false);
    expect(
      ApplyChangeProposalRequestSchema.safeParse({
        action: "approve",
        decisions: [{ itemId: ITEM, included: true, after: "x".repeat(2001) }],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields on a decision, closing off mass assignment", () => {
    expect(
      ApplyChangeProposalRequestSchema.safeParse({
        action: "approve",
        decisions: [{ itemId: ITEM, included: true, status: "approved" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a duplicate item id, which apply_change_proposal would otherwise let inflate the included count", () => {
    expect(
      ApplyChangeProposalRequestSchema.safeParse({
        action: "approve",
        decisions: [
          { itemId: ITEM, included: true },
          { itemId: ITEM, included: false },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects more decisions than a proposal can ever have items", () => {
    const decisions = Array.from({ length: 13 }, (_, i) => ({
      itemId: `dddddddd-0000-4000-8000-${String(i).padStart(12, "0")}`,
      included: true,
    }));
    expect(
      ApplyChangeProposalRequestSchema.safeParse({
        action: "approve",
        decisions,
      }).success,
    ).toBe(false);
  });

  it("accepts an undo action with no other fields", () => {
    expect(
      UndoChangeProposalRequestSchema.safeParse({ action: "undo" }).success,
    ).toBe(true);
    expect(
      UndoChangeProposalRequestSchema.safeParse({
        action: "undo",
        decisions: [],
      }).success,
    ).toBe(false);
  });

  it("discriminates on action, rejecting an unknown one", () => {
    expect(
      ChangeProposalActionRequestSchema.safeParse({ action: "reject" }).success,
    ).toBe(false);
  });
});

function stubClient(overrides: {
  rpc?: (
    name: string,
    args: unknown,
  ) => Promise<{ data: unknown; error: unknown }>;
}) {
  return {
    rpc: overrides.rpc ?? (async () => ({ data: null, error: null })),
  } as unknown as SupabaseClient;
}

describe("applyChangeProposal", () => {
  it("maps decisions to the RPC's own item_id/included/after shape, omitting after when unedited", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        outcome: "completed",
        status: "approved",
        decision_id: "decision-1",
        included: 1,
        total: 1,
        areas: ["customer"],
      },
      error: null,
    }));
    const client = stubClient({ rpc });

    await applyChangeProposal(client, {
      proposalId: PROPOSAL,
      decisions: [{ itemId: ITEM, included: true }],
    });

    expect(rpc).toHaveBeenCalledWith("apply_change_proposal", {
      p_proposal_id: PROPOSAL,
      p_decisions: [{ item_id: ITEM, included: true }],
    });
  });

  it("includes after only for an edited item", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        outcome: "completed",
        status: "approved",
        included: 1,
        total: 1,
        areas: [],
      },
      error: null,
    }));
    const client = stubClient({ rpc });

    await applyChangeProposal(client, {
      proposalId: PROPOSAL,
      decisions: [{ itemId: ITEM, included: true, after: "Edited value" }],
    });

    expect(rpc).toHaveBeenCalledWith(
      "apply_change_proposal",
      expect.objectContaining({
        p_decisions: [{ item_id: ITEM, included: true, after: "Edited value" }],
      }),
    );
  });

  it("reports a real transactional outcome as completed", async () => {
    const client = stubClient({
      rpc: async () => ({
        data: {
          outcome: "completed",
          status: "partially_approved",
          decision_id: "decision-1",
          included: 1,
          total: 2,
          areas: ["customer"],
        },
        error: null,
      }),
    });
    await expect(
      applyChangeProposal(client, { proposalId: PROPOSAL, decisions: [] }),
    ).resolves.toEqual({
      outcome: "completed",
      status: "partially_approved",
      decisionId: "decision-1",
      included: 1,
      total: 2,
      areas: ["customer"],
    });
  });

  it("reports a stale item as a conflict, never as a success", async () => {
    const client = stubClient({
      rpc: async () => ({
        data: { outcome: "conflict", reason: "stale", item_id: ITEM },
        error: null,
      }),
    });
    await expect(
      applyChangeProposal(client, { proposalId: PROPOSAL, decisions: [] }),
    ).resolves.toEqual({ outcome: "conflict", reason: "stale", itemId: ITEM });
  });

  it("reports an already-decided proposal as a conflict", async () => {
    const client = stubClient({
      rpc: async () => ({
        data: {
          outcome: "conflict",
          reason: "already_decided",
          status: "approved",
        },
        error: null,
      }),
    });
    await expect(
      applyChangeProposal(client, { proposalId: PROPOSAL, decisions: [] }),
    ).resolves.toEqual({
      outcome: "conflict",
      reason: "already_decided",
      status: "approved",
    });
  });

  it("distinguishes ownership refusal (not_found) from a genuine failure (unavailable)", async () => {
    const notOwned = stubClient({
      rpc: async () => ({
        data: null,
        error: { message: "not_found_or_not_owner", code: "42501" },
      }),
    });
    await expect(
      applyChangeProposal(notOwned, { proposalId: PROPOSAL, decisions: [] }),
    ).resolves.toEqual({ outcome: "not_found" });

    const brokenConnection = stubClient({
      rpc: async () => ({
        data: null,
        error: { message: "connection reset", code: "08006" },
      }),
    });
    await expect(
      applyChangeProposal(brokenConnection, {
        proposalId: PROPOSAL,
        decisions: [],
      }),
    ).resolves.toEqual({ outcome: "unavailable" });
  });
});

describe("undoChangeProposal", () => {
  it("reports a real undo as completed with the areas it touched", async () => {
    const client = stubClient({
      rpc: async () => ({
        data: {
          outcome: "completed",
          areas: ["customer", "value_proposition"],
        },
        error: null,
      }),
    });
    await expect(undoChangeProposal(client, PROPOSAL)).resolves.toEqual({
      outcome: "completed",
      areas: ["customer", "value_proposition"],
    });
  });

  it("reports a drifted field as a conflict rather than silently overwriting it", async () => {
    const client = stubClient({
      rpc: async () => ({
        data: { outcome: "conflict", reason: "changed_since", item_id: ITEM },
        error: null,
      }),
    });
    await expect(undoChangeProposal(client, PROPOSAL)).resolves.toEqual({
      outcome: "conflict",
      reason: "changed_since",
      itemId: ITEM,
    });
  });

  it("reports a non-undoable status as a conflict", async () => {
    const client = stubClient({
      rpc: async () => ({
        data: {
          outcome: "conflict",
          reason: "not_undoable",
          status: "rejected",
        },
        error: null,
      }),
    });
    await expect(undoChangeProposal(client, PROPOSAL)).resolves.toEqual({
      outcome: "conflict",
      reason: "not_undoable",
      status: "rejected",
    });
  });
});

function chainReturning(row: unknown, rows?: unknown[]) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: row }),
    returns: async () => ({ data: rows }),
  };
  return chain;
}

describe("findOwnedProposalProjectId", () => {
  it("names the project a proposal actually belongs to", async () => {
    const client = {
      from: () => chainReturning({ project_id: "project-1" }),
    } as unknown as SupabaseClient;
    await expect(findOwnedProposalProjectId(client, PROPOSAL)).resolves.toBe(
      "project-1",
    );
  });

  it("returns nothing for a proposal RLS hides — foreign or nonexistent alike", async () => {
    const client = {
      from: () => chainReturning(null),
    } as unknown as SupabaseClient;
    await expect(
      findOwnedProposalProjectId(client, PROPOSAL),
    ).resolves.toBeNull();
  });
});

describe("loadChangeProposalDetail", () => {
  it("returns the proposal with its items in the application's own field names", async () => {
    const client = {
      from: (table: string) =>
        table === "change_proposals"
          ? chainReturning({
              id: PROPOSAL,
              title: "Narrow the target customer",
              rationale: "The evidence points at smaller agencies.",
              remaining_uncertainty: "No pricing evidence yet.",
              status: "proposed",
            })
          : chainReturning(null, [
              {
                id: ITEM,
                area: "customer",
                key: "primary_customer",
                before: "Letting agencies",
                after: "Letting agencies under 20 staff",
                included: true,
              },
            ]),
    } as unknown as SupabaseClient;

    await expect(loadChangeProposalDetail(client, PROPOSAL)).resolves.toEqual({
      id: PROPOSAL,
      title: "Narrow the target customer",
      rationale: "The evidence points at smaller agencies.",
      remainingUncertainty: "No pricing evidence yet.",
      status: "proposed",
      items: [
        {
          id: ITEM,
          area: "customer",
          key: "primary_customer",
          before: "Letting agencies",
          after: "Letting agencies under 20 staff",
          included: true,
        },
      ],
    });
  });

  it("returns nothing for a proposal that does not exist or is not owned", async () => {
    const client = {
      from: () => chainReturning(null, []),
    } as unknown as SupabaseClient;
    await expect(
      loadChangeProposalDetail(client, PROPOSAL),
    ).resolves.toBeNull();
  });
});

describe("loadPendingProposal", () => {
  it("returns the most recent still-proposed proposal, with its distinct areas and matched object ids", async () => {
    const client = {
      from: (table: string) => {
        if (table === "change_proposals") {
          return chainReturning({
            id: PROPOSAL,
            title: "Narrow the target customer",
            rationale: "The evidence points at smaller agencies.",
            source_turn_id: "turn-1",
          });
        }
        if (table === "change_items") {
          // Realistic data: `change_items` has a unique (proposal_id, area,
          // key) constraint, so a proposal never repeats the same target.
          return chainReturning(null, [
            { area: "customer", key: "primary_customer" },
            { area: "value_proposition", key: "core_value" },
          ]);
        }
        // project_fields — only the customer field already exists; the
        // value-proposition item is a new field the proposal would create,
        // so it has no canvas object to match.
        return chainReturning(null, [
          { id: "field-1", area: "customer", key: "primary_customer" },
        ]);
      },
    } as unknown as SupabaseClient;

    await expect(loadPendingProposal(client, "project-1")).resolves.toEqual({
      id: PROPOSAL,
      title: "Narrow the target customer",
      rationale: "The evidence points at smaller agencies.",
      areas: ["customer", "value_proposition"],
      objectIds: ["field-1"],
      turnId: "turn-1",
    });
  });

  it("returns nothing when no proposal is currently awaiting review", async () => {
    const client = {
      from: () => chainReturning(null),
    } as unknown as SupabaseClient;
    await expect(loadPendingProposal(client, "project-1")).resolves.toBeNull();
  });
});
