import type { SupabaseClient } from "@supabase/supabase-js";
import type { Message } from "@/lib/ai/turn-events";
import { REFUSAL_MESSAGES } from "./model-operations";

/**
 * One coherent view of what a turn amounts to.
 *
 * Reading the turn's state and its result as separate requests can assemble a
 * combination that never existed — the result read misses the insert, the
 * state read then sees `completed`, and the caller concludes the turn finished
 * with nothing. The snapshot is therefore a single statement in the database
 * (`public.turn_snapshot`), so state and result come from one moment or not at
 * all.
 */
export type TurnStatus =
  /** Started, no terminal state, and the worker's lease is still valid. */
  | "running"
  | "completed"
  | "failed"
  /** Running, but the lease has expired: the worker is gone. */
  | "expired"
  /** No such turn in this project — also the answer for a foreign turn. */
  | "unknown"
  /** The lookup itself failed; nothing may be concluded about the turn. */
  | "lookup_failed";

export interface TurnSnapshot {
  status: TurnStatus;
  message: Message | null;
  /**
   * Why a staged "Add as evidence" proposal in this turn was not written,
   * in the same words the live `evidence_refused` stream event would have
   * shown (T10 review round 4) — recovered from `turn_runs` rather than
   * only ever available on the SSE connection that was open when
   * `complete_turn` committed. `null` when nothing was staged, or it was
   * written.
   */
  evidenceRefusedReason: string | null;
}

interface SnapshotRow {
  state: string;
  message_id: string | null;
  message_content: string | null;
  message_created_at: string | null;
  evidence_refused_reason: string | null;
}

const STATUSES = new Set(["running", "completed", "failed", "expired"]);

export async function readTurnSnapshot(
  supabase: SupabaseClient,
  projectId: string,
  turnId: string,
): Promise<TurnSnapshot> {
  const { data, error } = await supabase.rpc("turn_snapshot", {
    p_project_id: projectId,
    p_turn_id: turnId,
  });

  if (error)
    return {
      status: "lookup_failed",
      message: null,
      evidenceRefusedReason: null,
    };

  const row = ((data ?? []) as SnapshotRow[])[0];
  if (!row)
    return { status: "unknown", message: null, evidenceRefusedReason: null };

  return {
    status: STATUSES.has(row.state)
      ? (row.state as TurnStatus)
      : "lookup_failed",
    message:
      row.message_id && row.message_content !== null
        ? {
            id: row.message_id,
            // Attribution travels with the result: a recovered answer arrives
            // out of order and must still render under its own question.
            turnId,
            role: "assistant",
            content: row.message_content,
            blockKind: "plain",
            createdAt: row.message_created_at ?? new Date().toISOString(),
          }
        : null,
    evidenceRefusedReason: row.evidence_refused_reason
      ? (REFUSAL_MESSAGES[row.evidence_refused_reason] ??
        "This could not be added as evidence.")
      : null,
  };
}

interface LatestTurnRow {
  turn_id: string;
}

interface EvidenceOutcomeRow {
  evidence_refused_reason: string | null;
}

/**
 * The evidence-refusal outcome from the project's most recent turn, if it
 * has one and is still the most recent thing that happened
 * (T10 review round 4, P0-3) — read at page load the same way
 * `loadLatestResearchReceipt` reads a still-current research receipt, so a
 * reload recovers the same correction the live `evidence_refused` event
 * would have shown rather than leaving the staged wording as the only
 * durable statement.
 */
export async function loadLatestEvidenceOutcome(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{ reason: string } | null> {
  const { data: message } = await supabase
    .from("messages")
    .select("turn_id")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const turnId = (message as LatestTurnRow | null)?.turn_id;
  if (!turnId) return null;

  const { data: run } = await supabase
    .from("turn_runs")
    .select("evidence_refused_reason")
    .eq("turn_id", turnId)
    .eq("project_id", projectId)
    .maybeSingle();
  const code = (run as EvidenceOutcomeRow | null)?.evidence_refused_reason;
  if (!code) return null;

  return {
    reason: REFUSAL_MESSAGES[code] ?? "This could not be added as evidence.",
  };
}
