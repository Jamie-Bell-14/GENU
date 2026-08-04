import { describe, expect, it } from "vitest";
import {
  ALL_SOURCES_UNAVAILABLE_TRIGGER,
  MockResearchProvider,
} from "./mock-research-provider";
import type { ResearchEvent } from "./types";

function collect(
  provider: MockResearchProvider,
  task = { topic: "t", focalObjectId: null },
) {
  const events: ResearchEvent[] = [];
  const done = new Promise<void>((resolve) => {
    provider.start(task, (event) => {
      events.push(event);
      if (event.type === "done" || event.type === "failed") resolve();
    });
  });
  return { events, done };
}

describe("MockResearchProvider", () => {
  it("produces the scripted step, source and finding sequence, ending in done", async () => {
    const provider = new MockResearchProvider(0);
    const { events, done } = collect(provider);
    await done;

    const types = events.map((event) => event.type);
    expect(types).toEqual([
      "step",
      "source",
      "step",
      "source",
      "failed_source",
      "step",
      "step",
      "finding",
      "done",
    ]);
  });

  it("marks one source unavailable every run (edge case)", async () => {
    const provider = new MockResearchProvider(0);
    const { events, done } = collect(provider);
    await done;

    const failed = events.find((event) => event.type === "failed_source");
    expect(failed).toBeDefined();
  });

  it("labels the finding as demonstration data with honest limitations", async () => {
    const provider = new MockResearchProvider(0);
    const { events, done } = collect(provider);
    await done;

    const finding = events.find((event) => event.type === "finding");
    expect(finding).toMatchObject({
      finding: { isDemo: true, conflicting: true },
    });
    if (finding?.type === "finding") {
      expect(finding.finding.limitations).toMatch(/demonstration data/i);
    }
  });

  it("genuinely narrows sources when steered towards official ones", async () => {
    const provider = new MockResearchProvider(0);
    const events: ResearchEvent[] = [];
    let handle: { id: string } | null = null;
    let steered = false;
    const done = new Promise<void>((resolve) => {
      const onEvent = (event: ResearchEvent) => {
        events.push(event);
        /*
          The very first "step" event fires synchronously, inside `start`,
          before it has returned and assigned `handle` here — steering on the
          second step is what a real caller (see turn-hooks.ts) would do too,
          and it is still well before the finding is produced.
        */
        if (event.type === "step" && !steered && handle) {
          steered = true;
          provider.steer(
            handle,
            "Focus on England and prioritise official sources.",
          );
        }
        if (event.type === "done" || event.type === "failed") resolve();
      };
      handle = provider.start({ topic: "t", focalObjectId: null }, onEvent);
    });
    await done;

    const finding = events.find((event) => event.type === "finding");
    if (finding?.type === "finding") {
      expect(finding.finding.conflicting).toBe(false);
      expect(finding.finding.sources).toHaveLength(1);
      expect(finding.finding.sources[0].id).toBe("demo-scheme-annual-report");
    } else {
      throw new Error("expected a finding event");
    }
  });

  it("reports applied_now for a direction taken before the finding, otherwise applies_next_step", async () => {
    const provider = new MockResearchProvider(0);
    const handle = provider.start(
      { topic: "t", focalObjectId: null },
      () => {},
    );
    expect(provider.steer(handle, "Focus on England")).toBe("applied_now");
  });

  it("reports requires_restart once the run has finished", async () => {
    const provider = new MockResearchProvider(0);
    const { done, events } = collect(provider);
    const handle = provider.start(
      { topic: "t", focalObjectId: null },
      (event) => events.push(event),
    );
    await done;
    expect(provider.steer(handle, "Anything")).toBe("requires_restart");
  });

  it("reports requires_restart for a direction it cannot interpret, rather than a false applied_now", () => {
    const provider = new MockResearchProvider(0);
    const handle = provider.start(
      { topic: "t", focalObjectId: null },
      () => {},
    );
    expect(provider.steer(handle, "Please double-check with the tenant")).toBe(
      "requires_restart",
    );
  });

  it("fails closed with no finding when every source is unavailable (edge case)", async () => {
    const provider = new MockResearchProvider(0);
    const { events, done } = collect(provider, {
      topic: `Research this (${ALL_SOURCES_UNAVAILABLE_TRIGGER})`,
      focalObjectId: null,
    });
    await done;

    expect(events.some((event) => event.type === "finding")).toBe(false);
    expect(events.some((event) => event.type === "failed_source")).toBe(true);
    const failed = events.find((event) => event.type === "failed");
    expect(failed).toMatchObject({
      error: { code: "research_source_unavailable" },
    });
  });

  it("stops mid-research and never emits a finding or done afterwards", async () => {
    const provider = new MockResearchProvider(5);
    const events: ResearchEvent[] = [];
    const handle = provider.start(
      { topic: "t", focalObjectId: null },
      (event) => events.push(event),
    );
    provider.stop(handle);
    // Give any already-scheduled timer a chance to fire, if it incorrectly would.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(events.some((event) => event.type === "finding")).toBe(false);
    expect(events.some((event) => event.type === "done")).toBe(false);
  });
});
