import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTIVITY_STEPS, type ActivityStep } from "@/lib/ai/activity-steps";
import type { ActivityLine } from "@/lib/ai/turn-events";

/**
 * Activity recording (docs/VERTICAL_SLICE_TASKS.md T8).
 *
 * The label is looked up from the application's catalogue by step name, so the
 * text a user reads as "what the system is doing" can only be one of the
 * strings written in this repository.
 */
export function activityLine(step: ActivityStep): ActivityLine {
  const { kind, label } = ACTIVITY_STEPS[step];
  return { id: crypto.randomUUID(), kind, label };
}

interface ActivityRow {
  id: string;
  kind: ActivityLine["kind"];
  label: string;
  created_at: string;
}

/**
 * Persists one line of activity. Recording is best-effort by design: a failed
 * insert must not abort a turn the user is watching, because the activity is a
 * narration of work, not the work itself. The audit trail — which does matter
 * for security — is written separately.
 */
export async function recordActivity(
  supabase: SupabaseClient,
  input: { projectId: string; turnId: string; line: ActivityLine },
): Promise<void> {
  const { error } = await supabase.from("activity_events").insert({
    id: input.line.id,
    project_id: input.projectId,
    turn_id: input.turnId,
    kind: input.line.kind,
    label: input.line.label,
  });
  if (error) {
    // No project content in logs (SECURITY_STANDARDS §14.1).
    console.error("activity_event insert failed", { code: error.code });
  }
}

/**
 * The retrievable history behind the activity panel. Read under the caller's
 * user-scoped client, so RLS decides what is visible.
 */
export async function loadActivityHistory(
  supabase: SupabaseClient,
  projectId: string,
  limit = 100,
): Promise<ActivityLine[]> {
  const { data, error } = await supabase
    .from("activity_events")
    .select("id, kind, label, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  // Newest first from the database; oldest first for reading.
  return (data as ActivityRow[])
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      label: row.label,
      at: row.created_at,
    }))
    .reverse();
}
