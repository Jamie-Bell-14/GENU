import { describe, expect, it, vi } from "vitest";
import type { ProjectScope } from "@/lib/canvas/scene";
import { createActivityReporter } from "./activity-reporter";
import { createTurnHooks, type TurnPorts } from "./turn-hooks";
import type { TurnEvent } from "./turn-events";

const TURN_ID = "dddddddd-0000-4000-8000-000000000001";

const OBJECT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const OBJECT_B = "aaaaaaaa-0000-4000-8000-000000000002";
const FOREIGN = "cccccccc-0000-4000-8000-000000000009";

const scope: ProjectScope = {
  objectIds: new Set([OBJECT_A, OBJECT_B]),
  relationshipIds: new Set(["bbbbbbbb-0000-4000-8000-000000000001"]),
};

function validCandidate(overrides: Record<string, unknown> = {}) {
  return {
    renderer: "problem_exploration",
    purpose: "explore_problem",
    focalObjectId: OBJECT_A,
    visibleObjectIds: [OBJECT_A, OBJECT_B],
    visibleRelationshipIds: [],
    emphasis: "none",
    reason: "Showing how the problem connects.",
    transition: "replace",
    ...overrides,
  };
}

function setup(overrides: Partial<TurnPorts> = {}) {
  const events: TurnEvent[] = [];
  const emit = (event: TurnEvent) => events.push(event);
  const persist = vi.fn(async () => {});
  const ports: TurnPorts = {
    emit,
    scope,
    reporter: createActivityReporter({ turnId: TURN_ID, emit, persist }),
    onSceneAccepted: vi.fn(async () => {}),
    onSceneRejected: vi.fn(async () => {}),
    takeDirection: vi.fn(async () => null),
    ...overrides,
  };
  return { events, ports, persist, hooks: createTurnHooks(ports) };
}

describe("scene recommendation boundary", () => {
  it("emits and records a scene that references only this project", async () => {
    const { events, ports, hooks } = setup();
    await hooks.recommendScene(validCandidate());

    const emitted = events.find((event) => event.type === "scene_recommended");
    expect(emitted).toBeDefined();
    expect(ports.onSceneAccepted).toHaveBeenCalledTimes(1);
    expect(ports.onSceneRejected).not.toHaveBeenCalled();
  });

  it("rejects an unregistered renderer without emitting anything", async () => {
    const { events, ports, hooks } = setup();
    await hooks.recommendScene(validCandidate({ renderer: "custom_iframe" }));

    expect(events).toHaveLength(0);
    expect(ports.onSceneRejected).toHaveBeenCalledWith(
      expect.objectContaining({ code: "unknown_renderer" }),
    );
  });

  it("rejects a scene naming an object outside the project", async () => {
    const { events, ports, hooks } = setup();
    await hooks.recommendScene(
      validCandidate({
        focalObjectId: FOREIGN,
        visibleObjectIds: [FOREIGN, OBJECT_A],
      }),
    );

    expect(events).toHaveLength(0);
    expect(ports.onSceneRejected).toHaveBeenCalledWith(
      expect.objectContaining({ code: "object_not_in_project" }),
    );
  });

  it("rejects markup, links and styling smuggled through the reason", async () => {
    const { events, ports, hooks } = setup();
    for (const reason of [
      "<img src=x onerror=alert(1)>",
      "See https://example.com/report",
      "Focus <b>here</b>",
      "style=color:red",
    ]) {
      await hooks.recommendScene(validCandidate({ reason }));
    }
    expect(events).toHaveLength(0);
    expect(ports.onSceneRejected).toHaveBeenCalledTimes(4);
  });

  it("rejects unknown fields rather than ignoring them", async () => {
    const { events, ports, hooks } = setup();
    await hooks.recommendScene(
      validCandidate({ x: 120, y: 40, html: "<div/>" }),
    );
    expect(events).toHaveLength(0);
    expect(ports.onSceneRejected).toHaveBeenCalledWith(
      expect.objectContaining({ code: "schema_invalid" }),
    );
  });

  it("tells the engine nothing about the outcome either way", async () => {
    const { hooks } = setup();
    await expect(
      hooks.recommendScene(validCandidate()),
    ).resolves.toBeUndefined();
    await expect(
      hooks.recommendScene(validCandidate({ renderer: "nope" })),
    ).resolves.toBeUndefined();
  });
});

describe("activity reporting", () => {
  it("uses the application's own words, and reports start and finish", async () => {
    const { events, persist, hooks } = setup();
    await hooks.step("reading_project_model", async () => "done");

    const lines = events
      .filter((event) => event.type === "activity")
      .map((event) => event.activity);
    expect(lines.map((line) => [line.state, line.label])).toEqual([
      ["active", "Reading the current project model…"],
      ["complete", "Project model read"],
    ]);
    // Both reports describe one operation, so they share an id.
    expect(new Set(lines.map((line) => line.id)).size).toBe(1);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("brackets the work, so the active line exists only while it runs", async () => {
    const { events, hooks } = setup();
    let sawActiveDuringWork = false;

    await hooks.step("preparing_canvas_view", async () => {
      const lines = events.filter((event) => event.type === "activity");
      sawActiveDuringWork =
        lines.length === 1 && lines[0].activity.state === "active";
    });

    expect(sawActiveDuringWork).toBe(true);
    expect(
      events.filter((event) => event.type === "activity").at(-1),
    ).toMatchObject({ activity: { state: "complete" } });
  });

  it("still reports completion when the work throws", async () => {
    const { events, hooks } = setup();
    await expect(
      hooks.step("preparing_canvas_view", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(
      events.filter((event) => event.type === "activity").at(-1),
    ).toMatchObject({ activity: { state: "complete" } });
  });

  it("returns the work's own result to the caller", async () => {
    const { hooks } = setup();
    await expect(
      hooks.step("reading_project_model", async () => 42),
    ).resolves.toBe(42);
  });
});
