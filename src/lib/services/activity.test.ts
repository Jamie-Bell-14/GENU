import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  linesFromRows,
  loadActivityHistory,
  ACTIVITY_HISTORY_LIMIT,
} from "./activity";

/**
 * Two properties matter here and neither is obvious from the query alone: an
 * operation that runs twice must stay two entries, and a bounded history must
 * return the *recent* end of it.
 */

interface Row {
  operation_id: string;
  step: string;
  state: "active" | "succeeded" | "failed";
  created_at: string;
}

function at(seconds: number): string {
  return new Date(Date.UTC(2026, 6, 29, 0, 0, seconds)).toISOString();
}

/** A client that answers the one query shape this service issues. */
function clientReturning(rows: Row[] | null, error?: unknown): SupabaseClient {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: (n: number) =>
      Promise.resolve({
        // Newest first, as the real query orders it.
        data: rows ? [...rows].reverse().slice(0, n) : null,
        error: error ?? null,
      }),
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

describe("rebuilding lines from stored rows", () => {
  it("collapses the reports of one operation into its final state", () => {
    const lines = linesFromRows([
      {
        operation_id: "op-1",
        step: "reading_project_model",
        state: "active",
        created_at: at(1),
      },
      {
        operation_id: "op-1",
        step: "reading_project_model",
        state: "succeeded",
        created_at: at(2),
      },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ state: "succeeded" });
  });

  it("keeps two invocations of the same step as two entries", () => {
    // The case that a turn-plus-step-name identity would silently lose.
    const lines = linesFromRows([
      {
        operation_id: "op-1",
        step: "considering_direction",
        state: "active",
        created_at: at(1),
      },
      {
        operation_id: "op-1",
        step: "considering_direction",
        state: "succeeded",
        created_at: at(2),
      },
      {
        operation_id: "op-2",
        step: "considering_direction",
        state: "active",
        created_at: at(3),
      },
      {
        operation_id: "op-2",
        step: "considering_direction",
        state: "failed",
        created_at: at(4),
      },
    ]);
    expect(lines.map((line) => [line.id, line.state])).toEqual([
      ["op-1", "succeeded"],
      ["op-2", "failed"],
    ]);
  });

  it("ignores a step outside the application's vocabulary", () => {
    const lines = linesFromRows([
      {
        operation_id: "op-1",
        step: "ran_advanced_reasoning",
        state: "succeeded",
        created_at: at(1),
      },
    ]);
    expect(lines).toEqual([]);
  });
});

describe("loading history", () => {
  function manyOperations(count: number): Row[] {
    return Array.from({ length: count }, (_, index) => [
      {
        operation_id: `op-${index}`,
        step: "reading_project_model",
        state: "active" as const,
        created_at: at(index * 2),
      },
      {
        operation_id: `op-${index}`,
        step: "reading_project_model",
        state: "succeeded" as const,
        created_at: at(index * 2 + 1),
      },
    ]).flat();
  }

  it("returns the most recent operations, in reading order", async () => {
    const total = ACTIVITY_HISTORY_LIMIT + 40;
    const history = await loadActivityHistory(
      clientReturning(manyOperations(total)),
      "project",
    );

    expect(history.lines).toHaveLength(ACTIVITY_HISTORY_LIMIT);
    // The newest operation is present and the oldest is not: limiting an
    // ascending query would have returned exactly the opposite.
    expect(history.lines.at(-1)?.id).toBe(`op-${total - 1}`);
    expect(history.lines.map((line) => line.id)).not.toContain("op-0");
    // Oldest first within what is returned.
    expect(history.lines[0].at! < history.lines.at(-1)!.at!).toBe(true);
    expect(history.truncated).toBe(true);
  });

  it("does not claim truncation when everything fits", async () => {
    const history = await loadActivityHistory(
      clientReturning(manyOperations(3)),
      "project",
    );
    expect(history.lines).toHaveLength(3);
    expect(history.truncated).toBe(false);
    expect(history.failed).toBe(false);
  });

  it("reports a failed read as failed, not as an empty history", async () => {
    const history = await loadActivityHistory(
      clientReturning(null, { code: "57014" }),
      "project",
    );
    expect(history).toEqual({ lines: [], truncated: false, failed: true });
  });
});
