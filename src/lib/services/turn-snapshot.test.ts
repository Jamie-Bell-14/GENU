import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { readTurnSnapshot } from "./turn-snapshot";

/**
 * The snapshot exists so that state and result cannot be read from different
 * moments. These tests cover the mapping; the coherence itself is a property of
 * the single SQL statement behind `public.turn_snapshot`.
 */
const PROJECT = "11111111-1111-4111-8111-111111111111";
const TURN = "dddddddd-0000-4000-8000-000000000001";

function clientReturning(rows: unknown[] | null, error?: unknown) {
  return {
    rpc: async () => ({ data: rows, error: error ?? null }),
  } as unknown as SupabaseClient;
}

describe("readTurnSnapshot", () => {
  it("returns the state and the result together", async () => {
    const snapshot = await readTurnSnapshot(
      clientReturning([
        {
          state: "completed",
          message_id: TURN,
          message_content: "The answer.",
          message_created_at: "2026-07-29T00:00:00.000Z",
        },
      ]),
      PROJECT,
      TURN,
    );
    expect(snapshot.status).toBe("completed");
    expect(snapshot.message).toMatchObject({
      id: TURN,
      content: "The answer.",
    });
  });

  it("reports an expired lease distinctly from a running turn", async () => {
    // A worker that is gone must not leave recovery saying "still processing".
    const snapshot = await readTurnSnapshot(
      clientReturning([
        {
          state: "expired",
          message_id: null,
          message_content: null,
          message_created_at: null,
        },
      ]),
      PROJECT,
      TURN,
    );
    expect(snapshot).toEqual({ status: "expired", message: null });
  });

  it("is unknown for a turn this project does not have", async () => {
    await expect(
      readTurnSnapshot(clientReturning([]), PROJECT, TURN),
    ).resolves.toEqual({ status: "unknown", message: null });
  });

  it("says the lookup failed rather than guessing at the turn", async () => {
    await expect(
      readTurnSnapshot(clientReturning(null, { code: "57014" }), PROJECT, TURN),
    ).resolves.toEqual({ status: "lookup_failed", message: null });
  });

  it("treats an unrecognised state as a failed lookup, not as a verdict", async () => {
    await expect(
      readTurnSnapshot(
        clientReturning([{ state: "something_new", message_id: null }]),
        PROJECT,
        TURN,
      ),
    ).resolves.toEqual({ status: "lookup_failed", message: null });
  });
});
