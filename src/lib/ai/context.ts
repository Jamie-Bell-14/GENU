import { MAX_CONTEXT_TOKENS } from "./engine-config";

/**
 * Bounded context assembly (docs/AI_SYSTEM.md §11, SECURITY_STANDARDS §11.5).
 *
 * The rule is minimum necessary, and the way to keep a rule like that is to
 * make it structural: this module decides what a turn may send, and the engine
 * cannot reach past it to the database. What arrives here has already been read
 * under the user's own RLS scope, so nothing assembled here can widen access;
 * the budget is about restraint and cost, not authorisation.
 */

/** One field of the project model, as the model sees it. */
export interface ContextField {
  area: string;
  key: string;
  label: string;
  value: string;
  origin: string;
  support: string;
}

export interface ContextMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ProjectContext {
  fields: ContextField[];
  recentMessages: ContextMessage[];
  /** Objects a scene may name, and which one is currently focal. */
  objectIds: string[];
  focalObjectId: string | null;
}

/**
 * How many recent turns travel with a request. Enough for the thread of a
 * conversation, short of sending its whole history back every turn.
 */
export const RECENT_MESSAGE_LIMIT = 12;

/**
 * A deliberately crude size estimate, used only to decide what to leave out.
 *
 * It is not a token count and must never be reported as one — the provider's
 * counting endpoint is the authority for that, and calling it on every turn
 * would add a round trip to answer a question this budget does not need
 * answered precisely. Three characters per token is well below any real ratio,
 * so this over-estimates and trims early. Trimming early is the safe failure;
 * discovering the real limit at the provider is not.
 */
export function approximateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/** Renders one field as a compact line the model can read and cite. */
function renderField(field: ContextField): string {
  return `- [${field.area}/${field.key}] ${field.label}: ${field.value} (origin: ${field.origin}; support: ${field.support})`;
}

export interface AssembledContext {
  /** The snapshot text, empty when the project has no model yet. */
  snapshot: string;
  messages: ContextMessage[];
  /** Fields dropped to stay inside the budget, for logging and audit. */
  droppedFields: number;
  droppedMessages: number;
  approximateTokens: number;
}

/**
 * Builds the context for one turn, newest information first, dropping the
 * oldest once the budget is spent.
 *
 * Recent messages are given their budget before project fields. A model that
 * has lost the thread of the conversation produces a visibly wrong answer,
 * while one missing an older field asks about something already recorded —
 * annoying, but not incoherent. Both are reported rather than dropped
 * silently, because "the model was not told" is the first thing worth knowing
 * when an answer looks like it ignored the project.
 */
export function assembleContext(
  context: ProjectContext,
  budgetTokens: number = MAX_CONTEXT_TOKENS,
): AssembledContext {
  const messages: ContextMessage[] = [];
  let spent = 0;

  const candidates = context.recentMessages.slice(-RECENT_MESSAGE_LIMIT);
  // Walk backwards so the newest survive when the budget runs out.
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const cost = approximateTokens(candidates[i].content);
    if (spent + cost > budgetTokens) break;
    spent += cost;
    messages.unshift(candidates[i]);
  }
  const droppedMessages = context.recentMessages.length - messages.length;

  const lines: string[] = [];
  let droppedFields = 0;
  for (const field of context.fields) {
    const line = renderField(field);
    const cost = approximateTokens(line);
    if (spent + cost > budgetTokens) {
      droppedFields += 1;
      continue;
    }
    spent += cost;
    lines.push(line);
  }

  const snapshot = lines.length
    ? [
        "Current project model:",
        ...lines,
        droppedFields > 0
          ? `(${droppedFields} further field${droppedFields === 1 ? "" : "s"} not shown.)`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return {
    snapshot,
    messages,
    droppedFields,
    droppedMessages,
    approximateTokens: spent,
  };
}
