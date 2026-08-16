"use client";

import { useEffect, useState } from "react";
import type { ChangeProposalDetail } from "@/lib/services/change-proposals";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { areaLabel } from "./area-labels";

/**
 * The focused before/after proposal review (docs/review/06-DESIGN_REVIEW.md
 * §6, DESIGN.md §13.2, T11).
 *
 * A single column, one row per item, before stacked above after. Approve is
 * the only affordance styled as the branded action — everything else here is
 * a neutral control, so the one irreversible step reads as unmistakably
 * different from reviewing or excluding.
 */

interface ItemDecision {
  included: boolean;
  after: string;
}

const STATUS_LABELS: Record<ChangeProposalDetail["status"], string> = {
  proposed: "Awaiting review",
  approved: "Approved",
  partially_approved: "Partially approved",
  rejected: "Rejected",
  undone: "Undone",
};

export function ChangeProposalSheet({
  proposalId,
  title,
  loadDetail,
  onApprove,
  onOpenChange,
  pending,
  error,
}: Readonly<{
  proposalId: string | null;
  /** Falls back to the in-stream card's own title while the detail loads. */
  title: string;
  loadDetail: (proposalId: string) => Promise<ChangeProposalDetail | null>;
  onApprove: (
    decisions: { itemId: string; included: boolean; after?: string }[],
  ) => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  error: string | null;
}>) {
  const [detail, setDetail] = useState<ChangeProposalDetail | null>(null);
  const [failedProposalId, setFailedProposalId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ItemDecision>>({});

  useEffect(() => {
    if (!proposalId) return;
    let cancelled = false;
    loadDetail(proposalId).then((result) => {
      if (cancelled) return;
      if (!result) {
        setFailedProposalId(proposalId);
        return;
      }
      setDetail(result);
      setDecisions(
        Object.fromEntries(
          result.items.map((item) => [
            item.id,
            { included: item.included, after: item.after },
          ]),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [proposalId, loadDetail]);

  // Keyed on `proposalId` rather than reset in the effect above: a stale
  // `detail` from a previous proposal is simply not "current" the moment the
  // id changes, without an extra synchronous reset racing the fetch it
  // belongs to.
  const isCurrent = detail !== null && detail.id === proposalId;
  const loadFailed = failedProposalId === proposalId;
  const items = isCurrent ? detail.items : [];
  const includedCount = items.filter(
    (item) => decisions[item.id]?.included,
  ).length;
  const partialApproval = includedCount > 0 && includedCount < items.length;
  const includedAreaLabels = items
    .filter((item) => decisions[item.id]?.included)
    .map((item) => areaLabel(item.area));
  const excludedAreaLabels = items
    .filter((item) => !decisions[item.id]?.included)
    .map((item) => areaLabel(item.area));
  /*
    Once a proposal has been decided, the sheet is a diff of what actually
    happened — never a second chance to approve it (T11 review round 1, P1:
    reopening "Review changes" from the outcome banner must not present an
    already-decided proposal as though it were still actionable, which
    previously fell straight through to the RPC's own already_decided
    conflict).
  */
  const readOnly = isCurrent && detail.status !== "proposed";

  function setIncluded(itemId: string, included: boolean) {
    setDecisions((current) => ({
      ...current,
      [itemId]: { ...current[itemId], included },
    }));
  }

  function setAfter(itemId: string, after: string) {
    setDecisions((current) => ({
      ...current,
      [itemId]: { ...current[itemId], after },
    }));
  }

  async function handleApprove() {
    if (!isCurrent) return;
    const submitted = items.map((item) => ({
      itemId: item.id,
      included: decisions[item.id]?.included ?? false,
      after:
        decisions[item.id]?.after !== item.after
          ? decisions[item.id]?.after
          : undefined,
    }));
    const ok = await onApprove(submitted);
    if (ok) onOpenChange(false);
  }

  return (
    <Sheet open={proposalId !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full max-w-md flex-col gap-4 p-4"
      >
        <SheetHeader>
          <SheetTitle>{isCurrent ? detail.title : title}</SheetTitle>
          {isCurrent && detail.rationale && (
            <SheetDescription>{detail.rationale}</SheetDescription>
          )}
          {readOnly && (
            <p className="text-fg-tertiary text-xs font-medium tracking-wide uppercase">
              {STATUS_LABELS[detail.status]}
            </p>
          )}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loadFailed ? (
            <p className="text-fg-tertiary text-sm">
              This proposal could not be loaded. It may have been decided
              already, or is no longer available.
            </p>
          ) : !isCurrent ? (
            <p className="text-fg-tertiary text-sm">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-fg-tertiary text-sm">
              This proposal has no items to review.
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {items.map((item) => {
                const decision = decisions[item.id];
                // Read-only shows what was actually decided — `item.included`
                // and `item.after` are the RPC's own recorded final state —
                // never the live, still-editable `decisions` draft.
                const included = readOnly
                  ? item.included
                  : (decision?.included ?? false);
                return (
                  <li
                    key={item.id}
                    className="border-edge-subtle rounded-md border p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-fg-tertiary text-xs font-medium tracking-wide uppercase">
                        {areaLabel(item.area)}
                      </p>
                      {readOnly ? (
                        <span className="text-fg-tertiary text-xs">
                          {included ? "Included" : "Excluded"}
                        </span>
                      ) : (
                        <Button
                          variant={included ? "outline" : "ghost"}
                          size="xs"
                          aria-pressed={included}
                          onClick={() => setIncluded(item.id, !included)}
                        >
                          {included ? "Included" : "Excluded"}
                        </Button>
                      )}
                    </div>

                    <div className="mt-2 flex flex-col gap-2 text-sm">
                      <div>
                        <p className="text-fg-tertiary text-xs">Currently</p>
                        <p className="text-fg-secondary break-words">
                          {item.before ?? "Not yet set"}
                        </p>
                      </div>
                      <div>
                        <p className="text-fg-tertiary text-xs">Proposed</p>
                        {!included ? (
                          <p className="text-fg-tertiary break-words line-through">
                            {item.after}
                          </p>
                        ) : readOnly ? (
                          <p className="text-fg-secondary mt-1 break-words">
                            {item.after}
                          </p>
                        ) : (
                          <Textarea
                            value={decision?.after ?? item.after}
                            onChange={(event) =>
                              setAfter(item.id, event.target.value)
                            }
                            rows={2}
                            aria-label={`Proposed value for ${areaLabel(item.area)}`}
                            className="mt-1"
                          />
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {!readOnly && partialApproval && (
            <p
              role="alert"
              className="text-state-warning border-edge-subtle mt-4 rounded-md border p-2 text-xs"
            >
              {includedAreaLabels.join(", ")} will change while{" "}
              {excludedAreaLabels.join(", ")} stays as it is — those excluded
              parts may no longer match what you are about to approve.
            </p>
          )}

          {error && (
            <p role="alert" className="text-state-error mt-2 text-xs">
              {error}
            </p>
          )}
        </div>

        <SheetFooter className="flex-row justify-end gap-2">
          <SheetClose asChild>
            <Button variant="ghost" disabled={pending}>
              {readOnly ? "Close" : "Cancel"}
            </Button>
          </SheetClose>
          {!readOnly && (
            <Button
              onClick={handleApprove}
              disabled={pending || !isCurrent || items.length === 0}
              aria-busy={pending || undefined}
            >
              {includedCount === 0 ? "Reject proposal" : "Approve"}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
