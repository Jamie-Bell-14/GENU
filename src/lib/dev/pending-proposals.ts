import type { ChangeProposalDetail } from "@/lib/services/change-proposals";

/**
 * In-memory connected-change proposal store for the development-only turn and
 * decision endpoints (T11, docs/VERTICAL_SLICE_TASKS.md).
 *
 * The real flow decides a proposal inside `apply_change_proposal` /
 * `undo_change_proposal` — a single Postgres transaction covering fields,
 * document versions, the decision row and audit. The dev routes have no
 * database at all, so they hold proposals in module state instead, exactly as
 * `pending-directions.ts` already does for steering. That is acceptable here
 * and only here: the routes using it return 404 in production, and nothing
 * outside `/api/dev/*` imports this file.
 *
 * Staleness ("stale"/"changed_since") is a real database property — a field
 * genuinely edited by another transaction between proposal and decision —
 * that an in-memory store with a single writer cannot honestly reproduce.
 * That contract is proved against Postgres in
 * supabase/tests/change-proposals-rls.test.ts; this store only has to prove
 * the review sheet and outcome mechanics an e2e run can actually observe.
 */

type StoredProposal = ChangeProposalDetail;

const proposals = new Map<string, StoredProposal>();

const MAX_PROPOSALS_TRACKED = 20;

export interface NewProposalItemInput {
  area: string;
  key: string;
  before: string | null;
  after: string;
}

export interface NewProposalInput {
  title: string;
  rationale: string;
  remainingUncertainty: string | null;
  items: NewProposalItemInput[];
}

export function createDevProposal(input: NewProposalInput): StoredProposal {
  // Bounded so a long-running dev server cannot accumulate proposals without end.
  if (proposals.size >= MAX_PROPOSALS_TRACKED) {
    const oldest = proposals.keys().next().value;
    if (oldest) proposals.delete(oldest);
  }
  const proposal: StoredProposal = {
    id: crypto.randomUUID(),
    title: input.title,
    rationale: input.rationale,
    remainingUncertainty: input.remainingUncertainty,
    status: "proposed",
    items: input.items.map((item) => ({
      id: crypto.randomUUID(),
      area: item.area,
      key: item.key,
      before: item.before,
      after: item.after,
      // Matches `change_items.included`'s own default (T11 review round 1's
      // fix to `complete_turn` stores the same default) — undecided reads as
      // "as proposed" until the person changes their mind, not as excluded.
      included: true,
    })),
  };
  proposals.set(proposal.id, proposal);
  return proposal;
}

/**
 * Builds a proposal from an engine's own `propose_connected_change`
 * candidate — `unknown` because it crossed the same engine/host boundary the
 * real `StagedOperation` does, and this narrows it by hand rather than
 * trusting the shape (SECURITY_STANDARDS.md §11: model output is not
 * authorised by construction). Returns null on anything malformed rather than
 * fabricating a partial proposal.
 */
export function createDevProposalFromCandidate(
  candidate: unknown,
): StoredProposal | null {
  if (!candidate || typeof candidate !== "object") return null;
  const value = candidate as Record<string, unknown>;
  if (
    typeof value.title !== "string" ||
    typeof value.rationale !== "string" ||
    !Array.isArray(value.items) ||
    value.items.length === 0
  ) {
    return null;
  }

  const items: NewProposalItemInput[] = [];
  for (const raw of value.items) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    if (
      typeof item.area !== "string" ||
      typeof item.key !== "string" ||
      typeof item.after !== "string"
    ) {
      return null;
    }
    items.push({
      area: item.area,
      key: item.key,
      before: typeof item.before === "string" ? item.before : null,
      after: item.after,
    });
  }

  return createDevProposal({
    title: value.title,
    rationale: value.rationale,
    remainingUncertainty:
      typeof value.remainingUncertainty === "string"
        ? value.remainingUncertainty
        : null,
    items,
  });
}

export function getDevProposal(proposalId: string): StoredProposal | null {
  return proposals.get(proposalId) ?? null;
}

export type DevDecideResult =
  | {
      outcome: "completed";
      status: "approved" | "partially_approved" | "rejected";
      decisionId: string;
      included: number;
      total: number;
      areas: string[];
    }
  | { outcome: "conflict"; reason: "already_decided"; status: string }
  | { outcome: "not_found" };

/**
 * The dev equivalent of `apply_change_proposal`'s decision pass — no
 * staleness check (see the module doc), otherwise the same rule: an item with
 * no matching decision is excluded, exclude-all is a rejection, and a
 * proposal already decided refuses with `already_decided` rather than
 * silently re-deciding it.
 */
export function decideDevProposal(
  proposalId: string,
  decisions: { itemId: string; included: boolean; after?: string }[],
): DevDecideResult {
  const proposal = proposals.get(proposalId);
  if (!proposal) return { outcome: "not_found" };
  if (proposal.status !== "proposed") {
    return {
      outcome: "conflict",
      reason: "already_decided",
      status: proposal.status,
    };
  }

  const decisionByItem = new Map(
    decisions.map((decision) => [decision.itemId, decision]),
  );
  const includedAreas = new Set<string>();
  let includedCount = 0;
  for (const item of proposal.items) {
    const decision = decisionByItem.get(item.id);
    item.included = decision?.included ?? false;
    if (decision?.after !== undefined) item.after = decision.after;
    if (item.included) {
      includedCount += 1;
      includedAreas.add(item.area);
    }
  }

  proposal.status =
    includedCount === 0
      ? "rejected"
      : includedCount === proposal.items.length
        ? "approved"
        : "partially_approved";

  return {
    outcome: "completed",
    status: proposal.status,
    decisionId: crypto.randomUUID(),
    included: includedCount,
    total: proposal.items.length,
    areas: Array.from(includedAreas),
  };
}

export type DevUndoResult =
  | { outcome: "completed"; areas: string[] }
  | { outcome: "conflict"; reason: "not_undoable"; status: string }
  | { outcome: "not_found" };

/**
 * The dev equivalent of `undo_change_proposal` — undoable only from a decided
 * (non-rejected) state, same as the real RPC; no "changed_since" conflict for
 * the same reason `decideDevProposal` has no staleness check.
 */
export function undoDevProposal(proposalId: string): DevUndoResult {
  const proposal = proposals.get(proposalId);
  if (!proposal) return { outcome: "not_found" };
  if (
    proposal.status !== "approved" &&
    proposal.status !== "partially_approved"
  ) {
    return {
      outcome: "conflict",
      reason: "not_undoable",
      status: proposal.status,
    };
  }
  const areas = Array.from(
    new Set(
      proposal.items.filter((item) => item.included).map((item) => item.area),
    ),
  );
  proposal.status = "undone";
  return { outcome: "completed", areas };
}

/** Test seam: the module holds process state, so tests must be able to reset. */
export function resetDevProposals(): void {
  proposals.clear();
}
