import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { DirectionApplication } from "@/lib/ai/turn-events";

/**
 * Mid-turn steering (DESIGN.md §9.3).
 *
 * A direction arrives on a different HTTP request from the streaming turn it
 * steers, so the handover is the database rather than process memory: that is
 * what makes it work when more than one server instance is running.
 */
export const MAX_DIRECTION_LENGTH = 1000;

export const DirectionRequestSchema = z
  .object({
    turnId: z.string().uuid(),
    note: z
      .string()
      .trim()
      .min(1, "Add the direction you want to give.")
      .max(
        MAX_DIRECTION_LENGTH,
        `Directions are limited to ${MAX_DIRECTION_LENGTH} characters.`,
      ),
  })
  .strict();

export type DirectionRequest = z.infer<typeof DirectionRequestSchema>;

export async function recordDirection(
  supabase: SupabaseClient,
  input: {
    projectId: string;
    turnId: string;
    note: string;
    application: DirectionApplication;
  },
): Promise<boolean> {
  const { error } = await supabase.from("turn_directions").insert({
    project_id: input.projectId,
    turn_id: input.turnId,
    note: input.note,
    application: input.application,
  });
  if (error) {
    console.error("turn_direction insert failed", { code: error.code });
    return false;
  }
  return true;
}

/**
 * Directions added since `after`, oldest first.
 *
 * The caller advances `after` itself rather than the rows being marked as
 * consumed: the table is append-only, so "already applied" is a fact about the
 * running turn, not a mutation of history.
 */
export async function readDirectionsSince(
  supabase: SupabaseClient,
  input: { projectId: string; turnId: string; after: string },
): Promise<{ note: string; createdAt: string }[]> {
  const { data, error } = await supabase
    .from("turn_directions")
    .select("note, created_at")
    .eq("project_id", input.projectId)
    .eq("turn_id", input.turnId)
    .gt("created_at", input.after)
    .order("created_at", { ascending: true })
    .limit(10);
  if (error || !data) return [];
  return (data as { note: string; created_at: string }[]).map((row) => ({
    note: row.note,
    createdAt: row.created_at,
  }));
}
