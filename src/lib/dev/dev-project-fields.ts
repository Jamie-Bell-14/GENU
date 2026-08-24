/**
 * In-memory `project_fields` stand-in for the development-only workspace
 * (T11 review round 2, P1: "extend the deterministic harness so
 * approval/undo changes a dev project-model snapshot").
 *
 * The demo canvas (`demo-project.ts`) is a fixed, hand-authored model with no
 * `project_fields` rows behind it at all, so a dev-mode connected-change
 * proposal previously had nothing real to write to and nothing for the
 * canvas to visibly show once decided — the outcome banner could say
 * "Approved" while the project underneath never actually changed. This store
 * gives the dev decide routes a real, mutable target: `apply_change_proposal`
 * upserts (value/origin/support all overwritten) and `undo_change_proposal`
 * restores (value/origin/support all reverted) against `project_fields`
 * directly; `decideDevProposal`/`undoDevProposal` in `pending-proposals.ts`
 * do the same thing here.
 *
 * Acceptable only here, for the same reason `pending-directions.ts` and
 * `pending-proposals.ts` are: the routes using it return 404 in production,
 * and nothing outside `/api/dev/*` imports this file.
 */

export type DevFieldOrigin = "user_stated" | "ai_inferred" | "researched";

export type DevFieldSupport =
  | "unexplored"
  | "hypothesis"
  | "some_evidence"
  | "credible"
  | "strongly_evidenced"
  | "contradicted";

export interface DevFieldObject {
  id: string;
  area: string;
  key: string;
  label: string;
  value: string;
  origin: DevFieldOrigin;
  support: DevFieldSupport;
  updatedAt: string;
}

const fields = new Map<string, DevFieldObject>();

function fieldKey(area: string, key: string): string {
  return `${area}:${key}`;
}

export function getDevField(area: string, key: string): DevFieldObject | null {
  return fields.get(fieldKey(area, key)) ?? null;
}

export function listDevFields(): DevFieldObject[] {
  return Array.from(fields.values());
}

export function upsertDevField(input: {
  area: string;
  key: string;
  label?: string;
  value: string;
  origin: DevFieldOrigin;
  support: DevFieldSupport;
}): DevFieldObject {
  const existing = getDevField(input.area, input.key);
  const field: DevFieldObject = {
    id: existing?.id ?? crypto.randomUUID(),
    area: input.area,
    key: input.key,
    label: input.label ?? existing?.label ?? input.key,
    value: input.value,
    origin: input.origin,
    support: input.support,
    updatedAt: new Date().toISOString(),
  };
  fields.set(fieldKey(input.area, input.key), field);
  return field;
}

export function deleteDevField(area: string, key: string): void {
  fields.delete(fieldKey(area, key));
}

/** Test seam: the module holds process state, so tests must be able to reset. */
export function resetDevFields(): void {
  fields.clear();
}
