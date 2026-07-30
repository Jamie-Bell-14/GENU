import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ContextField,
  ContextMessage,
  ContextObject,
  ProjectContext,
} from "./context";
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
  /** True when every read returned; false when the turn is working blind. */
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
  turn_id: string | null;
}

export async function loadProjectContext(
  supabase: SupabaseClient,
  projectId: string,
  scope: {
    objects: ContextObject[];
    relationshipIds: string[];
    focalObjectId: string | null;
  },
  /**
   * This turn's id, so its own message can be excluded by identity.
   *
   * Dropping "whichever row is newest" assumed the newest message is always
   * this turn's, which stops being true the moment anything else can write a
   * message — a second tab, a retry, a race. Correlating by turn id cannot be
   * wrong in the same way.
   */
  turnId: string,
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
    .select("role, content, turn_id")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    // One extra, because this turn's own message is among them and is dropped
    // below — it is delivered separately as the turn's actual prompt.
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
    .filter((row) => row.turn_id !== turnId)
    .filter((row) => row.role === "user" || row.role === "assistant")
    .slice(0, RECENT_MESSAGE_LIMIT)
    .map<ContextMessage>((row) => ({
      role: row.role as "user" | "assistant",
      content: row.content,
    }))
    // Newest-first from the query; put it back in reading order.
    .reverse();

  return {
    fields,
    recentMessages: recent,
    objects: scope.objects,
    relationshipIds: scope.relationshipIds,
    focalObjectId: scope.focalObjectId,
    complete,
  };
}
