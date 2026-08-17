"use client";

import { useCallback, useMemo, useState } from "react";
import {
  loadChangeProposalDetail,
  type ChangeProposalDetail,
} from "@/lib/services/change-proposals";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Approving, rejecting or undoing a connected-change proposal from the
 * workspace UI (docs/VERTICAL_SLICE_TASKS.md T11).
 *
 * Owns only the client-side orchestration around the decision endpoint:
 * which sheet is open, the outcome banner shown after a decision, and the
 * two error paths a person can actually hit (a real conflict the database
 * refused to write, or the request not landing at all). The decision itself
 * is made — and enforced — entirely inside `apply_change_proposal` /
 * `undo_change_proposal`; nothing here decides whether a change is valid.
 */

export interface ProposalOutcome {
  proposalId: string;
  title: string;
  status: "approved" | "partially_approved" | "rejected" | "undone";
  areas: string[];
  /**
   * Whether the canvas/structured view actually re-read project truth after
   * this decision (T11 review round 2, P1). The decision itself already
   * committed by the time this is false — a failed refresh is never reversed
   * — but the person needs to be told the view they're looking at may be
   * stale, rather than silently trusting a canvas that never updated.
   */
  viewRefreshed: boolean;
}

type Decision = { itemId: string; included: boolean; after?: string };

interface ActionResponse {
  outcome?: "completed" | "conflict";
  status?: string;
  areas?: string[];
  error?: { code?: string; message?: string; reason?: string; status?: string };
}

const GENERIC_UNAVAILABLE =
  "This could not be recorded. Nothing has changed — try again.";

function describeApproveFailure(payload: ActionResponse | null): string {
  const reason = payload?.error?.reason;
  if (reason === "stale") {
    return "The project has changed since this proposal was made, so nothing was applied. Open Review changes to see the current values.";
  }
  if (reason === "already_decided") {
    return "This proposal has already been decided.";
  }
  if (payload?.error?.code === "not_found") {
    return "That proposal is not available.";
  }
  return GENERIC_UNAVAILABLE;
}

function describeUndoFailure(payload: ActionResponse | null): string {
  const reason = payload?.error?.reason;
  if (reason === "changed_since") {
    return "A field this proposal changed has been edited again since it was approved, so undoing it was refused rather than overwriting that edit.";
  }
  if (reason === "not_undoable") {
    return "This proposal is no longer in a state that can be undone.";
  }
  if (payload?.error?.code === "not_found") {
    return "That proposal is not available.";
  }
  return GENERIC_UNAVAILABLE;
}

export interface ChangeProposalActions {
  /** The proposal the review sheet currently shows, or none. */
  sheetProposalId: string | null;
  /** The most recent decision this session made, for the outcome banner. */
  outcome: ProposalOutcome | null;
  /** A decision request is in flight. */
  pending: boolean;
  /** The most recent decision request's own failure, if any. */
  error: string | null;
  openSheet: (proposalId: string) => void;
  closeSheet: () => void;
  dismissOutcome: () => void;
  loadDetail: (proposalId: string) => Promise<ChangeProposalDetail | null>;
  /** "Approve direction": every item, exactly as proposed. */
  approveAll: (proposal: { id: string; title: string }) => Promise<void>;
  /** "Keep current direction": every item excluded, which the database
   *  records as a rejection rather than a silent no-op. */
  keepCurrent: (proposal: { id: string; title: string }) => Promise<void>;
  /** The review sheet's own Approve, with whatever the person decided per item. */
  submitReview: (
    proposal: { id: string; title: string },
    decisions: Decision[],
  ) => Promise<boolean>;
  undo: (outcome: ProposalOutcome) => Promise<void>;
  /** Retries a failed view refresh without re-deciding anything. */
  retryRefresh: () => Promise<void>;
}

/**
 * The demo project has no database at all (see `src/lib/dev/pending-proposals.ts`),
 * so every request this hook makes for it goes to the `/api/dev/*` mirror
 * instead of Supabase — the same switch `useTurnRuntime` already makes for
 * the turn endpoint itself.
 */
function isDevProject(projectId: string): boolean {
  return projectId === "demo";
}

export function useChangeProposalActions(
  projectId: string,
  onResolved: (proposalId: string) => void,
  /** Resolves false when the re-read failed; the decision itself still stands. */
  onProjectChanged: () => boolean | Promise<boolean>,
  /**
   * The project's most recently decided proposal, as of the last reload
   * (issue #25) — seeds `outcome` so the banner and its Review changes/Undo
   * actions are already showing on mount, rather than only appearing after a
   * live decision made in this same session.
   */
  initialOutcome: ProposalOutcome | null = null,
): ChangeProposalActions {
  const isDemo = isDevProject(projectId);
  const supabase = useMemo(
    () => (isDemo ? null : createSupabaseBrowserClient()),
    [isDemo],
  );
  const [sheetProposalId, setSheetProposalId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ProposalOutcome | null>(
    initialOutcome,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(
    async (proposalId: string) => {
      if (isDemo) {
        const response = await fetch(`/api/dev/change-proposals/${proposalId}`);
        if (!response.ok) return null;
        return (await response.json()) as ChangeProposalDetail;
      }
      if (!supabase) return null;
      return loadChangeProposalDetail(supabase, proposalId);
    },
    [isDemo, supabase],
  );

  const approve = useCallback(
    async (
      proposal: { id: string; title: string },
      decisions: Decision[],
    ): Promise<boolean> => {
      setPending(true);
      setError(null);
      try {
        const url = isDemo
          ? `/api/dev/change-proposals/${proposal.id}`
          : `/api/projects/${projectId}/changes/${proposal.id}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "approve", decisions }),
        });
        const payload = (await response
          .json()
          .catch(() => null)) as ActionResponse | null;
        if (!response.ok || payload?.outcome !== "completed") {
          setError(describeApproveFailure(payload));
          return false;
        }
        onResolved(proposal.id);
        const viewRefreshed = await onProjectChanged();
        setOutcome({
          proposalId: proposal.id,
          title: proposal.title,
          status: payload.status as ProposalOutcome["status"],
          areas: payload.areas ?? [],
          viewRefreshed,
        });
        return true;
      } catch {
        setError(GENERIC_UNAVAILABLE);
        return false;
      } finally {
        setPending(false);
      }
    },
    [isDemo, projectId, onResolved, onProjectChanged],
  );

  const approveAll = useCallback(
    async (proposal: { id: string; title: string }) => {
      const detail = await loadDetail(proposal.id);
      if (!detail) {
        setError("That proposal is not available.");
        return;
      }
      await approve(
        proposal,
        detail.items.map((item) => ({ itemId: item.id, included: true })),
      );
    },
    [loadDetail, approve],
  );

  const keepCurrent = useCallback(
    async (proposal: { id: string; title: string }) => {
      // No entry for any item reads as excluded (never silent consent), so an
      // empty array is a complete, honest "reject everything as proposed".
      await approve(proposal, []);
    },
    [approve],
  );

  const submitReview = useCallback(
    (proposal: { id: string; title: string }, decisions: Decision[]) =>
      approve(proposal, decisions),
    [approve],
  );

  const undo = useCallback(
    async (target: ProposalOutcome) => {
      setPending(true);
      setError(null);
      try {
        const url = isDemo
          ? `/api/dev/change-proposals/${target.proposalId}`
          : `/api/projects/${projectId}/changes/${target.proposalId}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "undo" }),
        });
        const payload = (await response
          .json()
          .catch(() => null)) as ActionResponse | null;
        if (!response.ok || payload?.outcome !== "completed") {
          setError(describeUndoFailure(payload));
          return;
        }
        const viewRefreshed = await onProjectChanged();
        setOutcome({
          proposalId: target.proposalId,
          title: target.title,
          status: "undone",
          areas: payload.areas ?? [],
          viewRefreshed,
        });
      } catch {
        setError(GENERIC_UNAVAILABLE);
      } finally {
        setPending(false);
      }
    },
    [isDemo, projectId, onProjectChanged],
  );

  const openSheet = useCallback((proposalId: string) => {
    setError(null);
    setSheetProposalId(proposalId);
  }, []);
  const closeSheet = useCallback(() => setSheetProposalId(null), []);
  const dismissOutcome = useCallback(() => setOutcome(null), []);

  const retryRefresh = useCallback(async () => {
    const viewRefreshed = await onProjectChanged();
    if (!viewRefreshed) return;
    setOutcome((current) =>
      current ? { ...current, viewRefreshed } : current,
    );
  }, [onProjectChanged]);

  return {
    sheetProposalId,
    outcome,
    pending,
    error,
    openSheet,
    closeSheet,
    dismissOutcome,
    loadDetail,
    approveAll,
    keepCurrent,
    submitReview,
    undo,
    retryRefresh,
  };
}
