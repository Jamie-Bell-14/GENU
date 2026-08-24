"use client";

import { useEffect, useRef } from "react";
import type { Message, PendingRecovery, TurnState } from "@/lib/ai/turn-events";
import { ProposalCard } from "@/components/changes/proposal-card";
import { TurnBlock } from "./turn-block";
import { Button } from "@/components/ui/button";
import { ActivityIndicator } from "@/components/activity/activity-indicator";

/*
  Each turn is a labelled region. The label is what lets a reader — and a test
  — address "the message you wrote" as distinct from the assistant quoting it
  back, which is otherwise the same words twice on one screen.
*/
function UserTurn({ message }: Readonly<{ message: Message }>) {
  return (
    <article
      aria-label="Your turn"
      className="border-edge-subtle border-t pt-4"
    >
      <p className="text-fg-tertiary mb-1 text-xs font-medium">You</p>
      <p className="text-sm leading-relaxed whitespace-pre-wrap">
        {message.content}
      </p>
    </article>
  );
}

function AssistantTurn({
  message,
}: Readonly<{ message: Pick<Message, "content" | "blockKind" | "heading"> }>) {
  return (
    <article aria-label="Response" className="text-fg-primary">
      <TurnBlock kind={message.blockKind} heading={message.heading}>
        <span className="whitespace-pre-wrap">{message.content}</span>
      </TurnBlock>
    </article>
  );
}

/*
  A recovery notice, rendered inside the turn it concerns.

  It names the question when one is in view, because two unresolved turns
  otherwise produce two identical notices and two identical Dismiss buttons —
  and the user cannot tell which of their questions each belongs to.
*/
function RecoveryNotice({
  recovery,
  question,
  onCheckAgain,
  onDismissRecovery,
}: Readonly<{
  recovery: PendingRecovery;
  question?: string;
  onCheckAgain?: (turnId: string) => void;
  onDismissRecovery?: (turnId: string) => void;
}>) {
  const about = question
    ? `“${question.length > 60 ? `${question.slice(0, 60)}…` : question}”`
    : "that turn";
  const message =
    recovery.state === "checking"
      ? `The connection dropped. Checking what was recorded for ${about}…`
      : recovery.state === "still_running"
        ? `The connection dropped, and ${about} is still being processed. Your message is saved.`
        : recovery.state === "unfinished"
          ? `The connection dropped and ${about} did not finish. Your message is saved — send another when you are ready.`
          : `The connection dropped, and ${about} could not be checked just now. Your message is saved.`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-fg-tertiary text-xs">{message}</p>
      {recovery.state !== "checking" && (
        <>
          {/* Nothing to look up again once the server has said the turn did
              not finish: that is a settled outcome, not an unknown. */}
          {onCheckAgain && recovery.state !== "unfinished" && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => onCheckAgain(recovery.turnId)}
            >
              Check again
            </Button>
          )}
          {onDismissRecovery && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onDismissRecovery(recovery.turnId)}
            >
              Dismiss
            </Button>
          )}
        </>
      )}
    </div>
  );
}

interface TurnGroup {
  key: string;
  /** The turn this group is, when the server has named one. */
  turnId?: string;
  /** The question, absent only for a response with no matching turn. */
  user?: Message;
  responses: Message[];
  /** Text still arriving for this turn. */
  streaming?: TurnState["streaming"];
  /** An unresolved recovery belonging to this turn. */
  recovery?: PendingRecovery;
}

/**
 * Groups the transcript by turn, in the order the questions were asked.
 *
 * The message list is in arrival order, and a recovered answer arrives after
 * later questions have already been sent — so rendering the list directly
 * would show that answer as the response to whichever question happens to
 * precede it. Grouping by turn id keeps every response under its own question,
 * whether it arrived live, on catch-up, or from the server on page load.
 */
function groupTurns(state: TurnState): TurnGroup[] {
  const groups: TurnGroup[] = [];
  const byTurn = new Map<string, TurnGroup>();

  for (const message of state.messages) {
    if (message.role === "user") {
      // A message the server has not yet named a turn for stands on its own id.
      const key = message.turnId ?? message.id;
      const group: TurnGroup = {
        key,
        turnId: message.turnId,
        user: message,
        responses: [],
      };
      groups.push(group);
      byTurn.set(key, group);
      continue;
    }
    const existing = message.turnId ? byTurn.get(message.turnId) : undefined;
    if (existing) {
      existing.responses.push(message);
      continue;
    }
    // A response with no question in view — an unattributed legacy row. Shown
    // rather than hidden, but not attached to somebody else's question.
    groups.push({ key: message.id, responses: [message] });
  }

  if (state.streaming) {
    const group = byTurn.get(state.streaming.turnId);
    if (group) group.streaming = state.streaming;
    else
      groups.push({
        key: state.streaming.turnId,
        turnId: state.streaming.turnId,
        responses: [],
        streaming: state.streaming,
      });
  }

  /*
    Recoveries sit inside the turn they concern.

    Rendering them after the whole transcript was isolated in state but not on
    screen: while a newer turn streams, an older turn's "that turn did not
    finish" notice appeared beneath it, reading as a verdict on the turn the
    user is watching. With two unresolved turns the notices were identical, so
    nothing said which question each belonged to.
  */
  for (const recovery of state.recoveries) {
    const group = byTurn.get(recovery.turnId);
    if (group) group.recovery = recovery;
    else groups.push({ key: recovery.turnId, responses: [], recovery });
  }

  return groups;
}

export function ConversationStream({
  state,
  onCheckAgain,
  onDismissRecovery,
  onReviewProposal,
  onApproveProposalDirection,
  onModifyProposal,
  onKeepCurrentDirection,
  proposalPending = false,
  proposalError = null,
}: Readonly<{
  state: TurnState;
  onCheckAgain?: (turnId: string) => void;
  onDismissRecovery?: (turnId: string) => void;
  /** The in-stream proposal card's own actions (T11), all absent when unused. */
  onReviewProposal?: (proposalId: string) => void;
  onApproveProposalDirection?: (proposalId: string) => void;
  onModifyProposal?: (proposalId: string) => void;
  onKeepCurrentDirection?: (proposalId: string) => void;
  proposalPending?: boolean;
  proposalError?: string | null;
}>) {
  const endRef = useRef<HTMLDivElement>(null);
  const count = state.messages.length;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [count, state.streaming?.text]);

  if (count === 0 && !state.streaming && state.recoveries.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
        <p className="font-display text-lg font-medium">
          What problem are you trying to solve?
        </p>
        <p className="text-fg-secondary max-w-sm text-sm">
          Describe it in your own words. It does not need to be well formed yet.
        </p>
      </div>
    );
  }

  const pendingProposal = state.pendingProposal;

  return (
    <div className="flex flex-col gap-4 p-6">
      {groupTurns(state).map((group) => (
        <div key={group.key} className="flex flex-col gap-4">
          {group.user && <UserTurn message={group.user} />}
          {group.responses.map((response) => (
            <AssistantTurn key={response.id} message={response} />
          ))}
          {group.streaming?.text && (
            <AssistantTurn
              message={{
                content: group.streaming.text,
                blockKind: group.streaming.blockKind,
                heading: group.streaming.heading,
              }}
            />
          )}
          {group.recovery && (
            <RecoveryNotice
              recovery={group.recovery}
              question={group.user?.content}
              onCheckAgain={onCheckAgain}
              onDismissRecovery={onDismissRecovery}
            />
          )}
          {pendingProposal && pendingProposal.turnId === group.turnId && (
            <ProposalCard
              proposal={pendingProposal}
              pending={proposalPending}
              error={proposalError}
              onReviewChanges={() => onReviewProposal?.(pendingProposal.id)}
              onApproveDirection={() =>
                onApproveProposalDirection?.(pendingProposal.id)
              }
              onModifyProposal={() => onModifyProposal?.(pendingProposal.id)}
              onKeepCurrentDirection={() =>
                onKeepCurrentDirection?.(pendingProposal.id)
              }
            />
          )}
        </div>
      ))}

      {/* Observable activity: specific, subtle, and it fades when done.
          Only ordinary analysis belongs here — research and canvas work is
          reported at the canvas instead (DESIGN.md §9.1). */}
      <div className="min-h-5">
        <ActivityIndicator activity={state.activity.conversation} />
        {state.status === "sending" && !state.activity.conversation && (
          <p className="text-fg-tertiary text-xs">Sending…</p>
        )}
      </div>

      {/* Stopping is a decision, not a failure: it is stated plainly and
          without error styling, and the partial answer is not shown. */}
      {state.stopped && (
        <p className="text-fg-tertiary text-xs">
          You stopped this response. Your message is saved.
        </p>
      )}

      {state.error && (
        <p
          role="alert"
          className="text-state-error border-risk-edge bg-risk-subtle rounded-md border p-3 text-sm"
        >
          {state.error.userMessage}
        </p>
      )}

      <div ref={endRef} />
    </div>
  );
}
