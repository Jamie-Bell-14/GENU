import type { ActivityKind } from "./turn-events";

/**
 * The closed catalogue of activity the application can report.
 *
 * Activity labels describe real orchestration steps and are written here, in
 * application code, rather than anywhere a model could reach
 * (docs/ARCHITECTURE.md §8, docs/UI_ACCEPTANCE_CRITERIA.md §7). An engine names
 * a step; it never supplies the words. The database stores the step, not the
 * words, so the vocabulary is closed at the storage boundary too.
 *
 * Every step has three labels because an operation has three honest outcomes:
 * it is running, it achieved what it set out to do, or it did not. A single
 * "complete" label would claim success for work that failed, which is the
 * false-certainty problem in miniature. Labels state the operation, not a
 * feeling about it: no "Thinking deeply…", no percentages (DESIGN.md §9.2).
 *
 * There is deliberately no step for saving the user's message. That write has
 * to complete before the stream opens, so it could only ever be narrated after
 * the fact — and a label for finished work is scripted theatre, not activity.
 */
export const ACTIVITY_STEPS = {
  reading_project_model: {
    kind: "analysis",
    active: "Reading the current project model…",
    succeeded: "Project model read",
    // Covers a failed read and a partial one: either way the model in hand is
    // not the whole project, and the canvas view built from it is narrower.
    failed: "The project model could not be read in full",
  },
  considering_direction: {
    kind: "analysis",
    active: "Taking your direction into account…",
    succeeded: "Your direction is taken into account",
    failed: "Your direction was not applied",
  },
  preparing_canvas_view: {
    kind: "model_update",
    active: "Preparing a canvas view of the current problem…",
    succeeded: "Canvas view prepared",
    failed: "No canvas view could be prepared",
  },
  /*
    The four research steps below give MockResearchProvider's scripted
    tenancy-deposit run (T10) the same closed, application-owned vocabulary as
    every other step — the mock provider is application code, not a model, but
    its narration is still fixed text keyed by step, never free text it
    composes. Wording matches DESIGN.md §9.2's activity examples exactly,
    since that section's example scenario is this same tenancy-deposit
    research.
  */
  searching_sources: {
    kind: "research",
    active: "Searching GOV.UK tenancy-deposit data…",
    succeeded: "GOV.UK tenancy-deposit data searched",
    failed: "GOV.UK tenancy-deposit data could not be searched",
  },
  reviewing_sources: {
    kind: "research",
    active: "Reviewing scheme annual reports…",
    succeeded: "Scheme annual reports reviewed",
    failed: "Scheme annual reports could not be reviewed",
  },
  comparing_methods: {
    kind: "research",
    active: "Comparing reporting methodologies…",
    succeeded: "Reporting methodologies compared",
    failed: "Reporting methodologies could not be compared",
  },
  checking_source_context: {
    kind: "research",
    active: "Found a relevant figure — checking source context…",
    succeeded: "Source context checked",
    failed: "Source context could not be confirmed",
  },
} as const satisfies Record<
  string,
  { kind: ActivityKind; active: string; succeeded: string; failed: string }
>;

export type ActivityStep = keyof typeof ACTIVITY_STEPS;

/** Where an operation is: running, or finished one way or the other. */
export type ActivityState = "active" | "succeeded" | "failed";

export const ACTIVITY_STEP_NAMES = Object.keys(
  ACTIVITY_STEPS,
) as ActivityStep[];

export function isActivityStep(value: string): value is ActivityStep {
  return Object.hasOwn(ACTIVITY_STEPS, value);
}

export function activityLabel(
  step: ActivityStep,
  state: ActivityState,
): string {
  return ACTIVITY_STEPS[step][state];
}
