import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whether a turn is still running, as a server-side fact.
 *
 * Two things need this and neither can trust the client UI: steering must be
 * refused for a turn that can no longer consume it, and catch-up must tell
 * "still finishing" apart from "finished with nothing".
 *
 * The audit trail already records `turn_started` and a terminal
 * `turn_completed`/`turn_failed` against the turn's correlation id, so the
 * state is derived from history rather than from a second source that could
 * disagree with it.
 */
export type TurnStatus =
  /** Started, no terminal event yet. */
  | "running"
  | "completed"
  | "failed"
  /** No such turn in this project — also the answer for a foreign turn. */
  | "unknown"
  /** The lookup itself failed; nothing may be concluded about the turn. */
  | "lookup_failed";

interface AuditRow {
  action: string;
}

export async function readTurnStatus(
  supabase: SupabaseClient,
  projectId: string,
  turnId: string,
): Promise<TurnStatus> {
  const { data, error } = await supabase
    .from("audit_events")
    .select("action")
    .eq("project_id", projectId)
    .eq("correlation_id", turnId)
    .in("action", ["turn_started", "turn_completed", "turn_failed"])
    .limit(10);

  if (error) return "lookup_failed";
  const actions = new Set(
    ((data ?? []) as AuditRow[]).map((row) => row.action),
  );
  if (actions.has("turn_completed")) return "completed";
  if (actions.has("turn_failed")) return "failed";
  if (actions.has("turn_started")) return "running";
  return "unknown";
}
