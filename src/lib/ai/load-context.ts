import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContextField, ContextMessage, ProjectContext } from "./context";
import { RECENT_MESSAGE_LIMIT } from "./context";

/**
 * Reads the project context one turn is allowed to see.
 *
 * Through the user-scoped client, so every row is filtered by RLS before it is
 * a candidate for the prompt. Data minimisation (docs/AI_SYSTEM.md §11) then
 * narrows it further: recent messages rather than the whole conversation,
 * fields rather than audit history, and nothing at all about other projects.
 *
 * A failed read is not fatal. The turn continues on whatever was retrieved and
 * says so, because a model working from a partial project asks a redundant
 * question, while a turn that refuses to start over a slow query loses the
 * user's message for no benefit. The activity step reports the difference.
 */
export interface LoadedContext extends ProjectContext {
  /** True when both reads returned; false when the turn is working blind. */
  complete: boolean;
}

interface FieldRow {
  area: string;
  key: string;
  label: string;
  value: string;
  origin: string;
  support: string;
}

interface MessageRow {
  role: string;
  content: string;
}

export async function loadProjectContext(
  supabase: SupabaseClient,
  projectId: string,
  scope: { objectIds: string[]; focalObjectId: string | null },
): Promise<LoadedContext> {
  let complete = true;

  const { data: fieldRows, error: fieldError } = await supabase
    .from("project_fields")
    .select("area, key, label, value, origin, support")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: true });
  if (fieldError) complete = false;

  const { data: messageRows, error: messageError } = await supabase
    .from("messages")
    .select("role, content")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    // One extra: the user message for *this* turn has already been persisted,
    // and it is delivered separately as the turn's actual prompt. Including it
    // here as well would show the model its own question twice.
    .limit(RECENT_MESSAGE_LIMIT + 1);
  if (messageError) complete = false;

  const fields: ContextField[] = ((fieldRows ?? []) as FieldRow[]).map(
    (row) => ({
      area: row.area,
      key: row.key,
      label: row.label,
      value: row.value,
      origin: row.origin,
      support: row.support,
    }),
  );

  const recent = ((messageRows ?? []) as MessageRow[])
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map<ContextMessage>((row) => ({
      role: row.role as "user" | "assistant",
      content: row.content,
    }));
  // Newest first from the query; drop the current turn's own message and put
  // the rest back in reading order.
  recent.shift();
  recent.reverse();

  return {
    fields,
    recentMessages: recent,
    objectIds: scope.objectIds,
    focalObjectId: scope.focalObjectId,
    complete,
  };
}
