import type {
  CommitResult,
  OperationOutcome,
} from "@/lib/services/model-operations";
import type { TurnEvent } from "./turn-events";

/**
 * Ending a turn — the application's one durable boundary (docs/AI_SYSTEM.md
 * §4.1).
 *
 * The host owns this, not the engine, and it is deliberately one commit rather
 * than an ordered sequence of them.
 *
 * Ordering alone was not enough, and the reason is worth stating plainly.
 * Catch-up treats a stored assistant message as settlement — a stored result
 * settles the turn, whatever the run state says — so a worker that died after
 * the answer was inserted but before the project writes committed left a turn
 * that *reads* as completed while every field and assumption belonging to it had
 * been lost. No ordering of separate writes fixes that. `completeTurn` therefore
 * stores the answer, applies the accepted operations and records the terminal
 * state in a single transaction: either the turn ended, or it did not.
 *
 * What remains outside that commit is only what cannot be inside it — telling
 * the canvas what the project now holds, which is a re-read *after* the write
 * landed, and never anything the model described.
 *
 * It lives apart from the route so the rule can be tested directly rather than
 * inferred from a streaming integration test.
 */
export interface FinishTurnPorts {
  /** The turn this call is finishing, stamped onto any `turn_failed` it emits. */
  turnId: string;
  /**
   * The single durable operation: the answer, the turn's project-truth writes
   * and its terminal state, committed together.
   *
   * Individual operations may still be refused inside it — a field the person
   * owns is expected to be refused — and a refusal is recorded per operation
   * rather than failing the turn.
   */
  completeTurn(assistantText: string): Promise<CommitResult>;
  /**
   * Re-reads project truth and tells the canvas. Separate from `completeTurn`
   * so the emission cannot precede the commit: what the canvas shows comes from
   * the application's own tables after the write landed.
   */
  publishProjectModel(): Promise<void>;
  /**
   * Records a failed outcome. Only the failure paths need it — a completed turn
   * is closed inside its own transaction.
   */
  closeRun(state: "failed"): Promise<boolean>;
  audit(
    action: "turn_completed" | "turn_failed",
    detail?: Record<string, string | number>,
  ): Promise<void>;
  /** Records what the transaction did with one staged operation. */
  auditOperation(outcome: OperationOutcome): Promise<void>;
  emit(event: TurnEvent): void;
}

export async function finishTurn(
  ports: FinishTurnPorts,
  assistantText: string,
): Promise<void> {
  /*
    Finalisation first, emission second, on every path. If the client has gone
    the emit is a no-op — but if it were first and it threw, the turn would
    never record that it failed, and the run would stay eligible for direction
    and recoverable until its lease expired.
  */

  // An engine that produced nothing did not complete, whatever else happened.
  if (!assistantText) {
    await ports.closeRun("failed");
    await ports.audit("turn_failed", { code: "no_result" });
    // No emit here: an engine that returns empty text has already emitted its
    // own `turn_failed` (both engines' `fail`/`interrupted` do this before
    // returning), and this is that failure's terminal bookkeeping, not a
    // second occurrence of it.
    return;
  }

  const result = await ports.completeTurn(assistantText);

  if (result.outcome !== "completed") {
    /*
      Nothing was stored: not the answer, not one field. The run is closed as
      failed so steering and recovery stop treating it as live — except where it
      already is not this turn's to close, in which case that write finds no
      running row and changes nothing, which is correct.
    */
    await ports.closeRun("failed");
    await ports.audit("turn_failed", {
      code:
        result.outcome === "not_running"
          ? "turn_already_closed"
          : "completion_failed",
    });
    ports.emit({
      type: "turn_failed",
      turnId: ports.turnId,
      error: {
        code: "engine_unavailable",
        userMessage:
          result.outcome === "not_running"
            ? "This turn had already been recorded as unfinished, so its response was not kept. Your message is saved — send another when you are ready."
            : "The response could not be saved, so it has not been kept. Your message is saved — send another when you are ready.",
        recoverable: true,
      },
    });
    return;
  }

  /*
    Audited from what the database says it did, so an `operation_applied` row
    means a row exists rather than that a write was attempted.
  */
  for (const outcome of result.outcomes) {
    await ports.auditOperation(outcome);
  }

  // Only if the project really changed, and only after the commit.
  if (result.changed) await ports.publishProjectModel();

  await ports.audit("turn_completed");
  ports.emit({ type: "done" });
}
