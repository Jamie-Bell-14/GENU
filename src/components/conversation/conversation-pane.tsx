"use client";

import type { TurnRuntime } from "@/lib/ai/use-turn-runtime";
import type { ChangeProposalActions } from "@/lib/ai/use-change-proposal-actions";
import { ProposalOutcomeBanner } from "@/components/changes/proposal-outcome-banner";
import { ConversationStream } from "./conversation-stream";
import { Composer } from "./composer";

/**
 * The conversation surface. Turn state is owned above it
 * (`useTurnRuntime`) because a turn's output also belongs to the canvas; this
 * component renders and drives it, and holds no stream state of its own.
 */
export function ConversationPane({
  runtime,
  proposalActions,
}: Readonly<{
  runtime: TurnRuntime;
  /** Connected-change proposal decisions (T11); absent leaves the card inert. */
  proposalActions?: ChangeProposalActions;
}>) {
  const { state } = runtime;

  return (
    <section
      id="conversation-pane"
      aria-label="Conversation"
      tabIndex={-1}
      className="bg-surface-primary flex h-full min-h-0 flex-col"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ConversationStream
          state={state}
          onCheckAgain={runtime.checkAgain}
          onDismissRecovery={runtime.dismissRecovery}
          onReviewProposal={proposalActions?.openSheet}
          onModifyProposal={proposalActions?.openSheet}
          onApproveProposalDirection={(id) => {
            const proposal = state.pendingProposal;
            if (proposal?.id === id) void proposalActions?.approveAll(proposal);
          }}
          onKeepCurrentDirection={(id) => {
            const proposal = state.pendingProposal;
            if (proposal?.id === id)
              void proposalActions?.keepCurrent(proposal);
          }}
          proposalPending={proposalActions?.pending}
          proposalError={proposalActions?.error ?? null}
        />
      </div>
      {proposalActions?.outcome && (
        <div className="px-4 pt-2">
          <ProposalOutcomeBanner
            outcome={proposalActions.outcome}
            onReview={
              proposalActions.outcome.status !== "undone"
                ? () =>
                    proposalActions.openSheet(
                      proposalActions.outcome!.proposalId,
                    )
                : undefined
            }
            onUndo={
              proposalActions.outcome.status === "approved" ||
              proposalActions.outcome.status === "partially_approved"
                ? () => void proposalActions.undo(proposalActions.outcome!)
                : undefined
            }
            onDismiss={proposalActions.dismissOutcome}
            pending={proposalActions.pending}
            error={proposalActions.error}
          />
        </div>
      )}
      <Composer
        value={runtime.draft}
        onChange={runtime.setDraft}
        onSend={runtime.send}
        onStop={runtime.stop}
        onAddDirection={runtime.addDirection}
        directionPending={runtime.directionPending}
        onAction={runtime.onAction}
        state={state}
      />
    </section>
  );
}
