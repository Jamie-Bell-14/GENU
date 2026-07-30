import { describe, expect, it, vi } from "vitest";
import type { CommitResult } from "@/lib/services/model-operations";
import { finishTurn, type FinishTurnPorts } from "./finish-turn";
import type { TurnEvent } from "./turn-events";

/**
 * The durable boundary (docs/AI_SYSTEM.md §4.1).
 *
 * The rule under test is that a turn either ended or it did not. Nothing may be
 * told "done", and nothing in the project may be shown as changed, unless the
 * one transaction that stores the answer, applies the writes and closes the run
 * actually committed. Every failure below is a case where the interface would
 * otherwise show a completed answer, or a changed project, that a reload
 * contradicts.
 */
const completed = (patch: Partial<CommitResult> = {}): CommitResult => ({
  outcome: "completed",
  outcomes: [],
  changed: false,
  ...patch,
});

const TURN_ID = "dddddddd-0000-4000-8000-000000000001";

function setup(overrides: Partial<FinishTurnPorts> = {}) {
  const events: TurnEvent[] = [];
  const ports: FinishTurnPorts = {
    turnId: TURN_ID,
    completeTurn: vi.fn(async () => completed()),
    publishProjectModel: vi.fn(async () => {}),
    closeRun: vi.fn(async () => true),
    audit: vi.fn(async () => {}),
    auditOperation: vi.fn(async () => {}),
    emit: (event) => events.push(event),
    ...overrides,
  };
  return { events, ports };
}

describe("finishing a turn", () => {
  it("commits once, then publishes, then says done", async () => {
    const order: string[] = [];
    const { events, ports } = setup({
      completeTurn: vi.fn(async () => {
        order.push("commit");
        return completed({ changed: true });
      }),
      publishProjectModel: vi.fn(async () => {
        order.push("publish");
      }),
    });

    await finishTurn(
      {
        ...ports,
        emit: (event) => {
          order.push(event.type);
          ports.emit(event);
        },
      },
      "The answer.",
    );

    /*
      Committing as the engine went was the first defect; committing the answer,
      the writes and the terminal state as three ordered writes was the second.
      The canvas cannot be told before the one commit, and there is nothing left
      to close afterwards.
    */
    expect(order).toEqual(["commit", "publish", "done"]);
    expect(ports.closeRun).not.toHaveBeenCalled();
    expect(ports.audit).toHaveBeenCalledWith("turn_completed");
    expect(events).toEqual([{ type: "done" }]);
  });

  it("tells the canvas nothing when the project did not change", async () => {
    const { ports } = setup({
      completeTurn: vi.fn(async () => completed({ changed: false })),
    });
    await finishTurn(ports, "The answer.");
    expect(ports.publishProjectModel).not.toHaveBeenCalled();
  });

  it("audits what the transaction did with each operation", async () => {
    const outcomes = completed({
      changed: true,
      outcomes: [
        { applied: true, kind: "update_project_model", count: 2 },
        {
          applied: false,
          kind: "record_assumption",
          reason: "rejected",
          issue: "user_owned_field",
        },
      ],
    });
    const { ports } = setup({ completeTurn: vi.fn(async () => outcomes) });
    await finishTurn(ports, "The answer.");

    expect(ports.auditOperation).toHaveBeenCalledTimes(2);
    expect(ports.auditOperation).toHaveBeenCalledWith(outcomes.outcomes[0]);
    expect(ports.auditOperation).toHaveBeenCalledWith(outcomes.outcomes[1]);
  });

  it("never says done, publishes or audits when the commit did not happen", async () => {
    /*
      Nothing was stored — not the answer, not one field — so the turn is closed
      as failed and the user is told plainly. Publishing here would show a
      project change the database does not have.
    */
    const { events, ports } = setup({
      completeTurn: vi.fn(async () =>
        completed({ outcome: "unavailable", changed: false }),
      ),
    });
    await finishTurn(ports, "The answer.");

    expect(ports.publishProjectModel).not.toHaveBeenCalled();
    expect(ports.auditOperation).not.toHaveBeenCalled();
    expect(ports.closeRun).toHaveBeenCalledWith("failed");
    expect(ports.audit).toHaveBeenCalledWith("turn_failed", {
      code: "completion_failed",
    });
    expect(events.map((event) => event.type)).toEqual(["turn_failed"]);
    expect(events[0]).toMatchObject({ error: { recoverable: true } });
  });

  it("says so when the turn had already been declared unfinished", async () => {
    /*
      The lease lapsed and a later turn reconciled the run, so recovery may
      already have told the user this turn did not finish. Its answer is not kept
      and the message does not pretend otherwise.
    */
    const { events, ports } = setup({
      completeTurn: vi.fn(async () => completed({ outcome: "not_running" })),
    });
    await finishTurn(ports, "The answer.");

    expect(ports.audit).toHaveBeenCalledWith("turn_failed", {
      code: "turn_already_closed",
    });
    expect(events[0]).toMatchObject({
      type: "turn_failed",
      error: { recoverable: true },
    });
    expect(
      events[0].type === "turn_failed" && events[0].error.userMessage,
    ).toContain("already been recorded as unfinished");
  });

  it("does not attempt the commit for a turn that produced nothing", async () => {
    // Stopping and interruption already told the user what happened; this must
    // not add a second, contradictory message.
    const { events, ports } = setup();
    await finishTurn(ports, "");

    expect(events).toEqual([]);
    expect(ports.completeTurn).not.toHaveBeenCalled();
    expect(ports.closeRun).toHaveBeenCalledWith("failed");
    expect(ports.audit).toHaveBeenCalledWith("turn_failed", {
      code: "no_result",
    });
  });

  it("finalises even when emitting throws", async () => {
    const closeRun = vi.fn(async () => true);
    await finishTurn(
      {
        turnId: TURN_ID,
        completeTurn: vi.fn(async () => completed({ outcome: "unavailable" })),
        publishProjectModel: vi.fn(async () => {}),
        closeRun,
        audit: vi.fn(async () => {}),
        auditOperation: vi.fn(async () => {}),
        emit: () => {
          throw new Error("the reader is gone");
        },
      },
      "The answer.",
    ).catch(() => {});

    expect(closeRun).toHaveBeenCalledWith("failed");
  });
});
