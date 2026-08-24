import { afterEach, describe, expect, it } from "vitest";
import {
  createDevProposal,
  createDevProposalFromCandidate,
  decideDevProposal,
  getDevProposal,
  resetDevProposals,
  undoDevProposal,
} from "./pending-proposals";
import {
  getDevField,
  resetDevFields,
  upsertDevField,
} from "./dev-project-fields";

/**
 * The in-memory connected-change proposal store behind the dev-only turn and
 * decision endpoints (T11) — the decision rules `apply_change_proposal` /
 * `undo_change_proposal` enforce in Postgres, minus staleness (a genuine
 * database property this single-writer store cannot reproduce; see the
 * module doc), plus the dev field store (`dev-project-fields.ts`) a decision
 * actually mutates so the dev canvas has something real to show.
 */

afterEach(() => {
  resetDevProposals();
  resetDevFields();
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
        after: "Letting agencies under 20 staff",
      },
      {
        area: "problem",
        key: "core_problem",
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

  it("snapshots before/beforeOrigin/beforeSupport from the real dev field store, never from the caller", () => {
    upsertDevField({
      area: "customer",
      key: "primary_customer",
      value: "Letting agencies",
      origin: "user_stated",
      support: "credible",
    });
    const created = proposal();
    const customerItem = created.items.find(
      (item) => item.area === "customer",
    )!;
    expect(customerItem.before).toBe("Letting agencies");
    expect(customerItem.beforeOrigin).toBe("user_stated");
    expect(customerItem.beforeSupport).toBe("credible");

    // The other item's field does not exist yet.
    const problemItem = created.items.find((item) => item.area === "problem")!;
    expect(problemItem.before).toBeNull();
    expect(problemItem.beforeOrigin).toBeNull();
    expect(problemItem.beforeSupport).toBeNull();
  });
});

describe("createDevProposalFromCandidate", () => {
  it("builds a proposal from a well-formed candidate", () => {
    const created = createDevProposalFromCandidate({
      title: "T",
      rationale: "R",
      remainingUncertainty: "U",
      items: [{ area: "customer", key: "k", before: "ignored", after: "a" }],
    });
    expect(created).not.toBeNull();
    expect(created!.title).toBe("T");
    expect(created!.items).toHaveLength(1);
    // The candidate's own "before" is discarded — never trusted from the
    // engine, the same rule complete_turn applies.
    expect(created!.items[0].before).toBeNull();
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

  it("upserts the dev field store for every included item, with ai_inferred/hypothesis provenance", () => {
    const created = proposal();
    decideDevProposal(created.id, [
      { itemId: created.items[0].id, included: true },
      { itemId: created.items[1].id, included: false },
    ]);
    expect(getDevField("customer", "primary_customer")).toMatchObject({
      value: "Letting agencies under 20 staff",
      origin: "ai_inferred",
      support: "hypothesis",
    });
    expect(getDevField("problem", "core_problem")).toBeNull();
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

  it("deletes a field the proposal itself created, and restores one that pre-existed with its own origin/support", () => {
    upsertDevField({
      area: "customer",
      key: "primary_customer",
      value: "Letting agencies",
      origin: "user_stated",
      support: "credible",
    });
    const created = proposal();
    decideDevProposal(
      created.id,
      created.items.map((item) => ({ itemId: item.id, included: true })),
    );

    undoDevProposal(created.id);

    expect(getDevField("customer", "primary_customer")).toMatchObject({
      value: "Letting agencies",
      origin: "user_stated",
      support: "credible",
    });
    // "problem" was created by this proposal (no field existed before) — undo
    // deletes it rather than leaving an empty value behind.
    expect(getDevField("problem", "core_problem")).toBeNull();
  });
});
