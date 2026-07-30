import type { SupabaseClient } from "@supabase/supabase-js";
import type { StagedOperation } from "@/lib/ai/discovery-engine";
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
 * The engine derives operations; this module decides what happens to them.
 *
 * - Every candidate is re-parsed here. The engine already checked the shape to
 *   decide whether to retry, but that check is on the other side of the seam
 *   and cannot be relied on for safety.
 * - **The accepted set is applied in one database transaction**, through
 *   `apply_turn_operations`. Looping and writing one at a time is not what
 *   "one unit" means: field A could land and assumption B fail, leaving the
 *   project half-changed by a turn reported as failed.
 * - **Provenance is derived, never accepted, and it must be about the stored
 *   words.** See `verifiedQuotation` — it is not enough for a turn to attach
 *   *some* genuine phrase from the message to an invented value.
 * - **User-owned rows are protected under their own lock**, inside the same
 *   transaction, so a concurrent edit cannot race a pre-read.
 *
 * Applying is split by risk, as §6 requires. Field and assumption writes are
 * low-risk, reversible, origin-labelled additions that canonical documents call
 * for during a turn (VERTICAL_SLICE_SPEC Steps 2–3). Connected changes and
 * checkpoints are consequential and are not applied here at all.
 */

export type OperationOutcome =
  | { applied: true; kind: DiscoveryToolName; count: number }
  /** Understood, deliberately not applied at this stage of the build. */
  | { applied: false; kind: DiscoveryToolName; reason: "deferred" }
  /** Refused: malformed, not permitted, or it did not survive the write. */
  | {
      applied: false;
      kind: DiscoveryToolName;
      reason: "rejected";
      issue: string;
    };

export interface CommitResult {
  /** One outcome per staged operation, in the order they were staged. */
  outcomes: OperationOutcome[];
  /** True when project truth changed, so the canvas needs re-reading. */
  changed: boolean;
}

export interface OperationContext {
  projectId: string;
  turnId: string;
  /**
   * The message this turn is answering, exactly as the server received it.
   *
   * Provenance is checked against this rather than anything the model echoed
   * back — the only version of the text that cannot have been rewritten in
   * transit through the provider.
   */
  userMessage: string;
}

function normalise(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Decides whether stored content is genuinely the person's own words.
 *
 * The earlier version checked only that the excerpt appeared *somewhere* in the
 * message, which let a turn attach a real phrase to an invented value and have
 * the whole invented record marked `user_stated`. A quotation next to a claim is
 * not evidence for the claim.
 *
 * So two things must hold: the excerpt must really be in the message, **and**
 * the content being stored must be that excerpt — the same words, allowing only
 * for whitespace, case and trailing punctuation. Anything looser is an
 * interpretation, and an interpretation is `ai_inferred` however well sourced.
 *
 * Returns the verified excerpt, so the caller persists exactly what was checked
 * rather than whatever was submitted.
 */
export function verifiedQuotation(
  content: string,
  excerpt: string | undefined,
  userMessage: string,
): string | null {
  if (!excerpt) return null;
  const needle = normalise(excerpt);
  if (needle.length < 8) return null;
  if (!normalise(userMessage).includes(needle)) return null;

  // The stored words must be the quotation, not merely accompanied by it.
  const stored = normalise(content).replace(/[.,;:!?]+$/, "");
  if (stored !== needle.replace(/[.,;:!?]+$/, "")) return null;

  return excerpt.trim();
}

interface FieldRow {
  area: string;
  key: string;
  label: string;
  value: string;
  origin: "user_stated" | "ai_inferred";
  support: string;
  source_excerpt: string | null;
}

interface AssumptionRow {
  statement: string;
  why_it_matters: string;
  alternatives: string[];
  importance: string;
  origin: "user_stated" | "ai_inferred";
  source_excerpt: string | null;
}

/**
 * Validates every staged operation, then applies the accepted project-truth
 * writes in one transaction.
 *
 * Validation refuses individually — a malformed checkpoint should not stop a
 * valid field write — but the *writes* are all-or-none: if the transaction
 * raises, no field and no assumption is written, and every write outcome is
 * reported as refused rather than left ambiguous.
 */
export async function commitModelOperations(
  supabase: SupabaseClient,
  context: OperationContext,
  operations: readonly StagedOperation[],
): Promise<CommitResult> {
  const outcomes: OperationOutcome[] = [];
  const fields: FieldRow[] = [];
  const assumptions: AssumptionRow[] = [];
  /** Which outcome slots the transaction decides, so it can rewrite them. */
  const writeSlots: number[] = [];

  for (const operation of operations) {
    const tool = operation.name as DiscoveryToolName;
    switch (tool) {
      case "update_project_model": {
        const parsed = UpdateProjectModelSchema.safeParse(operation.candidate);
        if (!parsed.success) {
          outcomes.push(reject(tool, parsed.error.issues[0].message));
          break;
        }
        for (const update of parsed.data.updates) {
          const excerpt = verifiedQuotation(
            update.value,
            update.quotedFromMessage,
            context.userMessage,
          );
          fields.push({
            area: update.area,
            key: update.key,
            label: update.label,
            value: update.value,
            origin: excerpt ? "user_stated" : "ai_inferred",
            support: update.support,
            source_excerpt: excerpt,
          });
        }
        writeSlots.push(outcomes.length);
        outcomes.push({
          applied: true,
          kind: tool,
          count: parsed.data.updates.length,
        });
        break;
      }

      case "record_assumption": {
        const parsed = RecordAssumptionSchema.safeParse(operation.candidate);
        if (!parsed.success) {
          outcomes.push(reject(tool, parsed.error.issues[0].message));
          break;
        }
        const excerpt = verifiedQuotation(
          parsed.data.statement,
          parsed.data.quotedFromMessage,
          context.userMessage,
        );
        assumptions.push({
          statement: parsed.data.statement,
          why_it_matters: parsed.data.whyItMatters,
          alternatives: parsed.data.alternatives,
          importance: parsed.data.importance,
          origin: excerpt ? "user_stated" : "ai_inferred",
          source_excerpt: excerpt,
        });
        writeSlots.push(outcomes.length);
        outcomes.push({ applied: true, kind: tool, count: 1 });
        break;
      }

      case "propose_connected_change": {
        const parsed = ProposeConnectedChangeSchema.safeParse(
          operation.candidate,
        );
        outcomes.push(
          parsed.success
            ? { applied: false, kind: tool, reason: "deferred" }
            : reject(tool, parsed.error.issues[0].message),
        );
        break;
      }

      case "suggest_checkpoint": {
        const parsed = SuggestCheckpointSchema.safeParse(operation.candidate);
        outcomes.push(
          parsed.success
            ? { applied: false, kind: tool, reason: "deferred" }
            : reject(tool, parsed.error.issues[0].message),
        );
        break;
      }

      case "suggest_actions":
      case "recommend_canvas_scene":
        /*
          Neither reaches here. Scenes cross at `validateScene` and have no
          write path to project truth (§9.3); actions resolve to an
          application-owned catalogue and write nothing. Reaching this branch
          would mean those boundaries had been wired into this one.
        */
        outcomes.push(reject(tool, "wrong_boundary"));
        break;
    }
  }

  if (fields.length === 0 && assumptions.length === 0) {
    return { outcomes, changed: false };
  }

  const { error } = await supabase.rpc("apply_turn_operations", {
    p_project_id: context.projectId,
    p_turn_id: context.turnId,
    p_fields: fields,
    p_assumptions: assumptions,
  });

  if (error) {
    /*
      All-or-none: the transaction raised, so nothing was written. Every write
      outcome is rewritten as refused, because reporting one of them as applied
      would put a claim in the audit trail that the database does not support.
    */
    const issue = error.message?.includes("user_owned_field")
      ? "A field the person stated themselves cannot be replaced automatically."
      : (error.code ?? "write_failed");
    for (const slot of writeSlots) {
      outcomes[slot] = reject(outcomes[slot].kind, issue);
    }
    return { outcomes, changed: false };
  }

  return { outcomes, changed: true };
}

function reject(kind: DiscoveryToolName, issue: string): OperationOutcome {
  return { applied: false, kind, reason: "rejected", issue };
}
