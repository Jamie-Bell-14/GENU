import { describe, expect, it, vi } from "vitest";
import { finishTurn, type FinishTurnPorts } from "./finish-turn";
import type { TurnEvent } from "./turn-events";

/**
 * The rule under test is an ordering one: nothing may be told "done", and
 * nothing in the project may change, until the result is stored and the outcome
 * recorded. Every failure below is a case where the interface would otherwise
 * show a completed answer, or a changed project, that a reload contradicts.
 */
function setup(overrides: Partial<FinishTurnPorts> = {}) {
  const events: TurnEvent[] = [];
  const ports: FinishTurnPorts = {
    persistResult: vi.fn(async () => true),
    applyOperations: vi.fn(async () => false),
    publishProjectModel: vi.fn(async () => {}),
    closeRun: vi.fn(async () => true),
    audit: vi.fn(async () => {}),
    emit: (event) => events.push(event),
    ...overrides,
  };
  return { events, ports };
}

describe("finishing a turn", () => {
  it("stores the result and records the outcome before saying done", async () => {
    const order: string[] = [];
    const { events, ports } = setup({
      persistResult: vi.fn(async () => {
        order.push("persist");
        return true;
      }),
      closeRun: vi.fn(async () => {
        order.push("close");
        return true;
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

    expect(order).toEqual(["persist", "close", "done"]);
    expect(ports.closeRun).toHaveBeenCalledWith("completed");
    expect(ports.audit).toHaveBeenCalledWith("turn_completed");
    expect(events).toEqual([{ type: "done" }]);
  });

  it("applies project changes after the answer is stored, and publishes after", async () => {
    const order: string[] = [];
    const { ports } = setup({
      persistResult: vi.fn(async () => {
        order.push("persist");
        return true;
      }),
      applyOperations: vi.fn(async () => {
        order.push("apply");
        return true;
      }),
      publishProjectModel: vi.fn(async () => {
        order.push("publish");
      }),
      closeRun: vi.fn(async () => {
        order.push("close");
        return true;
      }),
      emit: (event) => order.push(event.type),
    });

    await finishTurn(ports, "The answer.");

    /*
      Committing as the engine went was the defect: the project changed, the
      canvas was told, and the turn could still fail seconds later. The commit
      now cannot happen before the answer is stored, and the canvas cannot be
      told before the commit.
    */
    expect(order).toEqual(["persist", "apply", "close", "publish", "done"]);
  });

  it("tells the canvas nothing when the project did not change", async () => {
    const { ports } = setup({ applyOperations: vi.fn(async () => false) });
    await finishTurn(ports, "The answer.");
    expect(ports.publishProjectModel).not.toHaveBeenCalled();
  });

  it("does not touch project truth when the answer could not be stored", async () => {
    // A turn whose answer is lost must leave no trace in the project model:
    // the user would have no response explaining what changed or why.
    const { ports } = setup({ persistResult: vi.fn(async () => false) });
    await finishTurn(ports, "The answer.");

    expect(ports.applyOperations).not.toHaveBeenCalled();
    expect(ports.publishProjectModel).not.toHaveBeenCalled();
  });

  it("does not touch project truth for a turn that produced nothing", async () => {
    const { ports } = setup();
    await finishTurn(ports, "");
    expect(ports.applyOperations).not.toHaveBeenCalled();
  });

  it("still publishes a committed change when the turn could not be closed", async () => {
    /*
      The writes are committed and durable, so hiding them would show a project
      that disagrees with the database on the next read. What is uncertain is the
      turn's bookkeeping, and that is what the failure says.
    */
    const { events, ports } = setup({
      applyOperations: vi.fn(async () => true),
      closeRun: vi.fn(async () => false),
    });
    await finishTurn(ports, "The answer.");

    expect(ports.publishProjectModel).toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(["turn_failed"]);
  });

  it("records the outcome before emitting, on every failure path", async () => {
    const order: string[] = [];
    const { ports } = setup({
      persistResult: vi.fn(async () => false),
      closeRun: vi.fn(async () => {
        order.push("close");
        return true;
      }),
      emit: (event) => order.push(event.type),
    });
    await finishTurn(ports, "The answer.");
    // Emission first would let a dead stream stop the turn recording that it
    // failed, leaving the run eligible for direction until its lease expires.
    expect(order).toEqual(["close", "turn_failed"]);
  });

  it("finalises even when emitting throws", async () => {
    const closeRun = vi.fn(async () => true);
    await finishTurn(
      {
        persistResult: vi.fn(async () => false),
        applyOperations: vi.fn(async () => false),
        publishProjectModel: vi.fn(async () => {}),
        closeRun,
        audit: vi.fn(async () => {}),
        emit: () => {
          throw new Error("the reader is gone");
        },
      },
      "The answer.",
    ).catch(() => {});

    expect(closeRun).toHaveBeenCalledWith("failed");
  });

  it("never says done when the result was not stored", async () => {
    const { events, ports } = setup({
      persistResult: vi.fn(async () => false),
    });
    await finishTurn(ports, "The answer.");

    expect(events.map((event) => event.type)).toEqual(["turn_failed"]);
    expect(events[0]).toMatchObject({
      error: { recoverable: true },
    });
    expect(ports.closeRun).toHaveBeenCalledWith("failed");
    expect(ports.audit).toHaveBeenCalledWith("turn_failed", {
      code: "result_not_saved",
    });
  });

  it("never says done when the outcome could not be recorded", async () => {
    // The result is stored, but steering and recovery would keep treating the
    // turn as live, so a clean end cannot be claimed.
    const { events, ports } = setup({ closeRun: vi.fn(async () => false) });
    await finishTurn(ports, "The answer.");

    expect(events.map((event) => event.type)).toEqual(["turn_failed"]);
    expect(ports.audit).toHaveBeenCalledWith("turn_failed", {
      code: "state_not_recorded",
    });
  });

  it("treats a turn that produced nothing as failed, silently", async () => {
    // Stopping and interruption already told the user what happened; this must
    // not add a second, contradictory message.
    const { events, ports } = setup();
    await finishTurn(ports, "");

    expect(events).toEqual([]);
    expect(ports.persistResult).not.toHaveBeenCalled();
    expect(ports.closeRun).toHaveBeenCalledWith("failed");
    expect(ports.audit).toHaveBeenCalledWith("turn_failed", {
      code: "no_result",
    });
  });
});
