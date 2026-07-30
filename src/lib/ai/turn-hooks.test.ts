import { describe, expect, it, vi } from "vitest";
import type { ProjectScope } from "@/lib/canvas/scene";
import { createActivityReporter } from "./activity-reporter";
import { createTurnHooks, type TurnPorts } from "./turn-hooks";
import type { TurnEvent } from "./turn-events";

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
    reporter: createActivityReporter({ emit, persist }),
    onSceneAccepted: vi.fn(async () => {}),
    onSceneRejected: vi.fn(async () => {}),
    takeDirection: vi.fn(async () => null),
    onDirectionApplied: () => {},
    ...overrides,
  };
  return {
    events,
    ports,
    persist,
    hooks: createTurnHooks(ports),
    /** Everything except the reporting of the step itself. */
    outcomes: () => events.filter((event) => event.type !== "activity"),
    activity: () =>
      events
        .filter((event) => event.type === "activity")
        .map((event) => event.activity),
  };
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
    const { outcomes, ports, hooks } = setup();
    await hooks.recommendScene(validCandidate({ renderer: "custom_iframe" }));

    expect(outcomes()).toHaveLength(0);
    expect(ports.onSceneRejected).toHaveBeenCalledWith(
      expect.objectContaining({ code: "unknown_renderer" }),
    );
  });

  it("rejects a scene naming an object outside the project", async () => {
    const { outcomes, ports, hooks } = setup();
    await hooks.recommendScene(
      validCandidate({
        focalObjectId: FOREIGN,
        visibleObjectIds: [FOREIGN, OBJECT_A],
      }),
    );

    expect(outcomes()).toHaveLength(0);
    expect(ports.onSceneRejected).toHaveBeenCalledWith(
      expect.objectContaining({ code: "object_not_in_project" }),
    );
  });

  it("rejects markup, links and styling smuggled through the reason", async () => {
    const { outcomes, ports, hooks } = setup();
    for (const reason of [
      "<img src=x onerror=alert(1)>",
      "See https://example.com/report",
      "Focus <b>here</b>",
      "style=color:red",
    ]) {
      await hooks.recommendScene(validCandidate({ reason }));
    }
    expect(outcomes()).toHaveLength(0);
    expect(ports.onSceneRejected).toHaveBeenCalledTimes(4);
  });

  it("rejects unknown fields rather than ignoring them", async () => {
    const { outcomes, ports, hooks } = setup();
    await hooks.recommendScene(
      validCandidate({ x: 120, y: 40, html: "<div/>" }),
    );
    expect(outcomes()).toHaveLength(0);
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

describe("reporting the canvas step", () => {
  it("says a view was prepared only when one actually was", async () => {
    const { activity, hooks } = setup();
    await hooks.recommendScene(validCandidate());

    expect(activity().map((line) => [line.state, line.label])).toEqual([
      ["active", "Preparing a canvas view of the current problem…"],
      ["succeeded", "Canvas view prepared"],
    ]);
  });

  it("reports a rejected candidate as no view prepared", async () => {
    const { activity, hooks } = setup();
    await hooks.recommendScene(validCandidate({ renderer: "custom_iframe" }));

    expect(activity().at(-1)).toMatchObject({
      state: "failed",
      label: "No canvas view could be prepared",
    });
  });

  it("still tells the engine nothing about which way it went", async () => {
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
      ["succeeded", "Project model read"],
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
    ).toMatchObject({ activity: { state: "succeeded" } });
  });

  it("reports work that throws as failed, never as succeeded", async () => {
    const { activity, hooks } = setup();
    await expect(
      hooks.step("preparing_canvas_view", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const last = activity().at(-1)!;
    expect(last.state).toBe("failed");
    expect(last.label).toBe("No canvas view could be prepared");
    // The live indicator stops, but nothing claims the work succeeded.
    expect(activity().map((line) => line.state)).toEqual(["active", "failed"]);
  });

  it("reports work that returns an unsuccessful result as failed", async () => {
    const { activity, hooks } = setup();
    await hooks.step(
      "reading_project_model",
      async () => ({ whole: false }),
      (result) => (result.whole ? "succeeded" : "failed"),
    );

    const last = activity().at(-1)!;
    expect(last.state).toBe("failed");
    expect(last.label).toBe("The project model could not be read in full");
  });

  it("gives every invocation of a step its own identity", async () => {
    const { activity, hooks } = setup();
    await hooks.step("considering_direction", async () => undefined);
    await hooks.step("considering_direction", async () => undefined);

    const ids = new Set(activity().map((line) => line.id));
    // Two real invocations, two operations — not one overwritten by the other.
    expect(ids.size).toBe(2);
  });

  it("returns the work's own result to the caller", async () => {
    const { hooks } = setup();
    await expect(
      hooks.step("reading_project_model", async () => 42),
    ).resolves.toBe(42);
  });
});
