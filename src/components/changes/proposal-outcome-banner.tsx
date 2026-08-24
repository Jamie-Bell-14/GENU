"use client";

import { XIcon } from "lucide-react";
import type { ProposalOutcome } from "@/lib/ai/use-change-proposal-actions";
import { Button } from "@/components/ui/button";
import { areaLabel } from "./area-labels";

const STATUS_TEXT: Record<ProposalOutcome["status"], string> = {
  approved: "Approved",
  partially_approved: "Partially approved",
  rejected: "Rejected — kept the current direction",
  undone: "Undone — reverted to the prior values",
};

/**
 * Post-decision outcome summary (docs/VERTICAL_SLICE_TASKS.md T11, DESIGN.md
 * §13.2, docs/review/06-DESIGN_REVIEW.md §6): "Review changes / Undo / Open
 * document".
 *
 * "Open document" focuses the canvas on one of the decision's own affected
 * objects — the closest genuine artifact available today. The document view
 * itself (four documents, version history, section states) is T12's own
 * scope; this never fabricates a page that does not exist yet.
 */
export function ProposalOutcomeBanner({
  outcome,
  onReview,
  onUndo,
  onOpenDocument,
  onRetryRefresh,
  onDismiss,
  pending,
  error,
}: Readonly<{
  outcome: ProposalOutcome;
  /** Absent once the proposal is undone — there is nothing left to re-review. */
  onReview?: () => void;
  /** Absent once already undone, or for a rejection there is nothing to undo. */
  onUndo?: () => void;
  onOpenDocument?: () => void;
  /** Present only while `outcome.viewRefreshed` is false (T11 review round 2, P1). */
  onRetryRefresh?: () => void;
  onDismiss: () => void;
  pending: boolean;
  error: string | null;
}>) {
  return (
    <div className="border-edge-subtle bg-surface-secondary flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{outcome.title}</p>
          <p className="text-fg-tertiary text-xs">
            {STATUS_TEXT[outcome.status]}
            {outcome.areas.length > 0 &&
              ` · ${outcome.areas.map(areaLabel).join(", ")}`}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          <XIcon aria-hidden />
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-state-error text-xs">
          {error}
        </p>
      )}

      {!outcome.viewRefreshed && (
        <p role="alert" className="text-state-warning text-xs">
          This was recorded, but the canvas could not refresh to show it.{" "}
          {onRetryRefresh ? (
            <Button
              variant="ghost"
              size="xs"
              className="h-auto p-0 underline"
              onClick={onRetryRefresh}
              disabled={pending}
            >
              Retry
            </Button>
          ) : (
            "Reload to see the current project."
          )}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {onReview && (
          <Button
            variant="outline"
            size="xs"
            onClick={onReview}
            disabled={pending}
          >
            Review changes
          </Button>
        )}
        {onUndo && (
          <Button
            variant="outline"
            size="xs"
            onClick={onUndo}
            disabled={pending}
          >
            Undo
          </Button>
        )}
        {onOpenDocument && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onOpenDocument}
            disabled={pending}
          >
            Open document
          </Button>
        )}
      </div>
    </div>
  );
}
