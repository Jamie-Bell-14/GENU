import {
  AVAILABLE_SOURCES,
  UNAVAILABLE_SOURCE,
  buildTenancyDepositFinding,
} from "./findings";
import type {
  ResearchEvent,
  ResearchHandle,
  ResearchProvider,
  ResearchTask,
  SteerOutcome,
} from "./types";

/**
 * The slice's one research provider (docs/ARCHITECTURE.md §9,
 * docs/VERTICAL_SLICE_TASKS.md T10): a scripted, timed event sequence for the
 * tenancy-deposit scenario. It performs no retrieval of any kind — every
 * source and figure below is fictional and fixed — which is also why it needs
 * no allow-list, redirect check or timeout of its own (T10 security note:
 * "no external fetches at all in the slice").
 *
 * Steering is genuinely honoured, not merely acknowledged: a direction that
 * asks for official sources actually narrows what the finding is built from
 * (VERTICAL_SLICE_SPEC §4's "Focus on England and prioritise official
 * sources" example), so the "applied_now" the user is told is not a promise
 * the provider then ignores.
 */
export class MockResearchProvider implements ResearchProvider {
  constructor(private readonly stepDelayMs = 350) {}

  start(
    task: ResearchTask,
    onEvent: (event: ResearchEvent) => void,
  ): ResearchHandle {
    const id = crypto.randomUUID();
    const run: RunState = {
      officialOnly: false,
      findingEmitted: false,
      finished: false,
      stopped: false,
      timer: null,
    };
    runs.set(id, run);
    // The scripted scenario ignores `task.topic`: there is exactly one
    // finding in this catalogue, so nothing about the request text changes
    // what research produces (unlike `steer`, which does change the run).
    void execute(id, run, onEvent, this.stepDelayMs);
    return { id };
  }

  steer(handle: ResearchHandle, direction: string): SteerOutcome {
    const run = runs.get(handle.id);
    if (!run || run.finished) return "requires_restart";
    if (run.findingEmitted) return "applies_next_step";
    if (/england|official/i.test(direction)) {
      run.officialOnly = true;
    }
    return "applied_now";
  }

  stop(handle: ResearchHandle): void {
    const run = runs.get(handle.id);
    if (!run) return;
    run.stopped = true;
    if (run.timer) clearTimeout(run.timer);
  }
}

interface RunState {
  officialOnly: boolean;
  findingEmitted: boolean;
  finished: boolean;
  stopped: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Live runs, keyed by handle id, for the lifetime of the process that started
 * them. Nothing here is a database table (see the module doc in `types.ts`):
 * a run only ever lives as long as the single `runTurn` call driving it.
 */
const runs = new Map<string, RunState>();

function delay(run: RunState, ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    run.timer = setTimeout(resolve, ms);
  });
}

async function execute(
  id: string,
  run: RunState,
  onEvent: (event: ResearchEvent) => void,
  stepDelayMs: number,
): Promise<void> {
  const step = async (name: ResearchEvent & { type: "step" }) => {
    if (run.stopped) return false;
    onEvent(name);
    await delay(run, stepDelayMs);
    return !run.stopped;
  };

  try {
    if (!(await step({ type: "step", step: "searching_sources" }))) return;
    onEvent({
      type: "source",
      source: {
        ...AVAILABLE_SOURCES[0],
        retrievedAt: new Date().toISOString(),
      },
    });

    if (!(await step({ type: "step", step: "reviewing_sources" }))) return;
    if (!run.officialOnly) {
      onEvent({
        type: "source",
        source: {
          ...AVAILABLE_SOURCES[1],
          retrievedAt: new Date().toISOString(),
        },
      });
    }
    onEvent({
      type: "failed_source",
      source: { ...UNAVAILABLE_SOURCE, retrievedAt: new Date().toISOString() },
      reason: "This source could not be retrieved in the demonstration run.",
    });

    if (!(await step({ type: "step", step: "comparing_methods" }))) return;
    if (!(await step({ type: "step", step: "checking_source_context" })))
      return;

    const retrievedAt = new Date().toISOString();
    const finding = buildTenancyDepositFinding(retrievedAt);
    run.findingEmitted = true;
    onEvent({
      type: "finding",
      finding: run.officialOnly
        ? {
            ...finding,
            sources: finding.sources.filter(
              (source) => source.id === "demo-scheme-annual-report",
            ),
            keyFinding:
              "Focused on official sources only, as directed: the scheme's own annual report puts the dispute rate at 18% for agencies managing over 500 properties, against 12% for agencies managing under 100.",
            conflicting: false,
          }
        : finding,
    });

    if (run.stopped) return;
    run.finished = true;
    onEvent({ type: "done" });
  } finally {
    runs.delete(id);
  }
}
