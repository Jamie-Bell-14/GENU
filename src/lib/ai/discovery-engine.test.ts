import { describe, expect, it, vi } from "vitest";
import { ACTIVITY_STEPS, isActivityStep } from "./activity-steps";
import { ScriptedDiscoveryEngine, type TurnHooks } from "./discovery-engine";
import type { EngineEvent } from "./turn-events";

const TURN_ID = "dddddddd-0000-4000-8000-000000000001";
const OBJECT_A = "aaaaaaaa-0000-4000-8000-000000000001";

function harness(direction: string | null = null) {
  const events: EngineEvent[] = [];
  const steps: string[] = [];
  const candidates: unknown[] = [];
  let remaining = direction;
  const hooks: TurnHooks = {
    emit: (event) => events.push(event),
    activity: async (step) => {
      steps.push(step);
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
  context: { objectIds: [OBJECT_A] },
};

describe("ScriptedDiscoveryEngine", () => {
  it("uses the correlation id the host supplied, not one of its own", async () => {
    const { events, hooks } = harness();
    await new ScriptedDiscoveryEngine().runTurn(input, hooks);
    expect(events[0]).toEqual({ type: "turn_started", turnId: TURN_ID });
  });

  it("names only steps the application has a label for", async () => {
    const { steps, hooks } = harness();
    await new ScriptedDiscoveryEngine().runTurn(input, hooks);
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(isActivityStep(step)).toBe(true);
      expect(ACTIVITY_STEPS[step as keyof typeof ACTIVITY_STEPS].label).toEqual(
        expect.any(String),
      );
    }
  });

  it("says plainly that discovery analysis is not connected", async () => {
    const { hooks } = harness();
    const result = await new ScriptedDiscoveryEngine().runTurn(input, hooks);
    expect(result.assistantText).toContain("not connected yet");
  });

  it("recommends a scene naming an object the host supplied", async () => {
    const { candidates, hooks } = harness();
    await new ScriptedDiscoveryEngine().runTurn(input, hooks);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      renderer: "problem_exploration",
      focalObjectId: OBJECT_A,
    });
  });

  it("recommends nothing when the project has no objects to name", async () => {
    const { candidates, hooks } = harness();
    await new ScriptedDiscoveryEngine().runTurn(
      { ...input, context: { objectIds: [] } },
      hooks,
    );
    expect(candidates).toHaveLength(0);
  });

  it("picks up direction at the step boundary it promised", async () => {
    const { events, steps, hooks } = harness("Focus on smaller agencies.");
    const engine = new ScriptedDiscoveryEngine();
    expect(engine.directionApplication).toBe("next_step");

    const result = await engine.runTurn(input, hooks);
    expect(steps).toContain("considering_direction");
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
    expect(steps).not.toContain("considering_direction");
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
