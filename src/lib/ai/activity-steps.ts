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
 * Every step has two labels because activity has a lifecycle: a step is
 * reported when it starts and again when it finishes, and a finished operation
 * must not read as still running. Labels state the operation, not a feeling
 * about it: no "Thinking deeply…", no percentages (DESIGN.md §9.2).
 *
 * There is deliberately no step for saving the user's message. That write has
 * to complete before the stream opens, so it could only ever be narrated after
 * the fact — and a label for finished work is scripted theatre, not activity.
 */
export const ACTIVITY_STEPS = {
  reading_project_model: {
    kind: "analysis",
    active: "Reading the current project model…",
    complete: "Project model read",
  },
  considering_direction: {
    kind: "analysis",
    active: "Taking your direction into account…",
    complete: "Your direction is taken into account",
  },
  preparing_canvas_view: {
    kind: "model_update",
    active: "Preparing a canvas view of the current problem…",
    complete: "Canvas view prepared",
  },
} as const satisfies Record<
  string,
  { kind: ActivityKind; active: string; complete: string }
>;

export type ActivityStep = keyof typeof ACTIVITY_STEPS;
export type ActivityState = "active" | "complete";

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
