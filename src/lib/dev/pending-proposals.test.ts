import { afterEach, describe, expect, it } from "vitest";
import {
  createDevProposal,
  createDevProposalFromCandidate,
  decideDevProposal,
  getDevProposal,
  resetDevProposals,
  undoDevProposal,
} from "./pending-proposals";

/**
 * The in-memory connected-change proposal store behind the dev-only turn and
 * decision endpoints (T11) — the decision rules `apply_change_proposal` /
 * `undo_change_proposal` enforce in Postgres, minus staleness (a genuine
 * database property this single-writer store cannot reproduce; see the
 * module doc).
 */

afterEach(() => {
  resetDevProposals();
});

function proposal() {
  return createDevProposal({
    title: "Narrow the target customer",
    rationale: "The evidence points at smaller agencies.",
    remainingUncertainty: "No pricing evidence yet.",
    items: [
      {
        area: "customer",
        key: "primary_customer",
        before: "Letting agencies",
        after: "Letting agencies under 20 staff",
      },
      {
        area: "problem",
        key: "core_problem",
        before: null,
        after: "Faster deposit disputes for small agencies",
      },
    ],
  });
}

describe("createDevProposal", () => {
  it("defaults every item to included, matching change_items' own default", () => {
    const created = proposal();
    expect(created.status).toBe("proposed");
    expect(created.items.every((item) => item.included)).toBe(true);
  });
});

describe("createDevProposalFromCandidate", () => {
  it("builds a proposal from a well-formed candidate", () => {
    const created = createDevProposalFromCandidate({
      title: "T",
      rationale: "R",
      remainingUncertainty: "U",
      items: [{ area: "customer", key: "k", before: "b", after: "a" }],
    });
    expect(created).not.toBeNull();
    expect(created!.title).toBe("T");
    expect(created!.items).toHaveLength(1);
  });

  it("refuses a malformed candidate rather than fabricating a partial proposal", () => {
    expect(createDevProposalFromCandidate(null)).toBeNull();
    expect(createDevProposalFromCandidate({ title: "T" })).toBeNull();
    expect(
      createDevProposalFromCandidate({ title: "T", rationale: "R", items: [] }),
    ).toBeNull();
    expect(
      createDevProposalFromCandidate({
        title: "T",
        rationale: "R",
        items: [{ area: "customer", key: "k" }],
      }),
    ).toBeNull();
  });
});

describe("decideDevProposal", () => {
  it("marks unmentioned items excluded — silence is not consent", () => {
    const created = proposal();
    const result = decideDevProposal(created.id, [
      { itemId: created.items[0].id, included: true },
    ]);
    expect(result).toMatchObject({
      outcome: "completed",
      status: "partially_approved",
      included: 1,
      total: 2,
    });
    const stored = getDevProposal(created.id)!;
    expect(stored.items[0].included).toBe(true);
    expect(stored.items[1].included).toBe(false);
  });

  it("reads exclude-all as a rejection", () => {
    const created = proposal();
    const result = decideDevProposal(created.id, []);
    expect(result).toMatchObject({
      outcome: "completed",
      status: "rejected",
      included: 0,
    });
  });

  it("records an edited value only for the item it belongs to", () => {
    const created = proposal();
    decideDevProposal(created.id, [
      { itemId: created.items[0].id, included: true, after: "Edited value" },
      { itemId: created.items[1].id, included: true },
    ]);
    const stored = getDevProposal(created.id)!;
    expect(stored.items[0].after).toBe("Edited value");
    expect(stored.items[1].after).toBe(
      "Faster deposit disputes for small agencies",
    );
  });

  it("refuses to re-decide an already-decided proposal", () => {
    const created = proposal();
    decideDevProposal(created.id, []);
    const second = decideDevProposal(created.id, [
      { itemId: created.items[0].id, included: true },
    ]);
    expect(second).toEqual({
      outcome: "conflict",
      reason: "already_decided",
      status: "rejected",
    });
  });

  it("reports a proposal that does not exist as not_found", () => {
    expect(decideDevProposal("missing", [])).toEqual({ outcome: "not_found" });
  });
});

describe("undoDevProposal", () => {
  it("undoes an approved proposal, naming the areas it touched", () => {
    const created = proposal();
    decideDevProposal(
      created.id,
      created.items.map((item) => ({ itemId: item.id, included: true })),
    );
    const result = undoDevProposal(created.id);
    expect(result).toEqual({
      outcome: "completed",
      areas: ["customer", "problem"],
    });
    expect(getDevProposal(created.id)!.status).toBe("undone");
  });

  it("refuses to undo a rejected proposal", () => {
    const created = proposal();
    decideDevProposal(created.id, []);
    expect(undoDevProposal(created.id)).toEqual({
      outcome: "conflict",
      reason: "not_undoable",
      status: "rejected",
    });
  });

  it("refuses to undo a proposal still awaiting review", () => {
    const created = proposal();
    expect(undoDevProposal(created.id)).toEqual({
      outcome: "conflict",
      reason: "not_undoable",
      status: "proposed",
    });
  });
});
