import { describe, expect, it } from "vitest";
import {
  assembleContext,
  RECENT_MESSAGE_LIMIT,
  type ContextField,
  type ProjectContext,
} from "./context";

/**
 * Context assembly (docs/AI_SYSTEM.md §11, SECURITY_STANDARDS §11.5).
 *
 * The rule under test is that the budget is real and that what it drops is
 * reported. A trimmer that silently discards the conversation produces answers
 * that look like the model ignored the project, with nothing in the record to
 * say why.
 */
function field(key: string, value = "A value"): ContextField {
  return {
    area: "problem",
    key,
    label: key,
    value,
    origin: "ai_inferred",
    support: "hypothesis",
  };
}

function context(patch: Partial<ProjectContext> = {}): ProjectContext {
  return {
    fields: [],
    recentMessages: [],
    objects: [],
    relationshipIds: [],
    focalObjectId: null,
    ...patch,
  };
}

describe("assembleContext", () => {
  it("renders fields with their origin and support attached", () => {
    const assembled = assembleContext(
      context({ fields: [field("primary_pain", "Deposit disputes")] }),
    );
    expect(assembled.snapshot).toContain("problem/primary_pain");
    expect(assembled.snapshot).toContain("origin: ai_inferred");
    expect(assembled.snapshot).toContain("support: hypothesis");
  });

  it("sends nothing rather than an empty heading for a new project", () => {
    expect(assembleContext(context()).snapshot).toBe("");
  });

  it("caps how much conversation travels with a turn", () => {
    const messages = Array.from({ length: 40 }, (_, index) => ({
      role: "user" as const,
      content: `Message ${index}`,
    }));
    const assembled = assembleContext(context({ recentMessages: messages }));
    expect(assembled.messages).toHaveLength(RECENT_MESSAGE_LIMIT);
    // The most recent survive: a model that has lost the thread of the last
    // few exchanges is visibly wrong in a way a missing older one is not.
    expect(assembled.messages.at(-1)?.content).toBe("Message 39");
  });

  it("keeps the newest exchanges when the budget is tight", () => {
    const messages = Array.from({ length: 6 }, (_, index) => ({
      role: "user" as const,
      content: "x".repeat(300) + index,
    }));
    // Each message costs ~101 by the trimmer's estimate, so two fit and the
    // third does not.
    const assembled = assembleContext(
      context({ recentMessages: messages }),
      250,
    );
    expect(assembled.messages).toHaveLength(2);
    expect(assembled.messages.at(-1)?.content.endsWith("5")).toBe(true);
    expect(assembled.droppedMessages).toBe(4);
  });

  it("says how many fields it left out instead of dropping them silently", () => {
    const fields = Array.from({ length: 50 }, (_, index) =>
      field(`key_${index}`, "y".repeat(200)),
    );
    const assembled = assembleContext(context({ fields }), 400);
    expect(assembled.droppedFields).toBeGreaterThan(0);
    // Said in the prompt too, so the model does not treat a truncated project
    // as the whole project.
    expect(assembled.snapshot).toContain("not shown");
  });

  it("stays inside the budget it was given", () => {
    const assembled = assembleContext(
      context({
        fields: Array.from({ length: 100 }, (_, i) => field(`k${i}`)),
        recentMessages: Array.from({ length: 12 }, () => ({
          role: "assistant" as const,
          content: "z".repeat(500),
        })),
      }),
      1_000,
    );
    expect(assembled.approximateTokens).toBeLessThanOrEqual(1_000);
  });
});

/*
  The scene inventory (finding 1). Ids have to be sent to be nameable — a model
  handed no inventory can only guess a UUID, and every guess is rejected as an
  object outside the project.
*/
describe("scene inventory", () => {
  const object = (id: string, label: string) => ({
    id,
    kind: "concept",
    label,
  });

  it("names the ids, kinds and labels a scene may use", () => {
    const assembled = assembleContext(
      context({
        objects: [object("obj-1", "Deposit disputes")],
        relationshipIds: ["rel-1"],
        focalObjectId: "obj-1",
      }),
    );
    expect(assembled.snapshot).toContain("obj-1");
    expect(assembled.snapshot).toContain("Deposit disputes");
    expect(assembled.snapshot).toContain("rel-1");
    expect(assembled.snapshot).toContain("currently focal");
    expect(assembled.snapshot).toContain("Do not invent an id");
  });

  it("says plainly when there are no relationships to name", () => {
    const assembled = assembleContext(
      context({ objects: [object("obj-1", "A concept")] }),
    );
    expect(assembled.snapshot).toContain("no relationships");
  });

  it("keeps the focal object even when the inventory is trimmed", () => {
    /*
      The focal object leads, so the budget can never trim it away. A scene
      whose focal id was not in the inventory is rejected outright, which would
      look like a broken validator rather than a missing line of context.
    */
    const many = Array.from({ length: 200 }, (_, index) =>
      object(`obj-${index}`, `Object ${index}`),
    );
    const assembled = assembleContext(
      context({ objects: many, focalObjectId: "obj-150" }),
      300,
    );
    expect(assembled.snapshot).toContain("obj-150");
    expect(assembled.droppedObjects).toBeGreaterThan(0);
  });

  it("sends no inventory section for a project with no objects", () => {
    expect(assembleContext(context()).snapshot).toBe("");
  });
});
