import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectScope } from "./scene";

/**
 * The ids a scene is allowed to reference (docs/AI_SYSTEM.md §9.1).
 *
 * Read through the caller's user-scoped client so RLS decides membership: the
 * scope can never be wider than what this user could already read, which is
 * what makes "cross-project reference" impossible rather than merely checked.
 */
export async function loadProjectScope(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectScope> {
  const [objects, relationships] = await Promise.all([
    supabase
      .from("project_objects")
      .select("id")
      .eq("project_id", projectId)
      .limit(500),
    supabase
      .from("project_relationships")
      .select("id")
      .eq("project_id", projectId)
      .limit(1000),
  ]);

  return {
    objectIds: new Set(
      ((objects.data ?? []) as { id: string }[]).map((row) => row.id),
    ),
    relationshipIds: new Set(
      ((relationships.data ?? []) as { id: string }[]).map((row) => row.id),
    ),
  };
}
