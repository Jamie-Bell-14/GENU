import type { TurnEvent } from "./turn-events";

/**
 * Ending a turn — the application's one durable boundary.
 *
 * The host owns this, not the engine, and the order matters. Everything a
 * successful turn changes moves here, in one sequence: the answer is stored,
 * the project-truth operations are applied, the turn's outcome is recorded, and
 * only then is the interface told what changed and that the turn is done.
 *
 * The order is the point. An engine that committed project truth as it went
 * changed the project for a turn that could still fail seconds later, and the
 * canvas was told about it first — so a user could watch the project change and
 * then be told the turn did not finish. Doing it the other way round can also
 * leave an answer on screen that a reload destroys: the user saw a completed
 * response, the message was never persisted, and the record says it completed.
 *
 * It lives apart from the route so the rule can be tested directly rather than
 * inferred from a streaming integration test.
 */
export interface FinishTurnPorts {
  /** Stores the assistant result. Returns false when it was not stored. */
  persistResult(text: string): Promise<boolean>;
  /**
   * Applies the turn's project-truth operations as one unit, returning whether
   * the project actually changed.
   *
   * Called only for a turn that produced and stored an answer: an abandoned
   * turn must leave no trace in the project model. Individual operations may
   * still be refused — that is recorded per operation and does not fail the
   * turn, because a refused write is not a broken answer.
   */
  applyOperations(): Promise<boolean>;
  /**
   * Re-reads project truth and tells the canvas. Separate from
   * `applyOperations` so the emission cannot precede the commit: what the
   * canvas shows comes from the application's own tables after the write
   * landed, never from what the model said it would do.
   */
  publishProjectModel(): Promise<void>;
  /** Records the turn's outcome exactly once. Returns false if it did not. */
  closeRun(state: "completed" | "failed"): Promise<boolean>;
  audit(
    action: "turn_completed" | "turn_failed",
    detail?: Record<string, string | number>,
  ): Promise<void>;
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
  const fail = async (code: string, userMessage: string) => {
    await ports.closeRun("failed");
    await ports.audit("turn_failed", { code });
    ports.emit({
      type: "turn_failed",
      error: { code: "engine_unavailable", userMessage, recoverable: true },
    });
  };

  // An engine that produced nothing did not complete, whatever else happened.
  if (!assistantText) {
    await ports.closeRun("failed");
    await ports.audit("turn_failed", { code: "no_result" });
    return;
  }

  if (!(await ports.persistResult(assistantText))) {
    return fail(
      "result_not_saved",
      "The response could not be saved, so it has not been kept. Your message is saved — send another when you are ready.",
    );
  }

  /*
    The answer is stored, so this turn has a result worth keeping and its
    operations may be applied. All of them, or none — `applyOperations` is one
    transaction, so there is no half-changed project to reconcile here.
  */
  const changed = await ports.applyOperations();

  const closed = await ports.closeRun("completed");

  /*
    Published after the commit and after the close attempt, and only if the
    project really changed. Note it is published even when the close failed:
    the write is committed and durable, so the canvas showing it is accurate —
    what is uncertain is the turn's bookkeeping, which the failure below says.
  */
  if (changed) await ports.publishProjectModel();

  if (!closed) {
    /*
      The result is stored but the turn's state is not, so steering and
      recovery would keep treating it as live until the lease expires. Saying
      "done" here would be claiming a clean end the system cannot vouch for.
    */
    await ports.audit("turn_failed", { code: "state_not_recorded" });
    ports.emit({
      type: "turn_failed",
      error: {
        code: "engine_unavailable",
        userMessage:
          "This turn could not be closed cleanly. Your message and the saved response are unaffected.",
        recoverable: true,
      },
    });
    return;
  }

  await ports.audit("turn_completed");
  ports.emit({ type: "done" });
}
