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

/**
 * An object a scene may name.
 *
 * Ids have to be *sent* to be nameable. A model asked to recommend a view of
 * existing objects, without being told which objects exist, can only guess a
 * UUID — and every guess is rejected as `object_not_in_project`, which looks
 * like a broken validator rather than a model that was never given the
 * inventory. The kind and label travel with each id so the choice of focal
 * object is informed rather than arbitrary.
 */
export interface ContextObject {
  id: string;
  kind: string;
  label: string;
}

export interface ContextMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ProjectContext {
  fields: ContextField[];
  recentMessages: ContextMessage[];
  /** Objects a scene may name, in a deterministic order. */
  objects: ContextObject[];
  /** Relationship ids a scene may name; nothing else is nameable. */
  relationshipIds: string[];
  focalObjectId: string | null;
  /**
   * The exact research receipt and its recorded target, when this turn's
   * client named one (T10 review round 3, P0-1) — never present just because
   * the project happens to have research history; only when the request
   * itself carried an `activeFindingId`.
   *
   * `grounded: false` covers every case where the comparison the model is
   * about to be asked to judge cannot honestly be grounded: the receipt was
   * unreadable, it named no target, or the target's own content could not be
   * read. A turn whose `add_evidence` call arrives without `grounded: true`
   * present must not trust whatever `direction` the model returns — see
   * `anthropic-engine.ts`, which overrides it to `unclear` in exactly that
   * case rather than let an ungrounded assertion reach the database.
   */
  researchGrounding?: { grounded: true; text: string } | { grounded: false };
}

/**
 * How many recent turns travel with a request. Enough for the thread of a
 * conversation, short of sending its whole history back every turn.
 */
export const RECENT_MESSAGE_LIMIT = 12;

/**
 * How many objects the inventory may name. The scene schema caps a view at 60
 * visible objects, so sending more than that is inventory the model could not
 * use in one scene anyway.
 */
export const MAX_INVENTORY_OBJECTS = 60;

/** Relationship ids the inventory may name. */
export const MAX_INVENTORY_RELATIONSHIPS = 60;

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

/**
 * Neutralises anything that could close a delimiter or open a new one.
 *
 * Stored field values and object labels are user-editable, so they are exactly
 * as untrusted as a chat message — and a value containing `</project_context>`
 * would otherwise end the data region early and leave the rest of the project
 * reading as instruction. Rewritten rather than rejected: a person is allowed
 * to type angle brackets into their own project.
 */
function neutralise(value: string): string {
  return value.replaceAll("<", "‹").replaceAll(">", "›");
}

/** Renders one field as a compact line the model can read and cite. */
function renderField(field: ContextField): string {
  return `- [${field.area}/${field.key}] ${neutralise(field.label)}: ${neutralise(field.value)} (origin: ${field.origin}; support: ${field.support})`;
}

function renderObject(object: ContextObject, focal: boolean): string {
  return `- ${object.id} — ${object.kind}: ${neutralise(object.label)}${focal ? " (currently focal)" : ""}`;
}

export interface AssembledContext {
  /** The snapshot text, empty when the project has no model yet. */
  snapshot: string;
  messages: ContextMessage[];
  /** Fields dropped to stay inside the budget, for logging and audit. */
  droppedFields: number;
  droppedMessages: number;
  droppedObjects: number;
  approximateTokens: number;
}

/**
 * Builds the context for one turn, newest information first, dropping the
 * oldest once the budget is spent.
 *
 * The order of claims on the budget is deliberate. The scene inventory goes
 * first: without it the canvas tools are unusable, and a turn that cannot name
 * an object produces a rejected scene rather than a narrower one. Recent
 * messages come next — a model that has lost the thread of the conversation
 * produces a visibly wrong answer. Project fields come last, because a model
 * missing an older field asks about something already recorded, which is
 * annoying but not incoherent.
 *
 * Everything dropped is reported, because "the model was not told" is the first
 * thing worth knowing when an answer looks like it ignored the project.
 */
export function assembleContext(
  context: ProjectContext,
  budgetTokens: number = MAX_CONTEXT_TOKENS,
): AssembledContext {
  let spent = 0;
  const sections: string[] = [];

  /*
    Reserve the fixed cost of each section's headings and instructions before
    admitting any content. Charging it afterwards can push the total past the
    budget by whatever the surrounding text costs — the check has to happen
    before the spend, not after.
  */
  const relationshipsText = context.relationshipIds
    .slice(0, MAX_INVENTORY_RELATIONSHIPS)
    .join(", ");
  // Reserved only for sections that will actually be sent, and including the
  // "N further fields not shown" note, which is also part of the payload.
  const reserved =
    (context.objects.length
      ? approximateTokens(
          "Objects in this project that a canvas view may name:\nName only ids from these lists. Do not invent an id.\nThis project has no relationships a view may name.",
        ) + approximateTokens(relationshipsText)
      : 0) +
    (context.fields.length
      ? approximateTokens(
          "Current project model:\n(000 further fields not shown.)",
        )
      : 0);
  spent += Math.min(reserved, budgetTokens);

  // 1. Scene inventory. The focal object leads, so it can never be the object
  // trimmed away — a scene whose focal id is missing is rejected outright.
  const focalFirst = context.focalObjectId
    ? [
        ...context.objects.filter(
          (object) => object.id === context.focalObjectId,
        ),
        ...context.objects.filter(
          (object) => object.id !== context.focalObjectId,
        ),
      ]
    : context.objects;

  const objectLines: string[] = [];
  let droppedObjects = 0;
  for (const object of focalFirst.slice(0, MAX_INVENTORY_OBJECTS)) {
    const line = renderObject(object, object.id === context.focalObjectId);
    const cost = approximateTokens(line);
    if (spent + cost > budgetTokens) {
      droppedObjects += 1;
      continue;
    }
    spent += cost;
    objectLines.push(line);
  }
  droppedObjects += Math.max(0, context.objects.length - MAX_INVENTORY_OBJECTS);

  if (objectLines.length) {
    const relationships = context.relationshipIds.slice(
      0,
      MAX_INVENTORY_RELATIONSHIPS,
    );
    const section = [
      "Objects in this project that a canvas view may name:",
      ...objectLines,
      relationships.length
        ? `Relationship ids a view may name: ${relationships.join(", ")}`
        : "This project has no relationships a view may name.",
      "Name only ids from these lists. Do not invent an id.",
    ].join("\n");
    // Its frame was reserved up front; the lines were charged as admitted.
    sections.push(section);
  }

  // 2. Recent conversation, newest kept when the budget runs out.
  const messages: ContextMessage[] = [];
  const candidates = context.recentMessages.slice(-RECENT_MESSAGE_LIMIT);
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const cost = approximateTokens(candidates[i].content);
    if (spent + cost > budgetTokens) break;
    spent += cost;
    messages.unshift(candidates[i]);
  }
  const droppedMessages = context.recentMessages.length - messages.length;

  // 3. Project fields.
  const fieldLines: string[] = [];
  let droppedFields = 0;
  for (const field of context.fields) {
    const line = renderField(field);
    const cost = approximateTokens(line);
    if (spent + cost > budgetTokens) {
      droppedFields += 1;
      continue;
    }
    spent += cost;
    fieldLines.push(line);
  }
  if (fieldLines.length) {
    const section = [
      "Current project model:",
      ...fieldLines,
      droppedFields > 0
        ? `(${droppedFields} further field${droppedFields === 1 ? "" : "s"} not shown.)`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    sections.push(section);
  }

  return {
    snapshot: sections.join("\n\n"),
    messages,
    droppedFields,
    droppedMessages,
    droppedObjects,
    approximateTokens: spent,
  };
}
