import { describe, expect, it, vi } from "vitest";
import { finishTurn, type FinishTurnPorts } from "./finish-turn";
import type { TurnEvent } from "./turn-events";

/**
 * The rule under test is an ordering one: nothing may be told "done" until the
 * result is stored and the outcome recorded. Every failure below is a case
 * where the interface would otherwise show a completed answer that a reload
 * destroys.
 */
function setup(overrides: Partial<FinishTurnPorts> = {}) {
  const events: TurnEvent[] = [];
  const ports: FinishTurnPorts = {
    persistResult: vi.fn(async () => true),
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
