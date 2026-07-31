import type { StagedOperation } from "@/lib/ai/discovery-engine";
import {
  AddEvidenceSchema,
  RecordAssumptionSchema,
  UpdateProjectModelSchema,
  ProposeConnectedChangeSchema,
  SuggestCheckpointSchema,
  type DiscoveryToolName,
} from "@/lib/ai/tools/discovery-tools";
import type { CompleteTurnRecord } from "./trusted-writer";

/**
 * Where a model-proposed operation is authorised and disposed of
 * (docs/AI_SYSTEM.md §5, §6, §10).
 *
 * The engine derives operations; this module decides what happens to them.
 *
 * - Every candidate is re-parsed here. The engine already checked the shape to
 *   decide whether to retry, but that check is on the other side of the seam
 *   and cannot be relied on for safety.
 * - **The accepted set, the assistant answer and the turn's terminal state are
 *   applied in one transaction**, through the `complete_turn` port. Separate
 *   writes — even correctly ordered ones — can leave a stored answer whose
 *   project changes were lost, and catch-up treats a stored answer as
 *   settlement.
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
  | {
      applied: true;
      kind: DiscoveryToolName;
      /** Rows the database actually wrote. */
      count: number;
      /** Rows it refused, when part of the operation was not permitted. */
      refused?: number;
    }
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
  /** How the single durable operation ended. */
  outcome: "completed" | "not_running" | "unavailable";
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
  /**
   * The research receipt this turn's client says it is looking at, if any
   * (T10 review round 1, P0-1) — an opaque reference into
   * `research_findings`, never trusted content: `complete_turn` re-reads the
   * actual result, and the object it was researched from, from that table by
   * this id. The model never supplies this; it names only the consequence
   * text (docs/AI_SYSTEM.md §10). Absent for any turn that never mentioned
   * one, which is most of them.
   */
  activeFindingId?: string | null;
}

/**
 * Ends the turn durably. Supplied as a port so this module never holds an
 * elevated client: the one function that can write `turn_runs` lives behind
 * `trusted-writer`, and this decides only *what* to ask it to write.
 */
export type TurnCommitter = (input: {
  assistantText: string;
  fields: unknown[];
  assumptions: unknown[];
  evidence: unknown[];
}) => Promise<CompleteTurnRecord>;

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
  excerpt: string | null | undefined,
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

/**
 * A staged row, carrying the index of the operation that produced it.
 *
 * The slot travels to the database and back so an outcome describes what
 * happened to *that* operation, rather than being inferred from a total. One
 * `update_project_model` call may carry eight field updates, and "seven written,
 * one refused" is a different fact from either "applied" or "rejected".
 */
interface FieldRow {
  slot: number;
  area: string;
  key: string;
  label: string;
  value: string;
  origin: "user_stated" | "ai_inferred";
  support: string;
  source_excerpt: string | null;
}

interface AssumptionRow {
  slot: number;
  statement: string;
  why_it_matters: string;
  alternatives: string[];
  importance: string;
  origin: "user_stated" | "ai_inferred";
  source_excerpt: string | null;
}

/**
 * A staged "Add as evidence" proposal (T10 review round 2, P0-B). Names a
 * receipt and a direction, never a target — the target is the receipt's own
 * recorded focal object, resolved inside `complete_turn` itself.
 */
interface EvidenceRow {
  slot: number;
  receipt_id: string;
  consequence_summary: string;
  direction: "supports" | "contradicts" | "unclear";
}

/** Refusal codes the database reports, in words a person can act on. */
const REFUSAL_MESSAGES: Record<string, string> = {
  user_owned_field:
    "A field the person stated themselves cannot be replaced automatically.",
  no_active_research: "There was no research finding this could be added from.",
  no_focal_object:
    "The research this came from was not run against any object.",
  already_linked: "This finding was already added as evidence.",
};

/**
 * Validates every staged operation, then ends the turn: answer, accepted writes
 * and terminal state in one transaction.
 *
 * Validation refuses individually — a malformed checkpoint should not stop a
 * valid field write — but the *transaction* is all-or-none: if it does not
 * commit, no field, no assumption and no answer is stored, and every write
 * outcome is reported as refused rather than left ambiguous.
 */
export async function commitTurn(
  commit: TurnCommitter,
  context: OperationContext,
  operations: readonly StagedOperation[],
  assistantText: string,
): Promise<CommitResult> {
  const outcomes: OperationOutcome[] = [];
  const fields: FieldRow[] = [];
  const assumptions: AssumptionRow[] = [];
  const evidence: EvidenceRow[] = [];
  /** Which outcome slots the transaction decides, so it can rewrite them. */
  const writeSlots: number[] = [];

  for (const operation of operations) {
    const tool = operation.name as DiscoveryToolName;
    const slot = outcomes.length;
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
            slot,
            area: update.area,
            key: update.key,
            label: update.label,
            value: update.value,
            origin: excerpt ? "user_stated" : "ai_inferred",
            support: update.support,
            source_excerpt: excerpt,
          });
        }
        writeSlots.push(slot);
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
          slot,
          statement: parsed.data.statement,
          why_it_matters: parsed.data.whyItMatters,
          alternatives: parsed.data.alternatives,
          importance: parsed.data.importance,
          origin: excerpt ? "user_stated" : "ai_inferred",
          source_excerpt: excerpt,
        });
        writeSlots.push(slot);
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

      case "add_evidence": {
        /*
          Staged like any other write (T10 review round 2, P0-B): whether it
          actually links is decided when the turn completes, so a Stop or a
          lost connection afterwards never leaves an evidence row real while
          the turn's own failure message claims nothing changed — there is no
          separate "it already happened" fact to contradict, because nothing
          has happened here yet.
        */
        const parsed = AddEvidenceSchema.safeParse(operation.candidate);
        if (!parsed.success) {
          outcomes.push(reject(tool, parsed.error.issues[0].message));
          break;
        }
        if (!context.activeFindingId) {
          // No receipt to resolve at all — nothing for `complete_turn` to
          // look up, so this is refused here rather than sent to it.
          outcomes.push(reject(tool, "no_active_research"));
          break;
        }
        evidence.push({
          slot,
          receipt_id: context.activeFindingId,
          consequence_summary: parsed.data.consequenceSummary,
          direction: parsed.data.direction,
        });
        writeSlots.push(slot);
        outcomes.push({ applied: true, kind: tool, count: 1 });
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

  /*
    Always committed, even with nothing staged: the answer and the terminal
    state are part of this transaction too, so there is no path on which a turn
    ends without one.
  */
  const record = await commit({ assistantText, fields, assumptions, evidence });

  if (record.outcome !== "completed") {
    /*
      Nothing was written — not the answer, not one field. Every write outcome is
      rewritten as refused, because reporting one as applied would put a claim in
      the audit trail the database does not support.
    */
    for (const slot of writeSlots) {
      outcomes[slot] = reject(outcomes[slot].kind, record.outcome);
    }
    return { outcome: record.outcome, outcomes, changed: false };
  }

  /*
    What the database says it did, per operation. A staged write is only
    "applied" if a row exists because of it.
  */
  let changed = false;
  for (const slot of writeSlots) {
    const written = record.written[String(slot)] ?? 0;
    const refusals = record.refused[String(slot)] ?? [];
    const kind = outcomes[slot].kind;
    if (written === 0) {
      outcomes[slot] = reject(
        kind,
        REFUSAL_MESSAGES[refusals[0]] ?? refusals[0] ?? "not_written",
      );
      continue;
    }
    changed = true;
    outcomes[slot] = {
      applied: true,
      kind,
      count: written,
      ...(refusals.length ? { refused: refusals.length } : {}),
    };
  }

  return { outcome: "completed", outcomes, changed };
}

function reject(kind: DiscoveryToolName, issue: string): OperationOutcome {
  return { applied: false, kind, reason: "rejected", issue };
}
