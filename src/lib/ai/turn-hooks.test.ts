import { describe, expect, it, vi } from "vitest";
import type { ProjectScope } from "@/lib/canvas/scene";
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
  const ports: TurnPorts = {
    emit: (event) => events.push(event),
    scope,
    onActivity: vi.fn(async () => {}),
    onSceneAccepted: vi.fn(async () => {}),
    onSceneRejected: vi.fn(async () => {}),
    takeDirection: vi.fn(async () => null),
    ...overrides,
  };
  return { events, ports, hooks: createTurnHooks(ports) };
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

describe("activity labels", () => {
  it("uses the application's own words for a named step", async () => {
    const { events, ports, hooks } = setup();
    await hooks.activity("recording_message");

    const activity = events.find((event) => event.type === "activity");
    expect(activity).toMatchObject({
      activity: { kind: "analysis", label: "Recording your message…" },
    });
    expect(ports.onActivity).toHaveBeenCalledTimes(1);
  });

  it("shows the line before persistence resolves, so display never waits", async () => {
    let resolvePersist: (() => void) | null = null;
    const { events, hooks } = setup({
      onActivity: () =>
        new Promise<void>((resolve) => {
          resolvePersist = resolve;
        }),
    });

    const pending = hooks.activity("reading_project_model");
    expect(events.filter((event) => event.type === "activity")).toHaveLength(1);
    resolvePersist!();
    await pending;
  });
});
