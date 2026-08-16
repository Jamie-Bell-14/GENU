import { z } from "zod";
import { ACTION_IDS, type ActionId } from "@/lib/ai/contextual-actions";
import {
  CanvasSceneSchema,
  RENDERER_KEYS,
  SCENE_PURPOSES,
  EMPHASIS_STATES,
  TRANSITIONS,
} from "@/lib/canvas/scene";

/**
 * The closed set of operations the model may propose (docs/AI_SYSTEM.md §5).
 *
 * Every schema here is `.strict()`, uses closed enums, and bounds each string
 * and array. That is not politeness towards the provider: unknown-field
 * rejection is what stops a proposal carrying an extra `project_id`,
 * `approved`, or `origin: "user_stated"` that some later code path might read.
 * The shape a tool accepts is the shape the application is willing to act on.
 *
 * These schemas validate *shape*. They deliberately do not check ownership,
 * approval state or scope — that happens against the project's own rows, after
 * parsing, because a schema cannot know which ids belong to this user.
 */

/** Areas of the project model the slice implements (0002_project_model.sql). */
export const PROJECT_AREAS = [
  "problem",
  "customer",
  "value_proposition",
  "mvp_scope",
] as const;

/**
 * The only origin a model may propose.
 *
 * `user_stated` is excluded because the model does not get to assert that the
 * person said something — see `quotedFromMessage` below, which is how a field
 * becomes `user_stated` without the model being trusted to say so
 * (docs/AI_SYSTEM.md §2, §10). `researched` stays excluded even though T10
 * adds a research provider: it names *evidence support* for a claim, not
 * whether the claim's own wording was inferred, and evidence support is
 * tracked separately, on `project_relationships` and the field's `support`
 * state
 * (already settable via `PROPOSABLE_SUPPORT`'s `some_evidence`) — not by
 * rewriting a field's origin.
 */
export const PROPOSABLE_ORIGINS = ["ai_inferred"] as const;

/**
 * Support states a model may claim without evidence in hand. The top two are
 * excluded: "strongly evidenced" and "credible" are conclusions that require
 * evidence rows, and letting a turn assert them would manufacture exactly the
 * false certainty this product exists to prevent. `contradicted` stays — being
 * able to say something has been undermined is not the same kind of claim.
 */
export const PROPOSABLE_SUPPORT = [
  "unexplored",
  "hypothesis",
  "some_evidence",
  "contradicted",
] as const;

/** Rejects markup, links and styling smuggled through any user-visible text. */
const MARKUP_PATTERN = /[<>{}]|javascript:|https?:\/\/|style=|class=/i;

/**
 * An excerpt the model offers as evidence, or nothing.
 *
 * Nullable, not merely optional, and that distinction is a real defect this
 * fixes. The provider-facing schemas are `strict`, which requires every property
 * to be present — so a model recording an *inference* correctly sends
 * `quotedFromMessage: null`. A Zod schema accepting only `string | undefined`
 * rejected that entirely valid call, consumed the turn's single schema retry and
 * could fail Step 3 on a well-behaved response.
 *
 * Absent, null and blank all mean the same thing here: there is no quotation, so
 * the record is the model's own inference. Anything present has to be long
 * enough to be evidence of something — see `verifiedQuotation`, which then
 * checks it against the message the server actually received.
 */
const quotedFromMessage = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  })
  .refine((value) => value === null || value.length <= 500, {
    message: "A quotation may be at most 500 characters.",
  })
  .refine((value) => value === null || value.length >= 8, {
    message:
      "A quotation must be at least 8 characters, or null when there is none.",
  });

function safeText(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !MARKUP_PATTERN.test(value), {
      message: "Text may not contain markup, styling or links.",
    });
}

export const UpdateProjectModelSchema = z
  .object({
    updates: z
      .array(
        z
          .object({
            area: z.enum(PROJECT_AREAS),
            key: z
              .string()
              .trim()
              .min(1)
              .max(64)
              // A key is an application identifier, not prose. Constraining it
              // to a slug keeps it usable as one and leaves no room for
              // anything that has to be escaped later.
              .regex(/^[a-z][a-z0-9_]*$/, "Keys are lowercase identifiers."),
            label: safeText(200),
            value: safeText(2_000),
            origin: z.enum(PROPOSABLE_ORIGINS),
            support: z.enum(PROPOSABLE_SUPPORT),
            /** Why this belongs in the project, in the user's terms. */
            rationale: safeText(500),
            /**
             * An exact excerpt from the current user message, when this field
             * records something the person actually said.
             *
             * This is the traceable source that lets the *application* decide
             * the origin is `user_stated`. The host checks the excerpt really
             * is a substring of the message it received; a fabricated or
             * paraphrased quote simply fails that check and the field stays
             * `ai_inferred`. The model cannot set the origin either way — it
             * can only offer evidence, which is then verified.
             */
            quotedFromMessage,
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();

export type UpdateProjectModel = z.infer<typeof UpdateProjectModelSchema>;

export const ASSUMPTION_IMPORTANCE = ["low", "material"] as const;

/**
 * An assumption's origin matters more than a field's — whose assumption it is
 * changes what the product should do about it — which is exactly why the model
 * does not get to declare it.
 *
 * An earlier version of this schema let a turn set `origin: user_stated`
 * directly, on the reasoning that a misattribution would be visible on the
 * canvas and therefore self-correcting. That was too weak: "the user can spot
 * it" is not a control, and an untrusted claim about what someone said is a
 * provenance assertion however visible it is. Origin is now derived by the host
 * from `quotedFromMessage`, on the same terms as a project field.
 */
export const RecordAssumptionSchema = z
  .object({
    statement: safeText(1_000),
    whyItMatters: safeText(1_000),
    /** Credible alternative explanations, not strawmen (Step 3 acceptance). */
    alternatives: z.array(safeText(300)).max(5).default([]),
    importance: z.enum(ASSUMPTION_IMPORTANCE),
    /** Verified against the real message before it can mean `user_stated`. */
    quotedFromMessage,
  })
  .strict();

export type RecordAssumption = z.infer<typeof RecordAssumptionSchema>;

export const ProposeConnectedChangeSchema = z
  .object({
    title: safeText(120),
    rationale: safeText(1_000),
    items: z
      .array(
        z
          .object({
            area: z.enum(PROJECT_AREAS),
            key: z.string().trim().min(1).max(64),
            /**
             * What the model believes is there now, for its own reasoning
             * only — `complete_turn` discards this the moment the proposal
             * is staged and snapshots the field's real value instead (T11
             * review round 1, P1), so a proposal built on a stale reading
             * can never silently overwrite the current value.
             */
            before: safeText(2_000),
            after: safeText(2_000),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    /** What stays unresolved even if this is approved in full. */
    remainingUncertainty: safeText(500),
  })
  .strict();

export type ProposeConnectedChange = z.infer<
  typeof ProposeConnectedChangeSchema
>;

export const SUGGEST_CHECKPOINT_REASONS = [
  "area_defined",
  "evidence_gathered",
  "decision_recorded",
] as const;

export const SuggestCheckpointSchema = z
  .object({
    name: safeText(80),
    reason: z.enum(SUGGEST_CHECKPOINT_REASONS),
    summary: safeText(500),
  })
  .strict();

export type SuggestCheckpoint = z.infer<typeof SuggestCheckpointSchema>;

/**
 * Contextual actions, named by id from the application's catalogue.
 *
 * The model never supplies a label. A button is a promise about what the
 * product does when pressed, and that promise is the application's to make.
 */
export const SuggestActionsSchema = z
  .object({
    actionIds: z.array(z.enum(ACTION_IDS as [ActionId, ...ActionId[]])).max(3),
  })
  .strict();

export type SuggestActions = z.infer<typeof SuggestActionsSchema>;

/**
 * Starts the slice's one research provider (docs/ARCHITECTURE.md §9, T10).
 *
 * `topic` is display-only — quoted back to the person so they can see what
 * was asked for — and never a query the provider executes: `MockResearchProvider`
 * ignores it entirely, since this slice has exactly one scripted scenario.
 */
export const StartResearchSchema = z
  .object({
    topic: safeText(300),
  })
  .strict();

export type StartResearch = z.infer<typeof StartResearchSchema>;

/**
 * Records a research finding as evidence (T10, VERTICAL_SLICE_SPEC Step 6).
 *
 * The model supplies the honest, bounded consequence text — what this
 * specific finding does and does not support — and, separately, `direction`:
 * a closed judgement of whether the finding genuinely supports, contradicts,
 * or does not clearly bear on whatever object is currently in focus.
 * `direction` is never inferred by application code from the mere fact that
 * evidence is being linked (T10 review round 2, P0-C) — it must reflect a
 * real comparison between the finding and the target's own stated content,
 * and `unclear` is always the honest answer when that comparison cannot be
 * made confidently. Getting this wrong the model's own way is a normal
 * reasoning error the person can see and correct; a database that asserted
 * "supports" unconditionally would be silently wrong on principle every time
 * the true relationship happened to be otherwise.
 *
 * The model never supplies *which* finding or *which* object: those come
 * from the receipt this turn is looking at and that receipt's own recorded
 * target, so a call here cannot attach fabricated provenance to an arbitrary
 * object the model names.
 *
 * `consequenceSummary` is bounded to 500, matching
 * `project_relationships.note`'s own check constraint — it is stored there,
 * not in a bespoke column, so the two limits have to agree.
 */
export const AddEvidenceSchema = z
  .object({
    consequenceSummary: safeText(500),
    direction: z.enum(["supports", "contradicts", "unclear"]),
  })
  .strict();

export type AddEvidence = z.infer<typeof AddEvidenceSchema>;

/**
 * The scene tool reuses `CanvasSceneSchema` verbatim rather than restating it.
 * A second definition would be a second place for the allow-list to drift from
 * the renderers that actually exist.
 */
export const RecommendCanvasSceneSchema = CanvasSceneSchema;

export type DiscoveryToolName =
  | "update_project_model"
  | "record_assumption"
  | "propose_connected_change"
  | "suggest_checkpoint"
  | "suggest_actions"
  | "recommend_canvas_scene"
  | "start_research"
  | "add_evidence";

/**
 * Provider-facing tool definitions.
 *
 * Written as literal JSON Schema rather than generated from the Zod schemas.
 * Generation would guarantee the two agree, which sounds better than it is:
 * the provider schema is a *hint* that shapes what the model emits, while the
 * Zod schema is the boundary that decides what the application accepts. Tying
 * them together invites the assumption that passing the first means passing
 * the second. Every tool result is parsed with Zod regardless of what the
 * provider validated.
 *
 * Every tool here sets `strict: true`, which constrains input to a specific
 * subset of JSON Schema — grammar-constrained sampling, not a validator that
 * degrades gracefully on an unsupported keyword. `maxItems`, and `minItems`
 * above 1, are outside that subset ("array constraints beyond minItems of 0
 * or 1" are not supported) and reject the *entire* request with a 400 before
 * any inference happens, not just the array in question (T11 entry-gate live
 * smoke test, issue #14, Attempt 2 — confirmed against
 * platform.claude.com/docs/en/build-with-claude/structured-outputs). Bounds
 * on how many items a model may send are enforced by the Zod schema alone;
 * see `discovery-tools.test.ts` for the regression check that keeps this
 * file from drifting back into the unsupported subset.
 */
export const DISCOVERY_TOOLS = [
  {
    name: "update_project_model",
    description:
      "Record what the project now knows. Call this when the person has told you something concrete about the problem, the customer, the value proposition or the scope, or when you have drawn an inference worth keeping. State the origin honestly: an inference is not something they said. Do not call this to record small talk or your own questions.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["updates"],
      properties: {
        updates: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            /*
              Every property, because these schemas are `strict`: a property left
              out of `required` is not "optional" to the provider. The one that
              may be empty is nullable instead, and the Zod boundary accepts null
              for exactly that reason.
            */
            required: [
              "area",
              "key",
              "label",
              "value",
              "origin",
              "support",
              "rationale",
              "quotedFromMessage",
            ],
            properties: {
              area: { type: "string", enum: [...PROJECT_AREAS] },
              key: {
                type: "string",
                description:
                  "Stable lowercase identifier for this field within its area, e.g. primary_customer.",
              },
              label: {
                type: "string",
                description: "Short human-readable name.",
              },
              value: { type: "string" },
              origin: {
                type: "string",
                enum: [...PROPOSABLE_ORIGINS],
                description:
                  "ai_inferred when you derived it; researched when it came from research output.",
              },
              support: { type: "string", enum: [...PROPOSABLE_SUPPORT] },
              rationale: {
                type: "string",
                description:
                  "Why this belongs in the project, for the person to read.",
              },
              quotedFromMessage: {
                type: ["string", "null"],
                description:
                  "An exact, word-for-word excerpt from the person's message, if this records something they actually said in those words. It is checked against the real message; paraphrase it and the field will be recorded as your inference instead. Send null when the field is your own inference.",
              },
            },
          },
        },
      },
    },
  },
  {
    name: "record_assumption",
    description:
      "Record an assumption the project is now resting on — one the person made, or one you drew from what they said. Say why it matters and offer alternative explanations that are genuinely plausible, not ones chosen to be dismissed. Mark it material only if being wrong about it would change the direction of the work.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "statement",
        "whyItMatters",
        "alternatives",
        "importance",
        "quotedFromMessage",
      ],
      properties: {
        statement: { type: "string" },
        whyItMatters: { type: "string" },
        alternatives: {
          type: "array",
          items: { type: "string" },
        },
        importance: { type: "string", enum: [...ASSUMPTION_IMPORTANCE] },
        quotedFromMessage: {
          type: ["string", "null"],
          description:
            "An exact, word-for-word excerpt from the person's message, if the assumption is theirs in those words. It is checked against the real message. Send null when the assumption is your own inference.",
        },
      },
    },
  },
  {
    name: "propose_connected_change",
    description:
      "Propose a change that spans several parts of the project, for the person to review. Nothing you propose here is applied — they approve or reject it, item by item. Use it when a single new fact should change more than one area, and say plainly what remains uncertain even if they accept all of it.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "rationale", "items", "remainingUncertainty"],
      properties: {
        title: { type: "string" },
        rationale: { type: "string" },
        items: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["area", "key", "before", "after"],
            properties: {
              area: { type: "string", enum: [...PROJECT_AREAS] },
              key: { type: "string" },
              before: {
                type: "string",
                description: "The current value as you understand it.",
              },
              after: { type: "string" },
            },
          },
        },
        remainingUncertainty: { type: "string" },
      },
    },
  },
  {
    name: "suggest_checkpoint",
    description:
      "Suggest naming a milestone, when a stage of the work is genuinely complete. Do not use this to mark encouragement or progress in general.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["name", "reason", "summary"],
      properties: {
        name: { type: "string" },
        reason: { type: "string", enum: [...SUGGEST_CHECKPOINT_REASONS] },
        summary: { type: "string" },
      },
    },
  },
  {
    name: "suggest_actions",
    description:
      "Offer up to three next actions, by id, from the list this tool accepts. You cannot write the button text — the application owns it. Offer an action only when it genuinely follows from what you just said; an empty list is a valid answer.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["actionIds"],
      properties: {
        actionIds: {
          type: "array",
          items: { type: "string", enum: [...ACTION_IDS] },
        },
      },
    },
  },
  {
    name: "recommend_canvas_scene",
    description:
      "Recommend what the canvas should show. Name only objects that already exist in the project — you are choosing a view of what is there, not creating anything. Recommend a change rarely: prefer preserving what the person is already looking at, and give a short reason they will read.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "renderer",
        "purpose",
        "focalObjectId",
        "visibleObjectIds",
        "visibleRelationshipIds",
        "emphasis",
        "reason",
        "transition",
      ],
      properties: {
        renderer: { type: "string", enum: [...RENDERER_KEYS] },
        purpose: { type: "string", enum: [...SCENE_PURPOSES] },
        focalObjectId: {
          type: "string",
          description:
            "An existing object id, which must also appear in visibleObjectIds.",
        },
        visibleObjectIds: {
          type: "array",
          minItems: 1,
          items: { type: "string" },
        },
        visibleRelationshipIds: {
          type: "array",
          items: { type: "string" },
        },
        emphasis: { type: "string", enum: [...EMPHASIS_STATES] },
        reason: { type: "string" },
        transition: { type: "string", enum: [...TRANSITIONS] },
      },
    },
  },
  {
    name: "start_research",
    description:
      "Start the project's research flow on the current focal object. Use this when the person asks you to look something up or research a claim. This slice's research is entirely demonstration data — say so plainly rather than implying a live lookup.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["topic"],
      properties: {
        topic: {
          type: "string",
          description:
            "A short, honest restatement of what is being researched, shown to the person as-is.",
        },
      },
    },
  },
  {
    name: "add_evidence",
    description:
      "Add the research finding this turn just produced as evidence, linked to the object research was launched from. Only call this once a finding exists and the person has asked to keep it. State plainly what the finding supports and — just as plainly — what it does not support; never claim more than the evidence shows. Set direction from a real comparison between the finding and the target's own stated content — use unclear rather than guess when that comparison is not confident.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["consequenceSummary", "direction"],
      properties: {
        consequenceSummary: {
          type: "string",
          description:
            "One or two honest sentences: what this specific finding supports, and what it does not.",
        },
        direction: {
          type: "string",
          enum: ["supports", "contradicts", "unclear"],
          description:
            "Whether this finding genuinely supports, contradicts, or does not clearly bear on the object currently in focus. Never a default — judge it from the finding and the object's own text.",
        },
      },
    },
  },
] as const;

export type ToolValidation<T> =
  { ok: true; value: T } | { ok: false; issue: string };

function parse<T>(schema: z.ZodType<T>, input: unknown): ToolValidation<T> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  const issue = result.error.issues[0];
  const path = issue.path.join(".");
  return {
    ok: false,
    // Enough for the model to correct itself on the one permitted retry, and
    // nothing about the project: this string is sent back to the provider.
    issue: path ? `${path}: ${issue.message}` : issue.message,
  };
}

/**
 * Whether `name` is one of the application's own tool identifiers.
 *
 * A closed check against `DISCOVERY_TOOLS` — the same list the provider is
 * given — rather than a hardcoded copy of it, so the two cannot drift apart.
 * Exists so a caller can safely record *which* tool a request named before
 * (or instead of) validating its arguments: `validateToolInput` only returns
 * a tool name on success, so a malformed-argument call for a real tool would
 * otherwise leave no safe trace of which tool was ever asked for (T11 entry
 * gate, issue #14 — the exact class of provider/schema incompatibility the
 * live smoke test exists to catch).
 */
export function isDiscoveryToolName(name: string): name is DiscoveryToolName {
  return DISCOVERY_TOOLS.some((tool) => tool.name === name);
}

/**
 * Validates a tool call by name. An unknown tool name is a failure rather than
 * a no-op — the model reaching for a tool that does not exist is worth
 * knowing about, not worth silently absorbing.
 */
export function validateToolInput(
  name: string,
  input: unknown,
):
  | { ok: true; tool: DiscoveryToolName; value: unknown }
  | { ok: false; issue: string } {
  switch (name) {
    case "update_project_model": {
      const result = parse(UpdateProjectModelSchema, input);
      return result.ok ? { ok: true, tool: name, value: result.value } : result;
    }
    case "record_assumption": {
      const result = parse(RecordAssumptionSchema, input);
      return result.ok ? { ok: true, tool: name, value: result.value } : result;
    }
    case "suggest_actions": {
      const result = parse(SuggestActionsSchema, input);
      return result.ok ? { ok: true, tool: name, value: result.value } : result;
    }
    case "propose_connected_change": {
      const result = parse(ProposeConnectedChangeSchema, input);
      return result.ok ? { ok: true, tool: name, value: result.value } : result;
    }
    case "suggest_checkpoint": {
      const result = parse(SuggestCheckpointSchema, input);
      return result.ok ? { ok: true, tool: name, value: result.value } : result;
    }
    case "recommend_canvas_scene": {
      const result = parse(RecommendCanvasSceneSchema, input);
      return result.ok ? { ok: true, tool: name, value: result.value } : result;
    }
    case "start_research": {
      const result = parse(StartResearchSchema, input);
      return result.ok ? { ok: true, tool: name, value: result.value } : result;
    }
    case "add_evidence": {
      const result = parse(AddEvidenceSchema, input);
      return result.ok ? { ok: true, tool: name, value: result.value } : result;
    }
    default:
      return { ok: false, issue: `Unknown tool: ${name}` };
  }
}
