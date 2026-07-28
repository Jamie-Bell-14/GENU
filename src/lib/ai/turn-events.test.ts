import { describe, expect, it } from "vitest";
import {
  turnReducer,
  INITIAL_TURN_STATE,
  type Message,
  type TurnState,
} from "./turn-events";

const userMessage: Message = {
  id: "m1",
  role: "user",
  content: "Tenants and landlords argue about property condition.",
  blockKind: "plain",
  createdAt: "2026-07-28T00:00:00.000Z",
};

function send(state: TurnState = INITIAL_TURN_STATE): TurnState {
  return turnReducer(state, {
    type: "user_message_sent",
    message: userMessage,
  });
}

function streamStarted(state: TurnState): TurnState {
  return turnReducer(state, {
    type: "event",
    event: { type: "turn_started", turnId: "t1" },
  });
}

describe("turnReducer", () => {
  it("appends the user message and marks the turn as sending", () => {
    const state = send();
    expect(state.messages).toEqual([userMessage]);
    expect(state.status).toBe("sending");
    expect(state.error).toBeNull();
  });

  it("accumulates deltas and completes into a single assistant message", () => {
    let state = streamStarted(send());
    expect(state.status).toBe("streaming");
    for (const text of ["Hello", " ", "world"]) {
      state = turnReducer(state, {
        type: "event",
        event: { type: "assistant_delta", text },
      });
    }
    expect(state.streaming?.text).toBe("Hello world");

    state = turnReducer(state, { type: "event", event: { type: "done" } });
    expect(state.streaming).toBeNull();
    expect(state.status).toBe("idle");
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]).toMatchObject({
      role: "assistant",
      content: "Hello world",
    });
  });

  it("carries the block kind and heading onto the completed message", () => {
    let state = streamStarted(send());
    state = turnReducer(state, {
      type: "event",
      event: { type: "block", kind: "challenge", heading: "Worth testing" },
    });
    state = turnReducer(state, {
      type: "event",
      event: { type: "assistant_delta", text: "Consider alternatives." },
    });
    state = turnReducer(state, { type: "event", event: { type: "done" } });
    expect(state.messages[1]).toMatchObject({
      blockKind: "challenge",
      heading: "Worth testing",
    });
  });

  it("shows activity while working and clears it when the turn ends", () => {
    let state = streamStarted(send());
    state = turnReducer(state, {
      type: "event",
      event: { type: "activity", kind: "analysis", label: "Recording…" },
    });
    expect(state.activity).toBe("Recording…");
    state = turnReducer(state, { type: "event", event: { type: "done" } });
    expect(state.activity).toBeNull();
  });

  it("never shows more than three contextual actions", () => {
    const state = turnReducer(streamStarted(send()), {
      type: "event",
      event: {
        type: "actions",
        actions: [1, 2, 3, 4, 5].map((n) => ({ id: `a${n}`, label: `A${n}` })),
      },
    });
    expect(state.actions).toHaveLength(3);
  });

  it("keeps the user message and drops partial text when a turn fails", () => {
    let state = streamStarted(send());
    state = turnReducer(state, {
      type: "event",
      event: { type: "assistant_delta", text: "half an ans" },
    });
    state = turnReducer(state, {
      type: "event",
      event: {
        type: "turn_failed",
        error: {
          code: "engine_unavailable",
          userMessage: "The response could not be completed.",
          recoverable: true,
        },
      },
    });
    expect(state.messages).toEqual([userMessage]);
    expect(state.streaming).toBeNull();
    expect(state.status).toBe("idle");
    expect(state.error?.code).toBe("engine_unavailable");
  });

  it("ignores stray events that arrive outside a turn", () => {
    const state = turnReducer(INITIAL_TURN_STATE, {
      type: "event",
      event: { type: "assistant_delta", text: "orphan" },
    });
    expect(state).toEqual(INITIAL_TURN_STATE);

    const afterDone = turnReducer(INITIAL_TURN_STATE, {
      type: "event",
      event: { type: "done" },
    });
    expect(afterDone.messages).toHaveLength(0);
    expect(afterDone.status).toBe("idle");
  });

  it("does not append an empty assistant message when a turn is stopped", () => {
    const state = turnReducer(streamStarted(send()), {
      type: "event",
      event: { type: "done" },
    });
    expect(state.messages).toEqual([userMessage]);
  });

  it("clears a previous error when the next message is sent", () => {
    const failed = turnReducer(streamStarted(send()), {
      type: "event",
      event: {
        type: "turn_failed",
        error: {
          code: "rate_limited",
          userMessage: "Wait a moment.",
          recoverable: true,
        },
      },
    });
    expect(send(failed).error).toBeNull();
  });
});
