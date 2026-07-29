import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { readTurnStatus } from "./turn-status";

/**
 * Steering and catch-up both depend on this answer, and both would misbehave
 * if "I could not find out" were reported as "it finished".
 */
function clientReturning(
  actions: string[] | null,
  error?: unknown,
): SupabaseClient {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    limit: () =>
      Promise.resolve({
        data: actions?.map((action) => ({ action })) ?? null,
        error: error ?? null,
      }),
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

const PROJECT = "11111111-1111-4111-8111-111111111111";
const TURN = "dddddddd-0000-4000-8000-000000000001";

describe("readTurnStatus", () => {
  it("is running once started and not yet terminal", async () => {
    await expect(
      readTurnStatus(clientReturning(["turn_started"]), PROJECT, TURN),
    ).resolves.toBe("running");
  });

  it("is completed once the turn recorded a result", async () => {
    await expect(
      readTurnStatus(
        clientReturning(["turn_started", "turn_completed"]),
        PROJECT,
        TURN,
      ),
    ).resolves.toBe("completed");
  });

  it("is failed when the turn recorded a failure", async () => {
    await expect(
      readTurnStatus(
        clientReturning(["turn_started", "turn_failed"]),
        PROJECT,
        TURN,
      ),
    ).resolves.toBe("failed");
  });

  it("is unknown for a turn this project never started", async () => {
    // A foreign turn reads the same way, because the query is project-scoped.
    await expect(
      readTurnStatus(clientReturning([]), PROJECT, TURN),
    ).resolves.toBe("unknown");
  });

  it("says the lookup failed rather than guessing at the turn", async () => {
    await expect(
      readTurnStatus(clientReturning(null, { code: "57014" }), PROJECT, TURN),
    ).resolves.toBe("lookup_failed");
  });
});
