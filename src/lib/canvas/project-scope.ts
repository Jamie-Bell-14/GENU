import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadCanvasObjects,
  loadProjectRelationships,
} from "./project-model-store";
import type { CanvasObject } from "./model";
import { defaultFocalObjectId } from "./problem-map";
import type { ProjectScope } from "./scene";

const OBJECT_LIMIT = 500;
const RELATIONSHIP_LIMIT = 1000;

export interface TurnScope {
  scope: ProjectScope;
  /** Deterministically ordered, for anything that needs a stable sequence. */
  objectIds: string[];
  /** Ordered relationship ids, for the same reason. */
  relationshipIds: string[];
  /**
   * The objects behind those ids, so a caller building an inventory for the
   * model does not have to read them a second time. Ids alone are not enough to
   * choose between objects: a model handed only UUIDs can pick a focal object
   * only at random.
   */
  objects: CanvasObject[];
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
    relationshipIds: relationshipRows.map((row) => row.id),
    objects: canvasObjects.data,
    focalObjectId: defaultFocalObjectId(
      canvasObjects.data,
      canvasRelationships.data,
    ),
    truncated:
      objectRows.length >= OBJECT_LIMIT ||
      relationshipRows.length >= RELATIONSHIP_LIMIT,
    /*
      Every query that takes part in this read counts. The identity queries
      define the scope; the field, assumption and relationship reads define
      what the project is exploring. If any of them failed, the model in hand
      is not the project's model, whatever the other queries returned.
    */
    failed:
      Boolean(objects.error) ||
      Boolean(relationships.error) ||
      canvasObjects.failed ||
      canvasRelationships.failed,
  };
}
