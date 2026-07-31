import { describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_STEPS,
  isActivityStep,
  type ActivityStep,
} from "./activity-steps";
import {
  ScriptedDiscoveryEngine,
  type ResearchOutcome,
  type TurnHooks,
} from "./discovery-engine";
import type { EngineEvent } from "./turn-events";
import type { ResearchTask } from "@/lib/research/types";

const TURN_ID = "dddddddd-0000-4000-8000-000000000001";
const OBJECT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_OBJECT = "aaaaaaaa-0000-4000-8000-000000000002";
const THIRD_OBJECT = "aaaaaaaa-0000-4000-8000-000000000003";

function harness(
  direction: string | null = null,
  options: {
    researchOutcome?: ResearchOutcome;
  } = {},
) {
  const events: EngineEvent[] = [];
  const steps: string[] = [];
  const candidates: unknown[] = [];
  const appliedDirections: string[] = [];
  const researchCalls: ResearchTask[] = [];
  let remaining = direction;
  const hooks: TurnHooks = {
    emit: (event) => events.push(event),
    step: async (name, work, outcome) => {
      steps.push(`${name}:active`);
      let finished = "failed";
      try {
        const result = await work();
        finished = outcome ? outcome(result) : "succeeded";
        return result;
      } finally {
        steps.push(`${name}:${finished}`);
      }
    },
    recommendScene: async (candidate) => {
      candidates.push(candidate);
    },
    directionApplied: (note) => appliedDirections.push(note),
    takeDirection: async () => {
      const next = remaining;
      remaining = null;
      return next;
    },
    runResearch: async (task) => {
      researchCalls.push(task);
      return (
        options.researchOutcome ?? { ok: true, findingTitle: "Test finding" }
      );
    },
  };
  return {
    events,
    steps,
    candidates,
    appliedDirections,
    researchCalls,
    hooks,
  };
}

const input = {
  projectId: "p1",
  turnId: TURN_ID,
  userMessage: "Landlords and tenants argue about property condition.",
  context: { objectIds: [OBJECT_A], focalObjectId: OBJECT_A },
};

describe("ScriptedDiscoveryEngine", () => {
  it("leaves the turn id to the host rather than minting one", async () => {
    // The host emits `turn_started`, because the client needs the id before
    // any work begins in order to steer or recover the turn.
    const { events, hooks } = harness();
    await new ScriptedDiscoveryEngine().runTurn(input, hooks);
    expect(events.some((event) => event.type === "turn_started")).toBe(false);
  });

  it("names only steps the application has a label for", async () => {
    const { steps, hooks } = harness("Focus on smaller agencies.");
    await new ScriptedDiscoveryEngine().runTurn(input, hooks);
    expect(steps.length).toBeGreaterThan(0);
    for (const entry of steps) {
      const [name, state] = entry.split(":");
      expect(isActivityStep(name)).toBe(true);
      expect(
        ACTIVITY_STEPS[name as ActivityStep][
          state as "active" | "succeeded" | "failed"
        ],
      ).toEqual(expect.any(String));
    }
  });

  it("does not report the canvas step itself", async () => {
    // Only the application knows whether a candidate became a scene, so that
    // step is reported at the validation boundary, not here.
    const { steps, hooks } = harness();
    await new ScriptedDiscoveryEngine().runTurn(input, hooks);
    expect(steps).toEqual([]);
  });

  it("reports every step it starts as finished, one way or the other", async () => {
    const { steps, hooks } = harness("Focus on smaller agencies.");
    await new ScriptedDiscoveryEngine().runTurn(input, hooks);
    const started = steps.filter((entry) => entry.endsWith(":active"));
    expect(started.length).toBeGreaterThan(0);
    for (const entry of started) {
      const name = entry.replace(":active", "");
      expect(
        steps.some(
          (other) =>
            other === `${name}:succeeded` || other === `${name}:failed`,
        ),
      ).toBe(true);
    }
  });

  it("says plainly that discovery analysis is not connected", async () => {
    const { hooks } = harness();
    const result = await new ScriptedDiscoveryEngine().runTurn(input, hooks);
    expect(result.assistantText).toContain("not connected yet");
    // And it proposes nothing: a scripted engine that changed project truth
    // would make the message above a lie.
    expect(result.operations).toEqual([]);
  });

  it("names the focal object the application chose, not the first id it was given", async () => {
    const { candidates, hooks } = harness();
    await new ScriptedDiscoveryEngine().runTurn(
      {
        ...input,
        // Deliberately not first: the engine must not confuse "first row
        // returned" with "what this project is exploring".
        context: {
          objectIds: [OTHER_OBJECT, OBJECT_A, THIRD_OBJECT],
          focalObjectId: OBJECT_A,
        },
      },
      hooks,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      renderer: "problem_exploration",
      focalObjectId: OBJECT_A,
    });
  });

  it("does not claim the view is the user's current focus", async () => {
    const { candidates, hooks } = harness();
    await new ScriptedDiscoveryEngine().runTurn(input, hooks);
    expect((candidates[0] as { reason: string }).reason).not.toMatch(
      /currently in focus/i,
    );
  });

  it("keeps the focal object in its own scene, however large the project", async () => {
    // A scene may name at most 60 objects. Taking the first 60 and hoping the
    // focal object is among them fails on any project big enough for it not to
    // be, and validation then rejects the scene as focal_not_visible.
    const many = Array.from(
      { length: 200 },
      (_, index) =>
        `bbbbbbbb-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    const focal = many[150];
    const { candidates, hooks } = harness();
    await new ScriptedDiscoveryEngine().runTurn(
      { ...input, context: { objectIds: many, focalObjectId: focal } },
      hooks,
    );

    const visible = (candidates[0] as { visibleObjectIds: string[] })
      .visibleObjectIds;
    expect(visible).toContain(focal);
    expect(visible.filter((id) => id === focal)).toHaveLength(1);
    expect(visible.length).toBeLessThanOrEqual(60);
  });

  it("recommends nothing when the project has no objects to name", async () => {
    const { candidates, hooks } = harness();
    await new ScriptedDiscoveryEngine().runTurn(
      { ...input, context: { objectIds: [], focalObjectId: null } },
      hooks,
    );
    expect(candidates).toHaveLength(0);
  });

  it("picks up direction at the step boundary it promised", async () => {
    const { events, steps, appliedDirections, hooks } = harness(
      "Focus on smaller agencies.",
    );
    const engine = new ScriptedDiscoveryEngine();
    expect(engine.directionApplication).toBe("next_step");

    const result = await engine.runTurn(input, hooks);
    expect(steps).toContain("considering_direction:active");
    expect(steps).toContain("considering_direction:succeeded");
    expect(result.assistantText).toContain("Focus on smaller agencies.");
    // Announced because it was genuinely picked up, not merely received.
    expect(appliedDirections).toEqual(["Focus on smaller agencies."]);
    // The acknowledgement reaches the user as streamed text, not silently.
    const streamed = events
      .filter((event) => event.type === "assistant_delta")
      .map((event) => event.text)
      .join("");
    expect(streamed).toContain("Focus on smaller agencies.");
  });

  it("does not mention direction when none was added", async () => {
    const { steps, hooks } = harness();
    const result = await new ScriptedDiscoveryEngine().runTurn(input, hooks);
    expect(steps).not.toContain("considering_direction:active");
    expect(result.assistantText).not.toContain("You added");
  });

  it("propagates a failed final direction boundary rather than finishing", async () => {
    /*
      If the seal did not happen, the steering window may still be open with no
      step left to consume anything. The engine must not carry on to a normal
      completion — the host's failure path closes the run, which seals it.
    */
    const { hooks } = harness();
    hooks.takeDirection = async () => {
      throw new Error("direction_seal_failed");
    };
    await expect(
      new ScriptedDiscoveryEngine().runTurn(input, hooks),
    ).rejects.toThrow("direction_seal_failed");
  });

  it("stops mid-turn and keeps nothing partial", async () => {
    const controller = new AbortController();
    const { events, hooks } = harness();
    const engine = new ScriptedDiscoveryEngine();
    const spy = vi.spyOn(hooks, "emit");
    spy.mockImplementation((event) => {
      events.push(event);
      // Abort as soon as text starts arriving.
      if (event.type === "assistant_delta") controller.abort();
    });

    const result = await engine.runTurn(input, hooks, controller.signal);
    expect(result.assistantText).toBe("");
    expect(events.at(-1)).toMatchObject({
      type: "turn_failed",
      error: { code: "turn_interrupted", recoverable: true },
    });
    // `done` is the host's to emit, so the engine never produces one at all.
    expect(events.map((event) => event.type)).not.toContain("done");
  });

  describe("research (T10)", () => {
    it("runs research and recommends the evidence view on 'Research this'", async () => {
      const { candidates, researchCalls, events, hooks } = harness();
      const result = await new ScriptedDiscoveryEngine().runTurn(
        { ...input, userMessage: "Research this" },
        hooks,
      );
      expect(researchCalls).toHaveLength(1);
      expect(researchCalls[0].focalObjectId).toBe(OBJECT_A);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        renderer: "evidence_research",
        purpose: "research_evidence",
        focalObjectId: OBJECT_A,
      });
      expect(result.assistantText).toContain("Test finding");
      const actionIds = events
        .filter((event) => event.type === "actions")
        .flatMap((event) => event.actions.map((action) => action.id));
      expect(actionIds).toContain("add_as_evidence");
    });

    it("reports a stopped research pass honestly rather than a finding", async () => {
      const { hooks } = harness(null, {
        researchOutcome: { ok: false, reason: "stopped" },
      });
      const result = await new ScriptedDiscoveryEngine().runTurn(
        { ...input, userMessage: "Research this" },
        hooks,
      );
      expect(result.assistantText).toMatch(/stopped/i);
    });

    it("does not recommend a scene when research has no focal object", async () => {
      const { candidates, hooks } = harness();
      await new ScriptedDiscoveryEngine().runTurn(
        {
          ...input,
          userMessage: "Research this",
          context: { objectIds: [], focalObjectId: null },
        },
        hooks,
      );
      expect(candidates).toHaveLength(0);
    });
  });

  describe("add as evidence (T10 review round 2, P0-B/P0-C)", () => {
    it("stages add_evidence rather than claiming it happened", async () => {
      const { hooks } = harness();
      const result = await new ScriptedDiscoveryEngine().runTurn(
        { ...input, userMessage: "Add as evidence" },
        hooks,
      );
      // Staged like any other project-truth write: whether it actually
      // links is decided when the turn completes, not by this engine.
      expect(result.operations).toEqual([
        {
          name: "add_evidence",
          candidate: {
            consequenceSummary: expect.any(String),
            // This engine cannot judge whether the scripted finding
            // supports or contradicts an arbitrary, unknown target object,
            // so it honestly proposes "unclear" rather than guess.
            direction: "unclear",
          },
        },
      ]);
      // Present-progressive, not a past-tense claim the turn cannot yet back.
      expect(result.assistantText).not.toMatch(/^i added/i);
      expect(result.assistantText).toMatch(/does not/i);
    });
  });
});
