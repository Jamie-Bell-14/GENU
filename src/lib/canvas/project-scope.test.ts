import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { loadTurnScope, scopeIsWhole } from "./project-scope";

/**
 * "Project model read" must mean the whole read succeeded. Several queries take
 * part — object identity, relationship identity, fields, assumptions and the
 * relationship detail used to work out what the project is exploring — and a
 * failure in any of them means the model in hand is not the project's model.
 */

const PROJECT = "11111111-1111-4111-8111-111111111111";

/** A client that fails only the named tables. */
function clientFailing(failing: string[]): SupabaseClient {
  return {
    from(table: string) {
      const result = failing.includes(table)
        ? { data: null, error: { code: "57014" } }
        : { data: [], error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => Promise.resolve(result),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe("loading the scope for a turn", () => {
  it("is a whole read when every query succeeded", async () => {
    const scope = await loadTurnScope(clientFailing([]), PROJECT);
    expect(scope.failed).toBe(false);
    expect(scopeIsWhole(scope)).toBe(true);
    // An empty project is not a failed read.
    expect(scope.objectIds).toEqual([]);
  });

  it.each([
    ["project_objects"],
    ["project_relationships"],
    ["project_fields"],
    ["assumptions"],
  ])("is not a whole read when %s failed", async (table) => {
    const scope = await loadTurnScope(clientFailing([table]), PROJECT);
    expect(scope.failed).toBe(true);
    expect(scopeIsWhole(scope)).toBe(false);
  });

  it("fails when only the semantic reads failed, not the identity ones", async () => {
    // The identity queries define the scope; fields and assumptions define
    // what the project is exploring. Succeeding at the first and failing at
    // the second is exactly the case that used to report success.
    const scope = await loadTurnScope(
      clientFailing(["project_fields", "assumptions"]),
      PROJECT,
    );
    expect(scope.failed).toBe(true);
    expect(scope.focalObjectId).toBeNull();
  });
});
