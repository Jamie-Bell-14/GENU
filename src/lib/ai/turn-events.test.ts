import { describe, expect, it } from "vitest";
import type { CanvasScene } from "@/lib/canvas/scene";
import {
  activityLineFor,
  turnReducer,
  INITIAL_TURN_STATE,
  NO_ACTIVITY,
  type Message,
  type TurnState,
} from "./turn-events";

const TURN = "t1";

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

function scene(): CanvasScene {
  return {
    renderer: "problem_exploration",
    purpose: "explore_problem",
    focalObjectId: "aaaaaaaa-0000-4000-8000-000000000001",
    visibleObjectIds: ["aaaaaaaa-0000-4000-8000-000000000001"],
    visibleRelationshipIds: [],
    emphasis: "none",
    reason: "Showing the problem in focus.",
    transition: "replace",
  };
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
      event: {
        type: "activity",
        activity: activityLineFor(TURN, "reading_project_model", "active"),
      },
    });
    expect(state.activity.conversation?.label).toBe(
      "Reading the current project model…",
    );
    state = turnReducer(state, { type: "event", event: { type: "done" } });
    expect(state.activity.conversation).toBeNull();
    // The line fades from the working surface but stays retrievable.
    expect(state.activityLog.map((line) => line.step)).toEqual([
      "reading_project_model",
    ]);
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
        turnId: TURN,
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

  it("takes back the buttons and the proposed view when a turn fails", () => {
    /*
      Actions and scene recommendations are emitted as the turn goes, so a turn
      that then fails would otherwise leave next-step buttons and a proposed
      canvas view belonging to work the user never received.
    */
    let state = streamStarted(send());
    state = turnReducer(state, {
      type: "event",
      event: {
        type: "actions",
        actions: [{ id: "a1", label: "Challenge this" }],
      },
    });
    state = turnReducer(state, {
      type: "event",
      event: { type: "scene_recommended", scene: scene(), turnId: TURN },
    });
    expect(state.actions).toHaveLength(1);
    expect(state.recommendedScene).not.toBeNull();

    state = turnReducer(state, {
      type: "event",
      event: {
        type: "turn_failed",
        turnId: TURN,
        error: {
          code: "engine_unavailable",
          userMessage: "The response could not be completed.",
          recoverable: true,
        },
      },
    });
    expect(state.actions).toEqual([]);
    expect(state.recommendedScene).toBeNull();
  });

  it("issue #13: does not clear a different turn's queued recommendation", () => {
    let state = streamStarted(send());
    state = turnReducer(state, {
      type: "event",
      event: { type: "scene_recommended", scene: scene(), turnId: TURN },
    });
    expect(state.recommendedScene?.turnId).toBe(TURN);

    // A failure attributed to a *different* turn must not touch it.
    state = turnReducer(state, {
      type: "event",
      event: {
        type: "turn_failed",
        turnId: "some-other-turn",
        error: {
          code: "engine_unavailable",
          userMessage: "The response could not be completed.",
          recoverable: true,
        },
      },
    });
    expect(state.recommendedScene).not.toBeNull();
    expect(state.recommendedScene?.turnId).toBe(TURN);
  });

  it("withdraws the message when the server refused to start the turn", () => {
    /*
      A refused send stored nothing. Leaving the message in the stream while the
      composer also holds the text again showed the same sentence twice — and the
      retry then wrote a second copy of a message the server had already saved.
    */
    const refused = turnReducer(send(), {
      type: "send_refused",
      messageId: userMessage.id,
      error: {
        code: "engine_unavailable",
        userMessage: "This project already has a response in progress.",
        recoverable: true,
      },
    });
    expect(refused.messages).toEqual([]);
    expect(refused.status).toBe("idle");
    expect(refused.error?.recoverable).toBe(true);
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
        turnId: TURN,
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

describe("activity history, scenes and steering", () => {
  const report = (
    state: TurnState,
    step: "reading_project_model" | "preparing_canvas_view",
    lifecycle: "active" | "succeeded" | "failed",
    operationId = `${TURN}:${step}`,
  ) =>
    turnReducer(state, {
      type: "event",
      event: {
        type: "activity",
        activity: activityLineFor(operationId, step, lifecycle),
      },
    });

  it("keeps a retrievable log after the working line has faded", () => {
    let state = streamStarted(send());
    state = report(state, "reading_project_model", "active");
    state = report(state, "reading_project_model", "succeeded");
    state = report(state, "preparing_canvas_view", "active");
    state = report(state, "preparing_canvas_view", "succeeded");
    state = turnReducer(state, { type: "event", event: { type: "done" } });

    expect(state.activity).toEqual(NO_ACTIVITY);
    expect(state.activityLog.map((entry) => entry.step)).toEqual([
      "reading_project_model",
      "preparing_canvas_view",
    ]);
    expect(
      state.activityLog.every((entry) => entry.state === "succeeded"),
    ).toBe(true);
  });

  it("does not leave a finished step looking active on its own surface", () => {
    let state = streamStarted(send());
    state = report(state, "reading_project_model", "active");
    state = report(state, "reading_project_model", "succeeded");
    // Canvas work starts while the conversation's step is already finished.
    state = report(state, "preparing_canvas_view", "active");

    expect(state.activity.conversation?.state).toBe("succeeded");
    expect(state.activity.canvas?.state).toBe("active");
  });

  it("does not duplicate a line that is delivered twice", () => {
    let state = streamStarted(send());
    state = report(state, "reading_project_model", "active");
    state = report(state, "reading_project_model", "succeeded");
    // A reconnect replays what was already received.
    state = report(state, "reading_project_model", "succeeded");
    expect(state.activityLog).toHaveLength(1);
  });

  it("holds a recommended scene without touching the project model", () => {
    const scene: CanvasScene = {
      renderer: "problem_exploration",
      purpose: "explore_problem",
      focalObjectId: "aaaaaaaa-0000-4000-8000-000000000001",
      visibleObjectIds: ["aaaaaaaa-0000-4000-8000-000000000001"],
      visibleRelationshipIds: [],
      emphasis: "none",
      reason: "Showing the problem in focus.",
      transition: "replace",
    };
    const state = turnReducer(streamStarted(send()), {
      type: "event",
      event: { type: "scene_recommended", scene, turnId: TURN },
    });

    expect(state.recommendedScene).toEqual({ scene, turnId: TURN });
    // Nothing about project truth lives in turn state, so there is nothing a
    // scene could have changed.
    expect(state.messages).toEqual([userMessage]);
  });

  it("separates the promise made about a direction from its application", () => {
    let state = streamStarted(send());
    state = turnReducer(state, {
      type: "direction_accepted",
      note: "Focus on smaller agencies.",
      application: "next_step",
    });
    expect(state.direction).toEqual({
      note: "Focus on smaller agencies.",
      application: "next_step",
      applied: false,
    });

    state = turnReducer(state, {
      type: "event",
      event: { type: "direction_applied", note: "Focus on smaller agencies." },
    });
    expect(state.direction?.applied).toBe(true);
  });

  it("ignores an applied direction that was never accepted here", () => {
    const state = turnReducer(streamStarted(send()), {
      type: "event",
      event: { type: "direction_applied", note: "unseen" },
    });
    expect(state.direction).toBeNull();
  });

  it("clears the previous direction when a new message is sent", () => {
    const withDirection = turnReducer(streamStarted(send()), {
      type: "direction_accepted",
      note: "Focus on smaller agencies.",
      application: "next_step",
    });
    expect(send(withDirection).direction).toBeNull();
  });
});

describe("stopping and losing the connection", () => {
  function withPartialText(): TurnState {
    return turnReducer(streamStarted(send()), {
      type: "event",
      event: { type: "assistant_delta", text: "A half-finished thought" },
    });
  }

  it("never turns a stopped response into a completed answer", () => {
    const state = turnReducer(withPartialText(), { type: "turn_stopped" });

    expect(state.messages).toEqual([userMessage]);
    expect(state.streaming).toBeNull();
    expect(state.activity).toEqual(NO_ACTIVITY);
    expect(state.status).toBe("idle");
    expect(state.stopped).toBe(true);
    // Stopping is a decision, not a failure.
    expect(state.error).toBeNull();
    expect(state.recoveries).toEqual([]);
  });

  it("discards partial text when the connection drops too", () => {
    const state = turnReducer(withPartialText(), {
      type: "connection_lost",
      turnId: TURN,
    });
    expect(state.messages).toEqual([userMessage]);
    expect(state.recoveries).toEqual([{ turnId: TURN, state: "checking" }]);
    expect(state.status).toBe("idle");
  });

  it("takes the recorded result on catch-up without duplicating it", () => {
    const persisted: Message = {
      id: "assistant-1",
      turnId: TURN,
      role: "assistant",
      content: "The complete recorded answer.",
      blockKind: "plain",
      createdAt: "2026-07-29T00:00:00.000Z",
    };
    let state = turnReducer(withPartialText(), {
      type: "connection_lost",
      turnId: TURN,
    });
    state = turnReducer(state, {
      type: "recovered",
      turnId: TURN,
      outcome: "completed",
      activityLog: [
        activityLineFor(TURN, "reading_project_model", "succeeded"),
      ],
      message: persisted,
    });

    expect(state.messages.map((message) => message.content)).toEqual([
      userMessage.content,
      "The complete recorded answer.",
    ]);
    expect(state.recoveries).toEqual([]);
    expect(state.error).toBeNull();

    // Catching up twice must not append the same message again.
    const again = turnReducer(state, {
      type: "recovered",
      turnId: TURN,
      outcome: "completed",
      activityLog: [
        activityLineFor(TURN, "reading_project_model", "succeeded"),
      ],
      message: persisted,
    });
    expect(again.messages).toHaveLength(2);
    expect(again.activityLog).toHaveLength(1);
  });

  it("says the turn did not finish, against the turn it concerns", () => {
    let state = turnReducer(withPartialText(), {
      type: "connection_lost",
      turnId: TURN,
    });
    state = turnReducer(state, {
      type: "recovered",
      turnId: TURN,
      outcome: "unfinished",
      activityLog: [],
      message: null,
    });
    expect(state.messages).toEqual([userMessage]);
    expect(state.recoveries).toEqual([{ turnId: TURN, state: "unfinished" }]);
    // The verdict belongs to this turn, so it is not written to the one error
    // field the whole conversation shares.
    expect(state.error).toBeNull();
  });

  /*
    Recovery outcomes and conversation-level errors are different things, and
    the tests below hold them apart. Each one describes two turns coexisting —
    which is the only situation in which a single global error field is
    detectably wrong.
  */
  describe("recovery outcomes stay with their own turn", () => {
    const OTHER = "dddddddd-0000-4000-8000-0000000000ff";
    const directionError = {
      code: "engine_unavailable" as const,
      userMessage: "Your direction could not be recorded.",
      recoverable: true,
    };

    /** An older turn awaiting recovery, while a newer turn streams. */
    function twoTurns() {
      let state = turnReducer(withPartialText(), {
        type: "connection_lost",
        turnId: TURN,
      });
      state = turnReducer(state, {
        type: "user_message_sent",
        message: { ...userMessage, id: "m2", content: "A later question" },
      });
      return turnReducer(state, {
        type: "event",
        event: { type: "turn_started", turnId: OTHER },
      });
    }

    it("does not clear another turn's error when a recovery resolves", () => {
      let state = turnReducer(twoTurns(), {
        type: "direction_failed",
        error: directionError,
      });
      state = turnReducer(state, {
        type: "recovered",
        turnId: TURN,
        outcome: "completed",
        activityLog: [],
        message: null,
      });
      expect(state.error).toEqual(directionError);
      expect(state.recoveries).toEqual([]);
    });

    it("does not present an older turn's failure as the active turn's", () => {
      const state = turnReducer(twoTurns(), {
        type: "recovered",
        turnId: TURN,
        outcome: "unfinished",
        activityLog: [],
        message: null,
      });
      expect(state.error).toBeNull();
      expect(state.recoveries).toEqual([{ turnId: TURN, state: "unfinished" }]);
      // The newer turn is untouched and still streaming.
      expect(state.streaming?.turnId).toBe(OTHER);
    });

    it("dismisses only the recovery it names", () => {
      let state = turnReducer(twoTurns(), {
        type: "recovered",
        turnId: TURN,
        outcome: "unfinished",
        activityLog: [],
        message: null,
      });
      state = turnReducer(state, {
        type: "connection_lost",
        turnId: OTHER,
      });
      state = turnReducer(state, {
        type: "recovered",
        turnId: OTHER,
        outcome: "still_running",
        activityLog: [],
        message: null,
      });
      expect(state.recoveries).toHaveLength(2);

      const dismissed = turnReducer(state, {
        type: "dismiss_recovery",
        turnId: TURN,
      });
      expect(dismissed.recoveries).toEqual([
        { turnId: OTHER, state: "still_running" },
      ]);
    });

    it("leaves a direction error standing while a recovery fails", () => {
      let state = turnReducer(twoTurns(), {
        type: "direction_failed",
        error: directionError,
      });
      state = turnReducer(state, {
        type: "recovered",
        turnId: TURN,
        outcome: "lookup_failed",
        activityLog: [],
        message: null,
      });
      expect(state.error).toEqual(directionError);
      expect(state.recoveries).toEqual([
        { turnId: TURN, state: "unavailable" },
      ]);
    });
  });

  it("reports a refused direction without ending the turn", () => {
    const streaming = turnReducer(streamStarted(send()), {
      type: "direction_failed",
      error: {
        code: "engine_unavailable",
        userMessage: "Your direction could not be recorded.",
        recoverable: true,
      },
    });
    expect(streaming.error?.userMessage).toBe(
      "Your direction could not be recorded.",
    );
    expect(streaming.status).toBe("streaming");
    expect(streaming.direction).toBeNull();
  });
});

describe("an unresolved recovery", () => {
  function unresolved(): TurnState {
    const state = turnReducer(streamStarted(send()), {
      type: "connection_lost",
      turnId: TURN,
    });
    return turnReducer(state, {
      type: "recovered",
      turnId: TURN,
      outcome: "still_running",
      activityLog: [],
      message: null,
    });
  }

  it("survives the user sending another message", () => {
    // Getting on with the next message is not a decision to abandon a turn
    // the server may still be finishing.
    const before = unresolved();
    expect(before.recoveries).toEqual([
      { turnId: TURN, state: "still_running" },
    ]);

    const after = send(before);
    expect(after.recoveries).toEqual([
      { turnId: TURN, state: "still_running" },
    ]);
    expect(after.status).toBe("sending");
  });

  it("is cleared only when resolved or dismissed", () => {
    const dismissed = turnReducer(unresolved(), {
      type: "dismiss_recovery",
      turnId: TURN,
    });
    expect(dismissed.recoveries).toEqual([]);

    const resolved = turnReducer(unresolved(), {
      type: "recovered",
      turnId: TURN,
      outcome: "completed",
      activityLog: [],
      message: {
        id: "assistant-1",
        turnId: TURN,
        role: "assistant",
        content: "The recorded answer.",
        blockKind: "plain",
        createdAt: "2026-07-29T00:00:00.000Z",
      },
    });
    expect(resolved.recoveries).toEqual([]);
    expect(resolved.messages).toHaveLength(2);
  });
});

describe("research (T10)", () => {
  const testFinding = {
    id: "tenancy-deposit-disputes-2024",
    title: "Deposit disputes are common",
    keyFinding: "Roughly 1 in 6.",
    whyItMatters: "It matters.",
    visualisation: { kind: "bar" as const, unit: "%", series: [] },
    sources: [],
    methodology: "Method.",
    limitations: "Limits.",
    retrievedAt: "2026-07-30T00:00:00.000Z",
    isDemo: true as const,
    conflicting: false,
  };

  it("holds the finding a research pass produced", () => {
    const state = turnReducer(streamStarted(send()), {
      type: "event",
      event: { type: "research_finding", finding: testFinding },
    });
    expect(state.activeResearch).toEqual(testFinding);
  });

  it("accumulates unavailable sources rather than discarding them", () => {
    const unavailable = {
      id: "demo-regional-authority-bulletin",
      name: "Demonstration Regional Housing Authority — Illustrative Bulletin",
      url: null,
      retrievedAt: "2026-07-30T00:00:00.000Z",
    };
    const state = turnReducer(streamStarted(send()), {
      type: "event",
      event: {
        type: "research_failed_source",
        source: unavailable,
        reason: "This source could not be retrieved in the demonstration run.",
      },
    });
    expect(state.unavailableSources).toEqual([
      {
        source: unavailable,
        reason: "This source could not be retrieved in the demonstration run.",
      },
    ]);
  });

  describe("a new pass supersedes the last one (T10 review round 2, P0-D)", () => {
    it("clears a previous finding the moment a new pass starts", () => {
      const withFinding = turnReducer(streamStarted(send()), {
        type: "event",
        event: { type: "research_finding", finding: testFinding },
      });
      const state = turnReducer(withFinding, {
        type: "event",
        event: { type: "research_started" },
      });
      expect(state.activeResearch).toBeNull();
    });

    it("clears the previous pass's unavailable sources the moment a new pass starts", () => {
      const unavailable = {
        id: "demo-regional-authority-bulletin",
        name: "Demonstration Regional Housing Authority — Illustrative Bulletin",
        url: null,
        retrievedAt: "2026-07-30T00:00:00.000Z",
      };
      const withUnavailable = turnReducer(streamStarted(send()), {
        type: "event",
        event: {
          type: "research_failed_source",
          source: unavailable,
          reason: "unavailable",
        },
      });
      const state = turnReducer(withUnavailable, {
        type: "event",
        event: { type: "research_started" },
      });
      expect(state.unavailableSources).toEqual([]);
    });

    it("leaves a pass that produces nothing with no stale receipt to add", () => {
      // The exact scenario the review flagged: a successful pass, then a
      // second pass that produces no finding at all (e.g. every source
      // unavailable) must not leave the first pass's receipt answerable to
      // "Add as evidence".
      const withFinding = turnReducer(streamStarted(send()), {
        type: "event",
        event: { type: "research_finding", finding: testFinding },
      });
      const secondPassStarted = turnReducer(withFinding, {
        type: "event",
        event: { type: "research_started" },
      });
      const failed = turnReducer(secondPassStarted, {
        type: "event",
        event: {
          type: "turn_failed",
          turnId: "t1",
          error: {
            code: "research_source_unavailable",
            userMessage:
              "None of the demonstration sources could be retrieved.",
            recoverable: true,
          },
        },
      });
      expect(failed.activeResearch).toBeNull();
    });
  });

  describe("direction_rejected (T10 review round 2, P0-D)", () => {
    it("corrects the earlier promise once the provider says it cannot apply", () => {
      const withDirection = turnReducer(streamStarted(send()), {
        type: "direction_accepted",
        note: "Focus on smaller agencies.",
        application: "next_step",
      });
      const state = turnReducer(withDirection, {
        type: "event",
        event: {
          type: "direction_rejected",
          note: "Focus on smaller agencies.",
          reason:
            "This direction cannot be applied to the research already running.",
        },
      });
      expect(state.direction).toMatchObject({
        applied: false,
        rejectedReason:
          "This direction cannot be applied to the research already running.",
      });
    });

    it("does nothing when no direction was ever accepted", () => {
      const state = turnReducer(streamStarted(send()), {
        type: "event",
        event: {
          type: "direction_rejected",
          note: "unseen",
          reason: "unseen",
        },
      });
      expect(state.direction).toBeNull();
    });
  });
});
