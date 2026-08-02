import { describe, expect, it, vi } from "vitest";
import type { ProjectScope } from "@/lib/canvas/scene";
import type {
  ResearchEvent,
  ResearchFinding,
  ResearchProvider,
  SteerOutcome,
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
    recordResearchFinding: vi.fn(async () => "receipt-1"),
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
function fakeProvider(steerReturns: SteerOutcome = "applied_now") {
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
      return steerReturns;
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
  it("emits research_started before the provider begins, superseding any earlier pass", async () => {
    const { provider, push } = fakeProvider();
    const { events, hooks } = setup({ researchProvider: provider });

    const outcome = hooks.runResearch({ topic: "t", focalObjectId: OBJECT_A });
    push({ type: "finding", finding: FINDING });
    push({ type: "done" });
    await outcome;

    expect(events[0]).toEqual({ type: "research_started" });
  });

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
      "research_started",
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

  it("never announces direction_applied when the provider says it requires a restart, and corrects the earlier promise", async () => {
    const { provider, push, steerCalls } = fakeProvider("requires_restart");
    const onDirectionApplied = vi.fn();
    const { events, hooks } = setup({
      researchProvider: provider,
      takeDirection: async () => "Please double-check with the tenant",
      onDirectionApplied,
    });

    const outcome = hooks.runResearch({ topic: "t", focalObjectId: OBJECT_A });
    push({ type: "step", step: "reviewing_sources" });
    await flush();
    expect(steerCalls).toEqual(["Please double-check with the tenant"]);
    expect(onDirectionApplied).not.toHaveBeenCalled();
    // The direction endpoint already told the user this would be applied
    // (T10 review round 2, P0-D) — silence would leave that standing.
    expect(events).toContainEqual({
      type: "direction_rejected",
      note: "Please double-check with the tenant",
      reason: expect.any(String),
    });

    push({ type: "finding", finding: FINDING });
    push({ type: "done" });
    await outcome;
  });

  it("defers announcing direction_applied until the step it genuinely affects", async () => {
    const { provider, push } = fakeProvider("applies_next_step");
    const onDirectionApplied = vi.fn();
    const { hooks } = setup({
      researchProvider: provider,
      takeDirection: async () => "Focus on newer sources",
      onDirectionApplied,
    });

    const outcome = hooks.runResearch({ topic: "t", focalObjectId: OBJECT_A });
    push({ type: "step", step: "reviewing_sources" });
    await flush();
    // Not yet true: the provider said this only takes effect next step.
    expect(onDirectionApplied).not.toHaveBeenCalled();

    push({ type: "step", step: "comparing_methods" });
    await flush();
    // Now genuinely at the step it affects.
    expect(onDirectionApplied).toHaveBeenCalledWith("Focus on newer sources");

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

describe("research receipts (T10 review round 2, P0-A)", () => {
  it("records the receipt with the pass's own focal object, unavailable sources and applied steering", async () => {
    const { provider, push } = fakeProvider();
    const recordResearchFinding = vi.fn(async () => "receipt-1");
    const { hooks } = setup({
      researchProvider: provider,
      takeDirection: async () => "Focus on England",
      recordResearchFinding,
    });

    const outcome = hooks.runResearch({ topic: "t", focalObjectId: OBJECT_A });
    push({ type: "step", step: "searching_sources" });
    await flush();
    push({
      type: "failed_source",
      source: { id: "s2", name: "Other", url: null, retrievedAt: "" },
      reason: "unavailable",
    });
    push({ type: "finding", finding: FINDING });
    push({ type: "done" });
    await outcome;

    expect(recordResearchFinding).toHaveBeenCalledWith({
      finding: FINDING,
      focalObjectId: OBJECT_A,
      unavailableSources: [
        {
          source: { id: "s2", name: "Other", url: null, retrievedAt: "" },
          reason: "unavailable",
        },
      ],
      appliedDirections: ["Focus on England"],
    });
  });
});

/** A `takeDirection` whose resolution the test controls, so it can be held
 *  open past the provider's own timing (T10 review round 3, P0-3). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("the event bridge does not outrun its own async step (T10 review round 3, P0-3)", () => {
  it("resolves a direction accepted at the final step even when finding/done arrive before takeDirection() does", async () => {
    const { provider, push, steerCalls } = fakeProvider("applies_next_step");
    const onDirectionApplied = vi.fn();
    const held = deferred<string | null>();
    const recordResearchFinding = vi.fn(async () => "receipt-1");
    const { events, hooks } = setup({
      researchProvider: provider,
      takeDirection: () => held.promise,
      onDirectionApplied,
      recordResearchFinding,
    });

    const outcome = hooks.runResearch({ topic: "t", focalObjectId: OBJECT_A });
    // The final step's boundary work starts — and stalls on takeDirection().
    push({ type: "step", step: "checking_source_context" });
    await flush();

    // The provider's own timing is not gated by that stalled read at all:
    // finding and done both arrive while it is still pending.
    push({ type: "finding", finding: FINDING });
    push({ type: "done" });
    await flush();
    // Nothing has settled yet — the boundary work the receipt depends on has
    // not resolved, so there is no finding to race ahead of.
    expect(recordResearchFinding).not.toHaveBeenCalled();

    // The read finally resolves, well after the pass conceptually ended.
    held.resolve("Focus on newer sources");

    await expect(outcome).resolves.toEqual({
      ok: true,
      findingTitle: "Test finding",
    });

    // The provider really was asked — this is not a direction silently
    // dropped — but it arrived with no next step left to apply it to.
    expect(steerCalls).toEqual(["Focus on newer sources"]);
    // Never falsely announced as applied: the provider's own outcome
    // (`applies_next_step`) never got a next step to become true at.
    expect(onDirectionApplied).not.toHaveBeenCalled();
    // The promise made when the direction was accepted is explicitly
    // corrected, not left to stand unfulfilled forever.
    expect(events).toContainEqual({
      type: "direction_rejected",
      note: "Focus on newer sources",
      reason: expect.any(String),
    });
    // The durable receipt reflects reality: this direction never took
    // effect, so it must not appear in what the receipt records as applied.
    expect(recordResearchFinding).toHaveBeenCalledWith(
      expect.objectContaining({ appliedDirections: [] }),
    );
  });

  it("still applies a direction honestly when a later step's read resolves out of order", async () => {
    // Two steps, each reading direction; the *first* read is held open
    // longer than the second one takes to resolve, so nothing but the
    // serialising queue keeps their effects from being interleaved.
    const { provider, push, steerCalls } = fakeProvider("applied_now");
    const onDirectionApplied = vi.fn();
    const first = deferred<string | null>();
    let call = 0;
    const { hooks } = setup({
      researchProvider: provider,
      takeDirection: () => {
        call += 1;
        return call === 1 ? first.promise : Promise.resolve("Second note");
      },
      onDirectionApplied,
    });

    const outcome = hooks.runResearch({ topic: "t", focalObjectId: OBJECT_A });
    push({ type: "step", step: "searching_sources" });
    await flush();
    push({ type: "step", step: "reviewing_sources" });
    await flush();
    // The second step's own boundary work has not been reached: the first
    // is still pending, and the queue has not moved past it.
    expect(steerCalls).toEqual([]);

    first.resolve("First note");
    await flush();

    push({ type: "finding", finding: FINDING });
    push({ type: "done" });
    await outcome;

    // Both directions were genuinely applied, in the order their own steps
    // actually happened — never interleaved or dropped.
    expect(steerCalls).toEqual(["First note", "Second note"]);
    expect(onDirectionApplied.mock.calls.map((call) => call[0])).toEqual([
      "First note",
      "Second note",
    ]);
  });
});

describe("addEvidence is staged, not a hook (T10 review round 2, P0-B)", () => {
  it("no longer exposes an addEvidence call on TurnHooks", () => {
    const { hooks } = setup();
    expect(
      (hooks as unknown as Record<string, unknown>).addEvidence,
    ).toBeUndefined();
  });
});
