import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ContextField,
  ContextMessage,
  ContextObject,
  ProjectContext,
} from "./context";
import { RECENT_MESSAGE_LIMIT } from "./context";

/** Bounds how much of a stored field/assumption's own text is quoted back. */
const GROUNDING_TEXT_MAX = 2_000;

function clip(value: string): string {
  return value.length > GROUNDING_TEXT_MAX
    ? `${value.slice(0, GROUNDING_TEXT_MAX)}…`
    : value;
}

interface ResearchFindingGroundingRow {
  title: string;
  key_finding: string;
  why_it_matters: string;
  methodology: string;
  limitations: string;
  conflicting: boolean;
  focal_object_id: string | null;
}

/**
 * Reads the exact receipt and its recorded target's own stored content, so a
 * later "Add as evidence" turn can ask the live model to judge `direction`
 * from a real comparison rather than a title alone (T10 review round 3, P0-1).
 *
 * Only called when the request itself named a receipt. Every failure to
 * ground — an unreadable receipt, a receipt with no recorded target, or a
 * target whose own content could not be read — returns `{ grounded: false }`
 * rather than throwing, so a turn whose grounding cannot be assembled still
 * runs; `anthropic-engine.ts` is what refuses to trust an ungrounded
 * `direction` once it sees that flag.
 */
export async function loadResearchGrounding(
  supabase: SupabaseClient,
  projectId: string,
  receiptId: string,
): Promise<{ grounded: true; text: string } | { grounded: false }> {
  const { data: findingRow } = await supabase
    .from("research_findings")
    .select(
      "title, key_finding, why_it_matters, methodology, limitations, conflicting, focal_object_id",
    )
    .eq("id", receiptId)
    .eq("project_id", projectId)
    .maybeSingle();
  const finding = findingRow as ResearchFindingGroundingRow | null;
  if (!finding || !finding.focal_object_id) return { grounded: false };

  const { data: objectRow } = await supabase
    .from("project_objects")
    .select("kind")
    .eq("id", finding.focal_object_id)
    .eq("project_id", projectId)
    .maybeSingle();
  const kind = (objectRow as { kind: string } | null)?.kind;

  let targetText: string | null = null;
  if (kind === "field") {
    const { data } = await supabase
      .from("project_fields")
      .select("label, value")
      .eq("id", finding.focal_object_id)
      .eq("project_id", projectId)
      .maybeSingle();
    const field = data as { label: string; value: string } | null;
    if (field) targetText = `${field.label}: ${clip(field.value)}`;
  } else if (kind === "assumption") {
    const { data } = await supabase
      .from("assumptions")
      .select("statement, why_it_matters")
      .eq("id", finding.focal_object_id)
      .eq("project_id", projectId)
      .maybeSingle();
    const assumption = data as {
      statement: string;
      why_it_matters: string | null;
    } | null;
    if (assumption) {
      targetText = assumption.why_it_matters
        ? `${clip(assumption.statement)} — ${clip(assumption.why_it_matters)}`
        : clip(assumption.statement);
    }
  }

  // No stored text could be resolved for this target — a field/assumption
  // that no longer exists, or a target kind (evidence, decision, document)
  // this comparison is not defined for in this slice.
  if (!targetText) return { grounded: false };

  const text = [
    "The exact research finding you may be asked to add as evidence:",
    `Title: ${clip(finding.title)}`,
    `Key finding: ${clip(finding.key_finding)}`,
    `Why it matters: ${clip(finding.why_it_matters)}`,
    `Methodology: ${clip(finding.methodology)}`,
    `Limitations: ${clip(finding.limitations)}`,
    `Sources disagree with each other: ${finding.conflicting ? "yes" : "no"}`,
    "",
    "The object this research was run against, in its own stored words:",
    targetText,
    "",
    "Judge add_evidence's `direction` only from a real comparison between the finding above and this object's own text. Send `unclear` rather than guess.",
  ].join("\n");

  return { grounded: true, text };
}

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
