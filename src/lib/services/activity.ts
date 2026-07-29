import type { SupabaseClient } from "@supabase/supabase-js";
import { isActivityStep, type ActivityState } from "@/lib/ai/activity-steps";
import { activityLineFor, type ActivityLine } from "@/lib/ai/turn-events";

/**
 * The read side of activity (docs/VERTICAL_SLICE_TASKS.md T8). Writing is the
 * trusted server writer's job — see `trusted-writer.ts` for why.
 */

interface ActivityRow {
  turn_id: string;
  step: string;
  state: ActivityState;
  created_at: string;
}

/**
 * Rebuilds displayable lines from stored rows. Each operation is stored twice
 * — active, then complete — so rows are collapsed by turn and step, keeping the
 * latest state. The label is looked up from the application's catalogue rather
 * than read from the database, so the words a user sees can only be words this
 * repository contains.
 */
export function linesFromRows(rows: readonly ActivityRow[]): ActivityLine[] {
  const byId = new Map<string, ActivityLine>();
  for (const row of rows) {
    if (!isActivityStep(row.step)) continue; // Unknown vocabulary is not shown.
    const line = activityLineFor(
      row.turn_id,
      row.step,
      row.state,
      row.created_at,
    );
    byId.set(line.id, line);
  }
  return [...byId.values()];
}

/**
 * The retrievable history behind the activity panel. Read under the caller's
 * user-scoped client, so RLS decides what is visible.
 */
export async function loadActivityHistory(
  supabase: SupabaseClient,
  projectId: string,
  options: { turnId?: string; limit?: number } = {},
): Promise<ActivityLine[]> {
  let query = supabase
    .from("activity_events")
    .select("turn_id, step, state, created_at")
    .eq("project_id", projectId);
  if (options.turnId) query = query.eq("turn_id", options.turnId);

  const { data, error } = await query
    .order("created_at", { ascending: true })
    .limit(options.limit ?? 200);
  if (error || !data) return [];
  return linesFromRows(data as ActivityRow[]);
}
