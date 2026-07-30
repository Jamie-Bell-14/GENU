import { describe, expect, it, vi } from "vitest";
import type { ProjectScope } from "@/lib/canvas/scene";
import type {
  ResearchEvent,
  ResearchFinding,
  ResearchProvider,
} from "@/lib/research/types";
import { createActivityReporter } from "./activity-reporter";
import { createTurnHooks, type TurnPorts } from "./turn-hooks";
import type { TurnEvent } from "./turn-events";

const OBJECT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const OBJECT_B = "aaaaaaaa-0000-4000-8000-000000000002";
const FOREIGN = "cccccccc-0000-4000-8000-000000000009";
const TURN_ID = "dddddddd-0000-4000-8000-000000000001";

/** A provider that never emits anything unless a test wires it up itself. */
const inertResearchProvider: ResearchProvider = {
  start: () => ({ id: "inert" }),
  steer: () => "requires_restart",
  stop: () => {},
};

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
    turnId: TURN_ID,
    researchProvider: inertResearchProvider,
    focalObjectId: OBJECT_A,
    activeFindingId: null,
    writeEvidence: vi.fn(async (): Promise<"linked"> => "linked"),
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
    expect(emitted).toMatchObject({ turnId: TURN_ID });
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

/** Lets a few microtask hops of the orchestration's own awaits settle. */
async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

/** A provider driven manually from a test, for `runResearch`'s orchestration. */
function fakeProvider() {
  let handler: ((event: ResearchEvent) => void) | null = null;
  let stopped = false;
  const steerCalls: string[] = [];
  const provider: ResearchProvider = {
    start: (_task, onEvent) => {
      handler = onEvent;
      return { id: "fake-handle" };
    },
    steer: (_handle, direction) => {
      steerCalls.push(direction);
      return "applied_now";
    },
    stop: () => {
      stopped = true;
    },
  };
  return {
    provider,
    push: (event: ResearchEvent) => handler?.(event),
    steerCalls,
    isStopped: () => stopped,
  };
}

const FINDING: ResearchFinding = {
  id: "test-finding",
  title: "Test finding",
  keyFinding: "Key finding text.",
  whyItMatters: "Why it matters text.",
  visualisation: { kind: "bar", unit: "%", series: [{ label: "A", value: 1 }] },
  sources: [],
  methodology: "Method.",
  limitations: "Limits.",
  retrievedAt: "2026-01-01T00:00:00.000Z",
  isDemo: true,
  conflicting: false,
};

describe("runResearch orchestration (T10)", () => {
  it("brackets a step's activity for the duration until the next provider event", async () => {
    const { provider, push } = fakeProvider();
    const { activity, hooks } = setup({ researchProvider: provider });

    const outcome = hooks.runResearch({ topic: "t", focalObjectId: OBJECT_A });
    push({ type: "step", step: "searching_sources" });
    // Only the active line exists while the provider has not moved on.
    await flush();
    expect(activity().map((line) => line.state)).toEqual(["active"]);

    push({
      type: "source",
      source: { id: "s1", name: "Source", url: null, retrievedAt: "" },
    });
    await flush();
    expect(activity().map((line) => line.state)).toEqual([
      "active",
      "succeeded",
    ]);

    push({ type: "finding", finding: FINDING });
    push({ type: "done" });
    await expect(outcome).resolves.toEqual({
      ok: true,
      findingTitle: "Test finding",
    });
  });

  it("streams sources and the finding as their own events, not activity", async () => {
    const { provider, push } = fakeProvider();
    const { events, hooks } = setup({ researchProvider: provider });

    const outcome = hooks.runResearch({ topic: "t", focalObjectId: OBJECT_A });
    push({
      type: "source",
      source: { id: "s1", name: "Source", url: null, retrievedAt: "" },
    });
    push({
      type: "failed_source",
      source: { id: "s2", name: "Other", url: null, retrievedAt: "" },
      reason: "unavailable",
    });
    push({ type: "finding", finding: FINDING });
    push({ type: "done" });
    await outcome;

    expect(events.map((event) => event.type)).toEqual([
      "research_source",
      "research_failed_source",
      "research_finding",
    ]);
  });

  it("reports failure honestly rather than a finding", async () => {
    const { provider, push } = fakeProvider();
    const { hooks } = setup({ researchProvider: provider });

    const outcome = hooks.runResearch({ topic: "t", focalObjectId: null });
    push({
      type: "failed",
      error: {
        code: "research_source_unavailable",
        userMessage: "unavailable",
        recoverable: true,
      },
    });
    await expect(outcome).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("steers the provider with direction taken between steps", async () => {
    const { provider, push, steerCalls } = fakeProvider();
    const onDirectionApplied = vi.fn();
    const { hooks } = setup({
      researchProvider: provider,
      takeDirection: async () => "Focus on England",
      onDirectionApplied,
    });

    const outcome = hooks.runResearch({ topic: "t", focalObjectId: OBJECT_A });
    push({ type: "step", step: "reviewing_sources" });
    await flush();
    expect(steerCalls).toEqual(["Focus on England"]);
    expect(onDirectionApplied).toHaveBeenCalledWith("Focus on England");

    push({ type: "finding", finding: FINDING });
    push({ type: "done" });
    await outcome;
  });

  it("stops the provider and resolves 'stopped' when the turn is aborted mid-run", async () => {
    const { provider, isStopped } = fakeProvider();
    const { hooks } = setup({ researchProvider: provider });
    const controller = new AbortController();

    const outcome = hooks.runResearch(
      { topic: "t", focalObjectId: OBJECT_A },
      controller.signal,
    );
    controller.abort();

    await expect(outcome).resolves.toEqual({ ok: false, reason: "stopped" });
    expect(isStopped()).toBe(true);
  });

  it("resolves 'stopped' immediately for an already-aborted signal", async () => {
    const { provider } = fakeProvider();
    const { hooks } = setup({ researchProvider: provider });
    const controller = new AbortController();
    controller.abort();

    await expect(
      hooks.runResearch(
        { topic: "t", focalObjectId: OBJECT_A },
        controller.signal,
      ),
    ).resolves.toEqual({ ok: false, reason: "stopped" });
  });
});

describe("addEvidence (T10)", () => {
  it("refuses when there is no active research to link", async () => {
    const { hooks } = setup({ activeFindingId: null });
    await expect(
      hooks.addEvidence({ consequenceSummary: "It supports X." }),
    ).resolves.toEqual({ ok: false, reason: "no_active_research" });
  });

  it("refuses when there is no focal object to link to", async () => {
    const { hooks } = setup({
      activeFindingId: "tenancy-deposit-disputes-2024",
      focalObjectId: null,
    });
    await expect(
      hooks.addEvidence({ consequenceSummary: "It supports X." }),
    ).resolves.toEqual({ ok: false, reason: "no_focal_object" });
  });

  it("refuses an id outside the closed finding catalogue", async () => {
    const { hooks } = setup({ activeFindingId: "not-a-real-finding" });
    await expect(
      hooks.addEvidence({ consequenceSummary: "It supports X." }),
    ).resolves.toEqual({ ok: false, reason: "no_active_research" });
  });

  it("writes through the port with the object and re-derived finding", async () => {
    const writeEvidence = vi.fn(async () => "linked" as const);
    const { hooks } = setup({
      activeFindingId: "tenancy-deposit-disputes-2024",
      focalObjectId: OBJECT_A,
      writeEvidence,
    });

    await expect(
      hooks.addEvidence({ consequenceSummary: "It supports X." }),
    ).resolves.toEqual({ ok: true, linked: true });
    expect(writeEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        objectId: OBJECT_A,
        consequenceSummary: "It supports X.",
        finding: expect.objectContaining({
          id: "tenancy-deposit-disputes-2024",
        }),
      }),
    );
  });

  it("reports an idempotent replay as linked:false, not a failure", async () => {
    const { hooks } = setup({
      activeFindingId: "tenancy-deposit-disputes-2024",
      focalObjectId: OBJECT_A,
      writeEvidence: vi.fn(async () => "already_linked" as const),
    });
    await expect(
      hooks.addEvidence({ consequenceSummary: "It supports X." }),
    ).resolves.toEqual({ ok: true, linked: false });
  });

  it("reports a write failure honestly", async () => {
    const { hooks } = setup({
      activeFindingId: "tenancy-deposit-disputes-2024",
      focalObjectId: OBJECT_A,
      writeEvidence: vi.fn(async () => "failed" as const),
    });
    await expect(
      hooks.addEvidence({ consequenceSummary: "It supports X." }),
    ).resolves.toEqual({ ok: false, reason: "failed" });
  });
});
