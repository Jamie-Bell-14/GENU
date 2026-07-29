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
 * The engine derives operations; this module decides what happens to them. Four
 * things make that a real boundary rather than a naming convention:
 *
 * - Every candidate is re-parsed here. The engine already checked the shape to
 *   decide whether to retry, but that check is on the other side of the seam
 *   and cannot be relied on for safety. This parse is the one that gates a
 *   write.
 * - Writes go through the **user-scoped** client, not the trusted writer. RLS
 *   therefore evaluates every row against the signed-in owner, so a proposal
 *   naming another project's row fails at the database even if every check
 *   above it were wrong.
 * - **Provenance is derived, never accepted.** The model cannot say a field is
 *   `user_stated`; it can only offer an excerpt it claims came from the message,
 *   which is verified against the message the server actually received. An
 *   unverifiable excerpt does not fail the operation — it just means the field
 *   is recorded as inference, which is what it is.
 * - **User-owned meaning is protected.** An automatic AI update may create a
 *   row or revise one the AI already owns. Changing the value of a field the
 *   person stated themselves is a consequential change and is refused here; it
 *   needs the approval path, not a turn.
 *
 * Applying is split by risk, exactly as §6 requires. Field and assumption
 * writes are low-risk, reversible, origin-labelled additions that canonical
 * documents call for during a turn (VERTICAL_SLICE_SPEC Steps 2–3). Connected
 * changes and checkpoints are consequential and are *not* applied here at all.
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

/** What the turn produced, and what became of each part of it. */
export interface CommitResult {
  outcomes: OperationOutcome[];
}

export interface OperationContext {
  projectId: string;
  /**
   * The message this turn is answering, exactly as the server received it.
   *
   * Provenance is checked against this rather than against anything the model
   * echoed back, which is the only version of the text that cannot have been
   * rewritten in transit through the provider.
   */
  userMessage: string;
}

/**
 * Applies everything a successful turn staged.
 *
 * Sequential rather than parallel, so an earlier refusal is visible in the
 * record before a later write happens, and every outcome is returned for the
 * caller to audit — including the refusals, which are the ones worth having.
 */
export async function commitModelOperations(
  supabase: SupabaseClient,
  context: OperationContext,
  operations: readonly StagedOperation[],
): Promise<CommitResult> {
  const outcomes: OperationOutcome[] = [];
  for (const operation of operations) {
    outcomes.push(
      await applyModelOperation(
        supabase,
        context,
        operation.name as DiscoveryToolName,
        operation.candidate,
      ),
    );
  }
  return { outcomes };
}

/**
 * Decides whether an excerpt the model attributed to the person is really
 * theirs.
 *
 * Comparison is whitespace-normalised and case-insensitive, because the model
 * reproducing a sentence with different line breaks is still a quotation, while
 * a paraphrase is not. Anything that is not literally present in the message
 * fails — which is the point: this is the check that turns an untrusted claim
 * into application-derived provenance.
 */
export function quoteIsFromMessage(
  excerpt: string | undefined,
  userMessage: string,
): boolean {
  if (!excerpt) return false;
  const normalise = (value: string) =>
    value.replace(/\s+/g, " ").trim().toLowerCase();
  const needle = normalise(excerpt);
  if (needle.length < 8) return false;
  return normalise(userMessage).includes(needle);
}

export async function applyModelOperation(
  supabase: SupabaseClient,
  context: OperationContext,
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
        Read what is already there before writing over it. An upsert that
        supplies `value`, `origin` and `support` unconditionally will happily
        replace a field the person wrote and marked as their own — losing both
        their wording and its provenance, with no approval and no record of
        what it displaced.
      */
      const keys = parsed.data.updates.map((update) => update.key);
      const { data: existingRows, error: readError } = await supabase
        .from("project_fields")
        .select("area, key, origin, value")
        .eq("project_id", context.projectId)
        .in("key", keys);
      if (readError) return reject(tool, readError.code ?? "read_failed");

      const existing = new Map(
        (
          (existingRows ?? []) as {
            area: string;
            key: string;
            origin: string;
            value: string;
          }[]
        ).map((row) => [`${row.area}/${row.key}`, row]),
      );

      const rows: Record<string, unknown>[] = [];
      for (const update of parsed.data.updates) {
        const current = existing.get(`${update.area}/${update.key}`);
        if (
          current &&
          current.origin === "user_stated" &&
          current.value !== update.value
        ) {
          return reject(
            tool,
            `${update.area}/${update.key} is the person's own wording and cannot be replaced automatically.`,
          );
        }
        rows.push({
          project_id: context.projectId,
          area: update.area,
          key: update.key,
          label: update.label,
          value: update.value,
          // Derived here, from a verified excerpt — never taken from the enum
          // the model supplied.
          origin: quoteIsFromMessage(
            update.quotedFromMessage,
            context.userMessage,
          )
            ? "user_stated"
            : "ai_inferred",
          support: update.support,
        });
      }

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
        project_id: context.projectId,
        statement: parsed.data.statement,
        why_it_matters: parsed.data.whyItMatters,
        alternatives: parsed.data.alternatives,
        importance: parsed.data.importance,
        origin: quoteIsFromMessage(
          parsed.data.quotedFromMessage,
          context.userMessage,
        )
          ? "user_stated"
          : "ai_inferred",
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

    case "suggest_actions":
    case "recommend_canvas_scene":
      /*
        Neither reaches here. Scenes cross at `validateScene` and have no write
        path to project truth (docs/AI_SYSTEM.md §9.3); actions resolve to an
        application-owned catalogue and write nothing at all. Reaching this
        branch would mean those boundaries had been wired into this one.
      */
      return reject(tool, "wrong_boundary");
  }
}

function reject(kind: DiscoveryToolName, issue: string): OperationOutcome {
  return { applied: false, kind, reason: "rejected", issue };
}
