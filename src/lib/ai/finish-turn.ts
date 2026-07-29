import type { TurnEvent } from "./turn-events";

/**
 * Ending a turn.
 *
 * The host owns this, not the engine, and the order matters: the result is
 * stored, the turn's operational outcome is recorded, and only then is the
 * interface told the turn is done. Doing it the other way round can leave an
 * answer on screen that a reload destroys — the user saw a completed response,
 * the message was never persisted, and the record says it completed.
 *
 * It lives apart from the route so the rule can be tested directly rather than
 * inferred from a streaming integration test.
 */
export interface FinishTurnPorts {
  /** Stores the assistant result. Returns false when it was not stored. */
  persistResult(text: string): Promise<boolean>;
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
  const fail = async (code: string, userMessage: string) => {
    ports.emit({
      type: "turn_failed",
      error: { code: "engine_unavailable", userMessage, recoverable: true },
    });
    await ports.closeRun("failed");
    await ports.audit("turn_failed", { code });
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

  if (!(await ports.closeRun("completed"))) {
    /*
      The result is stored but the turn's state is not, so steering and
      recovery would keep treating it as live. Saying "done" here would be
      claiming a clean end the system cannot vouch for.
    */
    ports.emit({
      type: "turn_failed",
      error: {
        code: "engine_unavailable",
        userMessage:
          "This turn could not be closed cleanly. Your message and the saved response are unaffected.",
        recoverable: true,
      },
    });
    await ports.audit("turn_failed", { code: "state_not_recorded" });
    return;
  }

  await ports.audit("turn_completed");
  ports.emit({ type: "done" });
}
