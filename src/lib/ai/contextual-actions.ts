import type { ContextualAction } from "./turn-events";

/**
 * The closed catalogue of contextual actions a turn may offer
 * (VERTICAL_SLICE_SPEC Step 3, DESIGN.md §8.3).
 *
 * Same rule as activity labels: the model names an action, the application
 * supplies the words. A tool that accepted `{label: string}` would let a turn
 * put arbitrary text on a button the user is invited to press — and a button is
 * a promise about what the product will do, which is not the model's to make.
 *
 * An action lives here only when pressing it does something. `research_this`
 * and `compare_segments` are in the spec's suggested list but their flows land
 * in T10 and T11, so they are absent rather than offered as dead controls.
 */
export const ACTION_CATALOGUE = {
  explain_reasoning: {
    label: "Explain my reasoning",
    hint: "Show the evidence, assumptions and alternatives behind this.",
  },
  challenge_this: {
    label: "Challenge this",
    hint: "Argue the other side of the current conclusion.",
  },
  record_assumption: {
    label: "Record this as an assumption",
    hint: "Keep it on the canvas with its status visible.",
  },
} as const satisfies Record<string, { label: string; hint: string }>;

export type ActionId = keyof typeof ACTION_CATALOGUE;

export const ACTION_IDS = Object.keys(ACTION_CATALOGUE) as ActionId[];

export function isActionId(value: string): value is ActionId {
  return Object.hasOwn(ACTION_CATALOGUE, value);
}

/** The interface never shows more than three (DESIGN.md §8.3). */
export const MAX_CONTEXTUAL_ACTIONS = 3;

/**
 * Turns proposed action ids into actions, dropping anything unrecognised.
 *
 * Slicing happens here rather than in the reducer so the cap is enforced at the
 * boundary the proposal crosses, not merely honoured by whatever renders it.
 * Duplicates collapse: the same action twice is one action, and two identical
 * buttons would read as two different things.
 */
export function resolveActions(ids: readonly string[]): ContextualAction[] {
  const seen = new Set<ActionId>();
  const actions: ContextualAction[] = [];
  for (const id of ids) {
    if (!isActionId(id) || seen.has(id)) continue;
    seen.add(id);
    actions.push({ id, ...ACTION_CATALOGUE[id] });
    if (actions.length === MAX_CONTEXTUAL_ACTIONS) break;
  }
  return actions;
}
