"use client";

import { TurnBlock } from "@/components/conversation/turn-block";
import { Button } from "@/components/ui/button";
import { areaLabel } from "./area-labels";

/**
 * The in-stream connected-change proposal block (DESIGN.md §13.2, T11).
 *
 * Reuses `TurnBlock`'s existing "proposal" rail and label rather than the
 * assistant's own prose block: the model's reply necessarily speaks in
 * staged, present-progressive terms (it cannot know the proposal committed
 * until after its own turn ends), so this card is what actually names the
 * database-confirmed proposal — title, rationale and areas the application
 * itself received back from `complete_turn`, never anything re-parsed out of
 * the assistant's words.
 */
export function ProposalCard({
  proposal,
  pending,
  error,
  onReviewChanges,
  onApproveDirection,
  onModifyProposal,
  onKeepCurrentDirection,
}: Readonly<{
  proposal: {
    id: string;
    title: string;
    rationale: string;
    affectedAreas: string[];
  };
  pending: boolean;
  error: string | null;
  onReviewChanges: () => void;
  onApproveDirection: () => void;
  onModifyProposal: () => void;
  onKeepCurrentDirection: () => void;
}>) {
  return (
    <TurnBlock kind="proposal" heading={proposal.title}>
      <p className="text-fg-secondary">{proposal.rationale}</p>
      {proposal.affectedAreas.length > 0 && (
        <div className="mt-2">
          <p className="text-fg-tertiary text-xs font-medium tracking-wide uppercase">
            Affects
          </p>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {proposal.affectedAreas.map((area) => (
              <li key={area}>{areaLabel(area)}</li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p role="alert" className="text-state-error mt-2 text-xs">
          {error}
        </p>
      )}
      <div
        className="mt-3 flex flex-wrap gap-2"
        role="group"
        aria-label="Proposal actions"
      >
        <Button
          variant="outline"
          size="sm"
          onClick={onReviewChanges}
          disabled={pending}
        >
          Review changes
        </Button>
        <Button size="sm" onClick={onApproveDirection} disabled={pending}>
          Approve direction
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onModifyProposal}
          disabled={pending}
        >
          Modify proposal
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onKeepCurrentDirection}
          disabled={pending}
        >
          Keep current direction
        </Button>
      </div>
    </TurnBlock>
  );
}
