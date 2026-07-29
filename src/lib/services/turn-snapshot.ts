import type { SupabaseClient } from "@supabase/supabase-js";
import type { Message } from "@/lib/ai/turn-events";

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
}

interface SnapshotRow {
  state: string;
  message_id: string | null;
  message_content: string | null;
  message_created_at: string | null;
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

  if (error) return { status: "lookup_failed", message: null };

  const row = ((data ?? []) as SnapshotRow[])[0];
  if (!row) return { status: "unknown", message: null };

  return {
    status: STATUSES.has(row.state)
      ? (row.state as TurnStatus)
      : "lookup_failed",
    message:
      row.message_id && row.message_content !== null
        ? {
            id: row.message_id,
            role: "assistant",
            content: row.message_content,
            blockKind: "plain",
            createdAt: row.message_created_at ?? new Date().toISOString(),
          }
        : null,
  };
}
