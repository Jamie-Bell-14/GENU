import type { SupabaseClient } from "@supabase/supabase-js";
import { isActivityStep, type ActivityState } from "@/lib/ai/activity-steps";
import { activityLineFor, type ActivityLine } from "@/lib/ai/turn-events";

/**
 * The read side of activity (docs/VERTICAL_SLICE_TASKS.md T8). Writing is the
 * trusted server writer's job — see `trusted-writer.ts` for why.
 */

interface ActivityRow {
  operation_id: string;
  step: string;
  state: ActivityState;
  created_at: string;
}

/** How many operations the panel shows. It is recent activity, not all of it. */
export const ACTIVITY_HISTORY_LIMIT = 100;

/**
 * Rebuilds displayable lines from stored rows, oldest first.
 *
 * Each invocation of a step is stored twice — running, then finished — so rows
 * are grouped by operation id and the latest report wins. Grouping by step
 * name would collapse two real invocations of the same operation into one.
 *
 * The label is looked up from the application's catalogue rather than read
 * from the database, so the words a user sees can only be words this
 * repository contains.
 */
export function linesFromRows(rows: readonly ActivityRow[]): ActivityLine[] {
  const byOperation = new Map<string, ActivityLine>();
  for (const row of rows) {
    if (!isActivityStep(row.step)) continue; // Unknown vocabulary is not shown.
    byOperation.set(
      row.operation_id,
      activityLineFor(row.operation_id, row.step, row.state, row.created_at),
    );
  }
  return [...byOperation.values()].sort((a, b) =>
    (a.at ?? "").localeCompare(b.at ?? ""),
  );
}

export interface ActivityHistory {
  lines: ActivityLine[];
  /** True when older activity exists beyond what was returned. */
  truncated: boolean;
  /** The read itself failed, as distinct from there being nothing to read. */
  failed: boolean;
}

/**
 * The most recent activity for a project, read under the caller's user-scoped
 * client so RLS decides what is visible.
 *
 * The query takes the newest rows and the result is restored to reading order.
 * Ordering ascending and then limiting would return the *oldest* rows and hide
 * everything recent, which is the opposite of what a history panel is for.
 */
export async function loadActivityHistory(
  supabase: SupabaseClient,
  projectId: string,
  options: { turnId?: string; limit?: number } = {},
): Promise<ActivityHistory> {
  const limit = options.limit ?? ACTIVITY_HISTORY_LIMIT;
  // Two rows per operation, so fetch enough rows to fill `limit` operations.
  const rowLimit = limit * 2 + 1;

  let query = supabase
    .from("activity_events")
    .select("operation_id, step, state, created_at")
    .eq("project_id", projectId);
  if (options.turnId) query = query.eq("turn_id", options.turnId);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(rowLimit);
  if (error || !data) {
    return { lines: [], truncated: false, failed: true };
  }

  const rows = data as ActivityRow[];
  const lines = linesFromRows([...rows].reverse());
  return {
    lines: lines.slice(-limit),
    truncated: rows.length >= rowLimit || lines.length > limit,
    failed: false,
  };
}
