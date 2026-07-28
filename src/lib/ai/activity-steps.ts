import type { ActivityKind } from "./turn-events";

/**
 * The closed catalogue of activity the application can report.
 *
 * Activity labels describe real orchestration steps and are written here, in
 * application code, rather than anywhere a model could reach
 * (docs/ARCHITECTURE.md §8, docs/UI_ACCEPTANCE_CRITERIA.md §7). An engine names
 * a step; it never supplies the words. Adding a label therefore means adding a
 * step the system genuinely performs.
 *
 * Labels state the operation, not a feeling about it: no "Thinking deeply…",
 * no percentages (DESIGN.md §9.2).
 */
export const ACTIVITY_STEPS = {
  recording_message: {
    kind: "analysis",
    label: "Recording your message…",
  },
  reading_project_model: {
    kind: "analysis",
    label: "Reading the current project model…",
  },
  considering_direction: {
    kind: "analysis",
    label: "Taking your direction into account…",
  },
  preparing_canvas_view: {
    kind: "model_update",
    label: "Preparing a canvas view of the current problem…",
  },
} as const satisfies Record<string, { kind: ActivityKind; label: string }>;

export type ActivityStep = keyof typeof ACTIVITY_STEPS;

export function isActivityStep(value: string): value is ActivityStep {
  return Object.hasOwn(ACTIVITY_STEPS, value);
}
