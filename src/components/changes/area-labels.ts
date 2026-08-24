/**
 * Human labels for `project_area` values (T11), matching the wording
 * `private.document_title_for_slug` uses server-side for the same areas
 * under their document-slug names.
 */
export const AREA_LABELS: Record<string, string> = {
  problem: "Problem definition",
  customer: "Target customer",
  value_proposition: "Value proposition",
  mvp_scope: "MVP scope",
};

export function areaLabel(area: string): string {
  return AREA_LABELS[area] ?? area;
}
