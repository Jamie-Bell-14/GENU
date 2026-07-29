import { z } from "zod";
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
 * Origins a *model* may claim. `user_stated` is absent on purpose: the model
 * does not get to assert that the person said something. Application code sets
 * that origin from the actual message, so the distinction between stated and
 * inferred cannot be erased by a tool call (docs/AI_SYSTEM.md §2).
 */
export const PROPOSABLE_ORIGINS = ["ai_inferred", "researched"] as const;

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
 * Assumptions carry `user_stated` as well as `ai_inferred`, unlike fields.
 *
 * An assumption's whole point is recording *whose* it is: "smaller agencies
 * probably feel this most" said by the person is a different object from the
 * same sentence inferred by the model, and collapsing them would defeat the
 * step (docs/VERTICAL_SLICE_SPEC.md Step 3). The risk that a turn misattributes
 * one is real but self-correcting: the origin is rendered on the canvas in the
 * same turn the person is reading, and the statement is theirs to edit.
 */
export const ASSUMPTION_ORIGINS = ["user_stated", "ai_inferred"] as const;

export const RecordAssumptionSchema = z
  .object({
    statement: safeText(1_000),
    whyItMatters: safeText(1_000),
    /** Credible alternative explanations, not strawmen (Step 3 acceptance). */
    alternatives: z.array(safeText(300)).max(5).default([]),
    importance: z.enum(ASSUMPTION_IMPORTANCE),
    origin: z.enum(ASSUMPTION_ORIGINS),
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
             * What the model believes is there now. Recorded as the model's
             * claim and re-derived from the database before anything is
             * applied — a proposal built on a stale reading must not silently
             * overwrite the current value.
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
  | "recommend_canvas_scene";

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
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "area",
              "key",
              "label",
              "value",
              "origin",
              "support",
              "rationale",
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
        "origin",
      ],
      properties: {
        statement: { type: "string" },
        whyItMatters: { type: "string" },
        alternatives: {
          type: "array",
          maxItems: 5,
          items: { type: "string" },
        },
        importance: { type: "string", enum: [...ASSUMPTION_IMPORTANCE] },
        origin: {
          type: "string",
          enum: [...ASSUMPTION_ORIGINS],
          description:
            "user_stated only when the person actually said it; ai_inferred when you drew it.",
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
          maxItems: 12,
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
          maxItems: 60,
          items: { type: "string" },
        },
        visibleRelationshipIds: {
          type: "array",
          maxItems: 200,
          items: { type: "string" },
        },
        emphasis: { type: "string", enum: [...EMPHASIS_STATES] },
        reason: { type: "string" },
        transition: { type: "string", enum: [...TRANSITIONS] },
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
    default:
      return { ok: false, issue: `Unknown tool: ${name}` };
  }
}
