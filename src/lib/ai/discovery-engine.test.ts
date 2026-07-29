import { describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_STEPS,
  isActivityStep,
  type ActivityStep,
} from "./activity-steps";
import { ScriptedDiscoveryEngine, type TurnHooks } from "./discovery-engine";
import type { EngineEvent } from "./turn-events";

const TURN_ID = "dddddddd-0000-4000-8000-000000000001";
const OBJECT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_OBJECT = "aaaaaaaa-0000-4000-8000-000000000002";
const THIRD_OBJECT = "aaaaaaaa-0000-4000-8000-000000000003";

function harness(direction: string | null = null) {
  const events: EngineEvent[] = [];
  const steps: string[] = [];
  const candidates: unknown[] = [];
  let remaining = direction;
  const hooks: TurnHooks = {
    emit: (event) => events.push(event),
    step: async (name, work) => {
      steps.push(`${name}:active`);
      try {
        return await work();
      } finally {
        steps.push(`${name}:complete`);
      }
    },
    recommendScene: async (candidate) => {
      candidates.push(candidate);
    },
    takeDirection: async () => {
      const next = remaining;
      remaining = null;
      return next;
    },
  };
  return { events, steps, candidates, hooks };
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
    const { steps, hooks } = harness();
    await new ScriptedDiscoveryEngine().runTurn(input, hooks);
    expect(steps.length).toBeGreaterThan(0);
    for (const entry of steps) {
      const [name, state] = entry.split(":");
      expect(isActivityStep(name)).toBe(true);
      expect(ACTIVITY_STEPS[name as ActivityStep][state as "active"]).toEqual(
        expect.any(String),
      );
    }
  });

  it("reports every step as complete once its work has finished", async () => {
    const { steps, hooks } = harness();
    await new ScriptedDiscoveryEngine().runTurn(input, hooks);
    const started = steps.filter((entry) => entry.endsWith(":active"));
    for (const entry of started) {
      expect(steps).toContain(entry.replace(":active", ":complete"));
    }
  });

  it("says plainly that discovery analysis is not connected", async () => {
    const { hooks } = harness();
    const result = await new ScriptedDiscoveryEngine().runTurn(input, hooks);
    expect(result.assistantText).toContain("not connected yet");
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

  it("recommends nothing when the project has no objects to name", async () => {
    const { candidates, hooks } = harness();
    await new ScriptedDiscoveryEngine().runTurn(
      { ...input, context: { objectIds: [], focalObjectId: null } },
      hooks,
    );
    expect(candidates).toHaveLength(0);
  });

  it("picks up direction at the step boundary it promised", async () => {
    const { events, steps, hooks } = harness("Focus on smaller agencies.");
    const engine = new ScriptedDiscoveryEngine();
    expect(engine.directionApplication).toBe("next_step");

    const result = await engine.runTurn(input, hooks);
    expect(steps).toContain("considering_direction:active");
    expect(steps).toContain("considering_direction:complete");
    expect(result.assistantText).toContain("Focus on smaller agencies.");
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
    expect(events.some((event) => event.type === "done")).toBe(false);
  });
});
