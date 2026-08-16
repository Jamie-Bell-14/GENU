import {
  deleteDevField,
  getDevField,
  upsertDevField,
  type DevFieldOrigin,
  type DevFieldSupport,
} from "./dev-project-fields";

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
 * the review sheet, canvas and outcome mechanics an e2e run can actually
 * observe.
 */

interface StoredProposalItem {
  id: string;
  area: string;
  key: string;
  before: string | null;
  after: string;
  included: boolean;
  /**
   * The field's own origin/support at the same moment `before` was
   * snapshotted (mirrors `change_items.before_origin`/`before_support`) — so
   * undo can restore what approval overwrites in full, not only the text.
   */
  beforeOrigin: DevFieldOrigin | null;
  beforeSupport: DevFieldSupport | null;
}

interface StoredProposal {
  id: string;
  title: string;
  rationale: string;
  remainingUncertainty: string | null;
  status:
    "proposed" | "approved" | "partially_approved" | "rejected" | "undone";
  items: StoredProposalItem[];
}

const proposals = new Map<string, StoredProposal>();

const MAX_PROPOSALS_TRACKED = 20;

export interface NewProposalItemInput {
  area: string;
  key: string;
  after: string;
}

export interface NewProposalInput {
  title: string;
  rationale: string;
  remainingUncertainty: string | null;
  items: NewProposalItemInput[];
}

/**
 * `before`/`beforeOrigin`/`beforeSupport` are never taken from the caller
 * (mirrors `complete_turn`: an engine's own claimed "current value" is not
 * trusted) — each item's snapshot is read fresh from the dev field store at
 * the instant the proposal is created.
 */
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
    items: input.items.map((item) => {
      const existing = getDevField(item.area, item.key);
      return {
        id: crypto.randomUUID(),
        area: item.area,
        key: item.key,
        before: existing?.value ?? null,
        after: item.after,
        included: true,
        beforeOrigin: existing?.origin ?? null,
        beforeSupport: existing?.support ?? null,
      };
    }),
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
 * fabricating a partial proposal. A candidate's own `before` (if present) is
 * read and discarded — see `createDevProposal`.
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
    items.push({ area: item.area, key: item.key, after: item.after });
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
 * silently re-deciding it. An included item's field is upserted with
 * origin='ai_inferred'/support='hypothesis' (T11 review round 2, P1), the
 * same values `apply_change_proposal` writes, so the dev canvas visibly
 * reflects what the person actually approved.
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
      upsertDevField({
        area: item.area,
        key: item.key,
        value: item.after,
        origin: "ai_inferred",
        support: "hypothesis",
      });
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
 * the same reason `decideDevProposal` has no staleness check. Restores each
 * included item's field to its `before` value, origin and support — or
 * deletes it, when `before` is null (the proposal created the field) — the
 * same restore `undo_change_proposal` performs.
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
  for (const item of proposal.items) {
    if (!item.included) continue;
    if (item.before === null || !item.beforeOrigin || !item.beforeSupport) {
      deleteDevField(item.area, item.key);
    } else {
      upsertDevField({
        area: item.area,
        key: item.key,
        value: item.before,
        origin: item.beforeOrigin,
        support: item.beforeSupport,
      });
    }
  }
  proposal.status = "undone";
  return { outcome: "completed", areas };
}

/** Test seam: the module holds process state, so tests must be able to reset. */
export function resetDevProposals(): void {
  proposals.clear();
}
