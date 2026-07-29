import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whether a turn is still running, as a server-side fact.
 *
 * Two things need this and neither can trust the client UI: steering must be
 * refused for a turn that can no longer consume it, and catch-up must tell
 * "still finishing" apart from "finished with nothing".
 *
 * It reads `turn_runs`, the operational record, rather than `audit_events`.
 * Audit writes are best-effort — a turn must not fail because its history
 * could not be written — so audit is the wrong source for a fact that gates
 * behaviour: a missing row would make a running turn look unknown, and a lost
 * terminal row would leave a finished turn looking permanently live.
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

interface TurnRunRow {
  state: "running" | "completed" | "failed";
}

export async function readTurnStatus(
  supabase: SupabaseClient,
  projectId: string,
  turnId: string,
): Promise<TurnStatus> {
  const { data, error } = await supabase
    .from("turn_runs")
    .select("state")
    .eq("project_id", projectId)
    .eq("turn_id", turnId)
    .maybeSingle();

  if (error) return "lookup_failed";
  const row = data as TurnRunRow | null;
  return row ? row.state : "unknown";
}
