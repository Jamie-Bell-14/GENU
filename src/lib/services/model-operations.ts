import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RecordAssumptionSchema,
  UpdateProjectModelSchema,
  ProposeConnectedChangeSchema,
  SuggestCheckpointSchema,
  type DiscoveryToolName,
} from "@/lib/ai/tools/discovery-tools";

/**
 * Where a model-proposed operation is authorised and disposed of
 * (docs/AI_SYSTEM.md §5, §6, §10).
 *
 * The engine derives operations; this module decides what happens to them. Two
 * things make that a real boundary rather than a naming convention:
 *
 * - Every candidate is re-parsed here. The engine already checked the shape to
 *   decide whether to retry, but that check is on the other side of the seam
 *   and cannot be relied on for safety. This parse is the one that gates a
 *   write.
 * - Writes go through the **user-scoped** client, not the trusted writer. RLS
 *   therefore evaluates every row against the signed-in owner, so a proposal
 *   naming another project's row fails at the database even if every check
 *   above it were wrong. The trusted writer's elevated key is for history that
 *   the owner must not be able to forge; project truth is not that.
 *
 * Applying is split by risk, exactly as §6 requires. Field and assumption
 * writes are low-risk, reversible, origin-labelled additions that canonical
 * documents call for during a turn (VERTICAL_SLICE_SPEC Steps 2–3: "the canvas
 * creates a sparse initial model", "the assumption appears on the canvas").
 * Connected changes and checkpoints are consequential and are *not* applied
 * here at all — they are recorded as having been proposed, and T11 and T12
 * build the approval machinery that acts on them.
 */

export type OperationOutcome =
  | { applied: true; kind: DiscoveryToolName; count: number }
  /** Understood, deliberately not applied at this stage of the build. */
  | { applied: false; kind: DiscoveryToolName; reason: "deferred" }
  /** Refused: malformed, or it did not survive the write. */
  | {
      applied: false;
      kind: DiscoveryToolName;
      reason: "rejected";
      issue: string;
    };

export async function applyModelOperation(
  supabase: SupabaseClient,
  projectId: string,
  tool: DiscoveryToolName,
  candidate: unknown,
): Promise<OperationOutcome> {
  switch (tool) {
    case "update_project_model": {
      const parsed = UpdateProjectModelSchema.safeParse(candidate);
      if (!parsed.success) {
        return reject(tool, parsed.error.issues[0].message);
      }
      /*
        `project_id` is taken from the authorised route parameter and never
        from the candidate — the schema has no such field, and this is where
        that matters. A conflict on (project_id, area, key) updates in place,
        so a turn revising its own earlier reading does not accumulate
        duplicates.
      */
      const rows = parsed.data.updates.map((update) => ({
        project_id: projectId,
        area: update.area,
        key: update.key,
        label: update.label,
        value: update.value,
        origin: update.origin,
        support: update.support,
      }));
      const { error } = await supabase
        .from("project_fields")
        .upsert(rows, { onConflict: "project_id,area,key" });
      if (error) return reject(tool, error.code ?? "write_failed");
      return { applied: true, kind: tool, count: rows.length };
    }

    case "record_assumption": {
      const parsed = RecordAssumptionSchema.safeParse(candidate);
      if (!parsed.success) {
        return reject(tool, parsed.error.issues[0].message);
      }
      const { error } = await supabase.from("assumptions").insert({
        project_id: projectId,
        statement: parsed.data.statement,
        why_it_matters: parsed.data.whyItMatters,
        alternatives: parsed.data.alternatives,
        importance: parsed.data.importance,
        origin: parsed.data.origin,
      });
      if (error) return reject(tool, error.code ?? "write_failed");
      return { applied: true, kind: tool, count: 1 };
    }

    case "propose_connected_change": {
      // Validated so a malformed proposal is still refused rather than
      // silently ignored, then deferred: applying a connected change requires
      // the approval state machine and transactional apply that land in T11.
      const parsed = ProposeConnectedChangeSchema.safeParse(candidate);
      if (!parsed.success) {
        return reject(tool, parsed.error.issues[0].message);
      }
      return { applied: false, kind: tool, reason: "deferred" };
    }

    case "suggest_checkpoint": {
      const parsed = SuggestCheckpointSchema.safeParse(candidate);
      if (!parsed.success) {
        return reject(tool, parsed.error.issues[0].message);
      }
      return { applied: false, kind: tool, reason: "deferred" };
    }

    case "recommend_canvas_scene":
      /*
        Scenes never reach here. They cross at `validateScene`, which checks
        them against the project's own ids, and they have no write path to
        project truth at all (docs/AI_SYSTEM.md §9.3). Reaching this branch
        would mean the two boundaries had been wired together.
      */
      return reject(tool, "scene_wrong_boundary");
  }
}

function reject(kind: DiscoveryToolName, issue: string): OperationOutcome {
  return { applied: false, kind, reason: "rejected", issue };
}
