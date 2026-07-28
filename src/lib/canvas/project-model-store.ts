import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanvasObject, Origin, SupportState } from "./model";
import type { ProjectRelationship, RelationshipType } from "./relationships";

interface FieldRow {
  id: string;
  area: string;
  label: string;
  value: string;
  origin: Origin;
  support: SupportState;
  updated_at: string;
}

interface AssumptionRow {
  id: string;
  statement: string;
  why_it_matters: string | null;
  status: string;
  origin: Origin;
}

const ASSUMPTION_SUPPORT: Record<string, SupportState> = {
  open: "hypothesis",
  supported: "some_evidence",
  weakened: "hypothesis",
  invalidated: "contradicted",
};

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB");
}

/**
 * Reads the project model and maps it into canvas objects. All access runs
 * through the caller's user-scoped client, so RLS applies underneath the
 * route's own ownership check (defence in depth).
 */
export async function loadCanvasObjects(
  supabase: SupabaseClient,
  projectId: string,
): Promise<CanvasObject[]> {
  const [fields, assumptions] = await Promise.all([
    supabase
      .from("project_fields")
      .select("id, area, label, value, origin, support, updated_at")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: true })
      .limit(100),
    supabase
      .from("assumptions")
      .select("id, statement, why_it_matters, status, origin")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .limit(50),
  ]);

  const objects: CanvasObject[] = [];

  for (const row of (fields.data ?? []) as FieldRow[]) {
    objects.push({
      id: row.id,
      kind: row.area === "problem" ? "concept" : "document",
      zone: row.area === "problem" ? "subject" : "outline",
      title: row.label,
      detail: row.value,
      origin: row.origin,
      support: row.support,
      meta: shortDate(row.updated_at),
    });
  }

  for (const row of (assumptions.data ?? []) as AssumptionRow[]) {
    objects.push({
      id: row.id,
      kind: "assumption",
      zone: "assumptions",
      title: row.statement,
      detail: row.why_it_matters ?? undefined,
      origin: row.origin,
      support: ASSUMPTION_SUPPORT[row.status] ?? "hypothesis",
    });
  }

  return objects;
}

interface RelationshipRow {
  id: string;
  from_object_id: string;
  to_object_id: string;
  relation: RelationshipType;
  origin: Origin;
  support: SupportState;
  note: string | null;
}

/**
 * Loads stored relationships for a project. Renderers display only what this
 * returns — a relationship that is not stored is never drawn
 * (docs/AI_SYSTEM.md §9.2). RLS scopes the query to the caller's project.
 */
export async function loadProjectRelationships(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectRelationship[]> {
  const { data } = await supabase
    .from("project_relationships")
    .select("id, from_object_id, to_object_id, relation, origin, support, note")
    .eq("project_id", projectId)
    .limit(200);

  return ((data ?? []) as RelationshipRow[]).map((row) => ({
    id: row.id,
    fromObjectId: row.from_object_id,
    toObjectId: row.to_object_id,
    relation: row.relation,
    origin: row.origin,
    support: row.support,
    note: row.note ?? undefined,
  }));
}
