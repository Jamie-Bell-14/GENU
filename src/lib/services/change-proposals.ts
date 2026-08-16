import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Approving, partially approving, rejecting or undoing a connected-change
 * proposal (docs/VERTICAL_SLICE_TASKS.md T11, docs/ARCHITECTURE.md §11).
 *
 * Both RPCs run as the person themselves, not the service-role trusted
 * writer: `apply_change_proposal`/`undo_change_proposal` are `security
 * definer` with an explicit `auth.uid()` ownership check (see
 * `20260817090000_change_proposals.sql`'s header), reachable directly from
 * the user-scoped client the route already holds — this is a person's own
 * decision, not a system write on their behalf.
 */

export const MAX_ITEM_VALUE_LENGTH = 2000;

const ChangeDecisionSchema = z
  .object({
    itemId: z.string().uuid(),
    included: z.boolean(),
    /** Present only when the person edited the proposed value before approving. */
    after: z
      .string()
      .trim()
      .min(1, "An edited value cannot be empty.")
      .max(
        MAX_ITEM_VALUE_LENGTH,
        `Values are limited to ${MAX_ITEM_VALUE_LENGTH} characters.`,
      )
      .optional(),
  })
  .strict();

export const ApplyChangeProposalRequestSchema = z
  .object({
    action: z.literal("approve"),
    /**
     * One entry per item the review sheet showed. An item with no matching
     * entry is treated as excluded by the database function — silence is not
     * consent — so the client is expected to submit a decision for every
     * item, not only the ones the person changed.
     */
    decisions: z.array(ChangeDecisionSchema),
  })
  .strict();

export const UndoChangeProposalRequestSchema = z
  .object({ action: z.literal("undo") })
  .strict();

export const ChangeProposalActionRequestSchema = z.discriminatedUnion(
  "action",
  [ApplyChangeProposalRequestSchema, UndoChangeProposalRequestSchema],
);

export type ApplyChangeProposalRequest = z.infer<
  typeof ApplyChangeProposalRequestSchema
>;

export type ApplyChangeProposalResult =
  | {
      outcome: "completed";
      status: "approved" | "partially_approved" | "rejected";
      decisionId: string | null;
      included: number;
      total: number;
      areas: string[];
    }
  | { outcome: "conflict"; reason: "already_decided"; status: string }
  | { outcome: "conflict"; reason: "stale"; itemId: string }
  | { outcome: "not_found" }
  | { outcome: "unavailable" };

export type UndoChangeProposalResult =
  | { outcome: "completed"; areas: string[] }
  | { outcome: "conflict"; reason: "not_undoable"; status: string }
  | { outcome: "conflict"; reason: "changed_since"; itemId: string }
  | { outcome: "not_found" }
  | { outcome: "unavailable" };

export interface ChangeProposalItemDetail {
  id: string;
  area: string;
  key: string;
  /** Null means the model believes this field does not exist yet. */
  before: string | null;
  after: string;
  included: boolean;
}

export interface ChangeProposalDetail {
  id: string;
  title: string;
  rationale: string;
  remainingUncertainty: string | null;
  status:
    "proposed" | "approved" | "partially_approved" | "rejected" | "undone";
  items: ChangeProposalItemDetail[];
}

interface ProposalRow {
  id: string;
  title: string;
  rationale: string;
  remaining_uncertainty: string | null;
  status: ChangeProposalDetail["status"];
}

interface ItemRow {
  id: string;
  area: string;
  key: string;
  before: string | null;
  after: string;
  included: boolean;
}

/**
 * The proposal and its items, read directly under `change_proposals`' and
 * `change_items`' own SELECT-only RLS policies — the review sheet's data
 * need is a read, not a decision, so it goes through the ordinary
 * project-owner-scoped client rather than a bespoke endpoint.
 */
export async function loadChangeProposalDetail(
  supabase: SupabaseClient,
  proposalId: string,
): Promise<ChangeProposalDetail | null> {
  const [{ data: proposal }, { data: items }] = await Promise.all([
    supabase
      .from("change_proposals")
      .select("id, title, rationale, remaining_uncertainty, status")
      .eq("id", proposalId)
      .maybeSingle<ProposalRow>(),
    supabase
      .from("change_items")
      .select("id, area, key, before, after, included")
      .eq("proposal_id", proposalId)
      .order("area", { ascending: true })
      .returns<ItemRow[]>(),
  ]);
  if (!proposal) return null;
  return {
    id: proposal.id,
    title: proposal.title,
    rationale: proposal.rationale,
    remainingUncertainty: proposal.remaining_uncertainty,
    status: proposal.status,
    items: (items ?? []).map((row) => ({
      id: row.id,
      area: row.area,
      key: row.key,
      before: row.before,
      after: row.after,
      included: row.included,
    })),
  };
}

export interface PendingProposalHydration {
  id: string;
  title: string;
  rationale: string;
  areas: string[];
  /** The turn whose `complete_turn` call created it, for the in-stream card. */
  turnId: string;
}

/**
 * The project's most recent undecided proposal, if any — read the same way
 * `loadLatestResearchReceipt` recovers a still-current research receipt on
 * reload: a fresh mount already knows this, so `TurnState.pendingProposal`
 * does not have to wait for a live `proposal_created` event to show the card
 * for a proposal an earlier session already created.
 */
export async function loadPendingProposal(
  supabase: SupabaseClient,
  projectId: string,
): Promise<PendingProposalHydration | null> {
  const { data: proposal } = await supabase
    .from("change_proposals")
    .select("id, title, rationale, source_turn_id")
    .eq("project_id", projectId)
    .eq("status", "proposed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      title: string;
      rationale: string;
      source_turn_id: string;
    }>();
  if (!proposal) return null;

  const { data: items } = await supabase
    .from("change_items")
    .select("area")
    .eq("proposal_id", proposal.id)
    .returns<{ area: string }[]>();

  return {
    id: proposal.id,
    title: proposal.title,
    rationale: proposal.rationale,
    areas: Array.from(new Set((items ?? []).map((row) => row.area))),
    turnId: proposal.source_turn_id,
  };
}

/**
 * The proposal a person actually owns, or nothing — used by the route to
 * confirm the URL's project id matches the proposal before deciding it, so a
 * mismatched project in the path 404s rather than silently acting on a
 * proposal that lives elsewhere. Relies on `change_proposals`' own
 * SELECT-only RLS policy (`private.is_project_owner`), so this can never
 * confirm a proposal the caller does not own either.
 */
export async function findOwnedProposalProjectId(
  supabase: SupabaseClient,
  proposalId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("change_proposals")
    .select("project_id")
    .eq("id", proposalId)
    .maybeSingle<{ project_id: string }>();
  return data?.project_id ?? null;
}

/** Distinguishes the two exceptions the RPCs raise (never a fault) from a real failure. */
function isOwnershipError(message: string): boolean {
  return (
    message === "not_authenticated" || message === "not_found_or_not_owner"
  );
}

export async function applyChangeProposal(
  supabase: SupabaseClient,
  input: {
    proposalId: string;
    decisions: ApplyChangeProposalRequest["decisions"];
  },
): Promise<ApplyChangeProposalResult> {
  const { data, error } = await supabase.rpc("apply_change_proposal", {
    p_proposal_id: input.proposalId,
    p_decisions: input.decisions.map((decision) => ({
      item_id: decision.itemId,
      included: decision.included,
      ...(decision.after !== undefined ? { after: decision.after } : {}),
    })),
  });

  if (error) {
    if (isOwnershipError(error.message)) return { outcome: "not_found" };
    console.error("apply_change_proposal failed", { code: error.code });
    return { outcome: "unavailable" };
  }

  const result = data as {
    outcome: "completed" | "conflict";
    status?: string;
    reason?: string;
    item_id?: string;
    decision_id?: string | null;
    included?: number;
    total?: number;
    areas?: string[];
  };

  if (result.outcome === "conflict") {
    if (result.reason === "stale") {
      return { outcome: "conflict", reason: "stale", itemId: result.item_id! };
    }
    return {
      outcome: "conflict",
      reason: "already_decided",
      status: result.status!,
    };
  }

  return {
    outcome: "completed",
    status: result.status as "approved" | "partially_approved" | "rejected",
    decisionId: result.decision_id ?? null,
    included: result.included ?? 0,
    total: result.total ?? 0,
    areas: result.areas ?? [],
  };
}

export async function undoChangeProposal(
  supabase: SupabaseClient,
  proposalId: string,
): Promise<UndoChangeProposalResult> {
  const { data, error } = await supabase.rpc("undo_change_proposal", {
    p_proposal_id: proposalId,
  });

  if (error) {
    if (isOwnershipError(error.message)) return { outcome: "not_found" };
    console.error("undo_change_proposal failed", { code: error.code });
    return { outcome: "unavailable" };
  }

  const result = data as {
    outcome: "completed" | "conflict";
    status?: string;
    reason?: string;
    item_id?: string;
    areas?: string[];
  };

  if (result.outcome === "conflict") {
    if (result.reason === "changed_since") {
      return {
        outcome: "conflict",
        reason: "changed_since",
        itemId: result.item_id!,
      };
    }
    return {
      outcome: "conflict",
      reason: "not_undoable",
      status: result.status!,
    };
  }

  return { outcome: "completed", areas: result.areas ?? [] };
}
