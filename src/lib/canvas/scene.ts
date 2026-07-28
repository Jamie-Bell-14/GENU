import { z } from "zod";

/**
 * The CanvasScene contract (docs/ADAPTIVE_CANVAS_MVP.md §6, docs/AI_SYSTEM.md
 * §9). A scene describes *how project truth is currently shown*. It is not
 * project truth, it has no write path to the project model, and every field is
 * application-owned data — never markup, styling, component names or
 * coordinates.
 */

/**
 * Renderer keys the application implements. A scene naming anything outside
 * this registry is rejected.
 *
 * `evidence_research` is part of the approved MVP allow-list
 * (docs/AI_SYSTEM.md §9) but its renderer ships with T10; registering the key
 * before the renderer exists would create a dead control, so the registry
 * lists only what can actually be rendered today.
 */
export const RENDERER_KEYS = ["problem_exploration"] as const;
export type RendererKey = (typeof RENDERER_KEYS)[number];

export const SCENE_PURPOSES = [
  "explore_problem",
  "review_impact",
  "inspect_structure",
] as const;
export type ScenePurpose = (typeof SCENE_PURPOSES)[number];

/**
 * Connected-change impact is an emphasis state of the problem-exploration
 * renderer, not a third renderer (docs/ADAPTIVE_CANVAS_MVP.md §4.3).
 */
export const EMPHASIS_STATES = ["none", "impact_review"] as const;
export type EmphasisState = (typeof EMPHASIS_STATES)[number];

export const TRANSITIONS = ["preserve", "augment", "replace"] as const;
export type Transition = (typeof TRANSITIONS)[number];

/**
 * Rejects anything that looks like markup, script or style smuggled through a
 * text field (docs/AI_SYSTEM.md §10: "smuggle visual code or coordinates
 * through a scene recommendation").
 */
const MARKUP_PATTERN = /[<>{}]|javascript:|https?:\/\/|style=|class=/i;

const SafeText = z
  .string()
  .min(1)
  .max(300)
  .refine((value) => !MARKUP_PATTERN.test(value), {
    message: "Scene text may not contain markup, styling or links.",
  });

export const CanvasSceneSchema = z
  .object({
    renderer: z.enum(RENDERER_KEYS),
    purpose: z.enum(SCENE_PURPOSES),
    focalObjectId: z.string().uuid(),
    visibleObjectIds: z.array(z.string().uuid()).min(1).max(60),
    visibleRelationshipIds: z.array(z.string().uuid()).max(200).default([]),
    emphasis: z.enum(EMPHASIS_STATES).default("none"),
    /** Shown to the user verbatim when a scene changes. */
    reason: SafeText,
    transition: z.enum(TRANSITIONS).default("preserve"),
  })
  .strict();

export type CanvasScene = z.infer<typeof CanvasSceneSchema>;

export type SceneRejection =
  | { code: "schema_invalid"; message: string }
  | { code: "unknown_renderer"; message: string }
  | { code: "object_not_in_project"; message: string }
  | { code: "relationship_not_in_project"; message: string }
  | { code: "focal_not_visible"; message: string };

export type SceneValidation =
  { ok: true; scene: CanvasScene } | { ok: false; rejection: SceneRejection };

export interface ProjectScope {
  /** Ids of objects that provably belong to the active project. */
  objectIds: ReadonlySet<string>;
  relationshipIds: ReadonlySet<string>;
}

/**
 * The single validation boundary between untrusted scene input and rendering.
 *
 * Schema validation alone is not sufficient: a well-formed scene may still
 * reference another project's objects. Every id is therefore checked against
 * ids the caller has already loaded under RLS, so a scene can never widen
 * access beyond what the user can already read.
 */
export function validateScene(
  candidate: unknown,
  scope: ProjectScope,
): SceneValidation {
  const parsed = CanvasSceneSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // An unregistered renderer is reported distinctly: it is the check that
    // stops a model naming a component the application does not own.
    if (issue.path[0] === "renderer") {
      return {
        ok: false,
        rejection: {
          code: "unknown_renderer",
          message: "The requested view is not available.",
        },
      };
    }
    return {
      ok: false,
      rejection: {
        code: "schema_invalid",
        message: `Scene rejected: ${issue.message}`,
      },
    };
  }

  const scene = parsed.data;

  for (const id of scene.visibleObjectIds) {
    if (!scope.objectIds.has(id)) {
      return {
        ok: false,
        rejection: {
          code: "object_not_in_project",
          message: "The view referenced an object outside this project.",
        },
      };
    }
  }

  for (const id of scene.visibleRelationshipIds) {
    if (!scope.relationshipIds.has(id)) {
      return {
        ok: false,
        rejection: {
          code: "relationship_not_in_project",
          message: "The view referenced a relationship outside this project.",
        },
      };
    }
  }

  if (!scene.visibleObjectIds.includes(scene.focalObjectId)) {
    return {
      ok: false,
      rejection: {
        code: "focal_not_visible",
        message: "The view's focal object is not among its visible objects.",
      },
    };
  }

  return { ok: true, scene };
}

export function isRendererRegistered(key: string): key is RendererKey {
  return (RENDERER_KEYS as readonly string[]).includes(key);
}
