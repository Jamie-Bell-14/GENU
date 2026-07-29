import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadCanvasObjects,
  loadProjectRelationships,
} from "./project-model-store";
import { defaultFocalObjectId } from "./problem-map";
import type { ProjectScope } from "./scene";

const OBJECT_LIMIT = 500;
const RELATIONSHIP_LIMIT = 1000;

export interface TurnScope {
  scope: ProjectScope;
  /** Deterministically ordered, for anything that needs a stable sequence. */
  objectIds: string[];
  /**
   * The object this project is currently exploring, derived from the stored
   * model — not "whatever the database returned first". An engine may name it;
   * it may not decide what focus means.
   */
  focalObjectId: string | null;
  /**
   * True when a query hit its limit, so the scope may be narrower than the
   * project. Reported by the caller rather than swallowed: an incomplete scope
   * fails closed (a legitimate scene can be rejected), and silently treating it
   * as the whole project would hide that.
   */
  truncated: boolean;
  /** The read itself failed. Distinct from a project that is simply empty. */
  failed: boolean;
}

/** A scope that is both complete and error-free — the only honest "read". */
export function scopeIsWhole(scope: TurnScope): boolean {
  return !scope.truncated && !scope.failed;
}

/**
 * The ids a scene is allowed to reference, plus the project's current focus
 * (docs/AI_SYSTEM.md §9.1).
 *
 * Read through the caller's user-scoped client so RLS decides membership: the
 * scope can never be wider than what this user could already read, which is
 * what makes "cross-project reference" impossible rather than merely checked.
 */
export async function loadTurnScope(
  supabase: SupabaseClient,
  projectId: string,
): Promise<TurnScope> {
  const [objects, relationships, canvasObjects, canvasRelationships] =
    await Promise.all([
      supabase
        .from("project_objects")
        .select("id")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .limit(OBJECT_LIMIT),
      supabase
        .from("project_relationships")
        .select("id")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .limit(RELATIONSHIP_LIMIT),
      loadCanvasObjects(supabase, projectId),
      loadProjectRelationships(supabase, projectId),
    ]);

  const objectRows = (objects.data ?? []) as { id: string }[];
  const relationshipRows = (relationships.data ?? []) as { id: string }[];
  const objectIds = objectRows.map((row) => row.id);

  return {
    scope: {
      objectIds: new Set(objectIds),
      relationshipIds: new Set(relationshipRows.map((row) => row.id)),
    },
    objectIds,
    focalObjectId: defaultFocalObjectId(canvasObjects, canvasRelationships),
    truncated:
      objectRows.length >= OBJECT_LIMIT ||
      relationshipRows.length >= RELATIONSHIP_LIMIT,
    failed: Boolean(objects.error) || Boolean(relationships.error),
  };
}
