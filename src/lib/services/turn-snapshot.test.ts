import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { loadLatestEvidenceOutcome, readTurnSnapshot } from "./turn-snapshot";

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
          evidence_refused_reason: null,
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
    expect(snapshot.evidenceRefusedReason).toBeNull();
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
          evidence_refused_reason: null,
        },
      ]),
      PROJECT,
      TURN,
    );
    expect(snapshot).toEqual({
      status: "expired",
      message: null,
      evidenceRefusedReason: null,
    });
  });

  it("is unknown for a turn this project does not have", async () => {
    await expect(
      readTurnSnapshot(clientReturning([]), PROJECT, TURN),
    ).resolves.toEqual({
      status: "unknown",
      message: null,
      evidenceRefusedReason: null,
    });
  });

  it("says the lookup failed rather than guessing at the turn", async () => {
    await expect(
      readTurnSnapshot(clientReturning(null, { code: "57014" }), PROJECT, TURN),
    ).resolves.toEqual({
      status: "lookup_failed",
      message: null,
      evidenceRefusedReason: null,
    });
  });

  it("treats an unrecognised state as a failed lookup, not as a verdict", async () => {
    await expect(
      readTurnSnapshot(
        clientReturning([
          {
            state: "something_new",
            message_id: null,
            evidence_refused_reason: null,
          },
        ]),
        PROJECT,
        TURN,
      ),
    ).resolves.toEqual({
      status: "lookup_failed",
      message: null,
      evidenceRefusedReason: null,
    });
  });

  /*
   * A staged "Add as evidence" proposal's refusal, recovered in the same
   * words the live `evidence_refused` stream event would have shown
   * (T10 review round 4, P0-3) — not only ever available while the SSE
   * connection that was open when `complete_turn` committed still is.
   */
  it("maps a durably recorded refusal to the same user-facing wording the live event uses", async () => {
    const snapshot = await readTurnSnapshot(
      clientReturning([
        {
          state: "completed",
          message_id: TURN,
          message_content: "Adding this as evidence…",
          message_created_at: "2026-07-29T00:00:00.000Z",
          evidence_refused_reason: "already_linked",
        },
      ]),
      PROJECT,
      TURN,
    );
    expect(snapshot.evidenceRefusedReason).toBe(
      "This finding was already added as evidence.",
    );
  });

  it("falls back to a generic message for an unrecognised refusal code, rather than showing nothing", async () => {
    const snapshot = await readTurnSnapshot(
      clientReturning([
        {
          state: "completed",
          message_id: TURN,
          message_content: "Adding this as evidence…",
          message_created_at: "2026-07-29T00:00:00.000Z",
          evidence_refused_reason: "some_future_code",
        },
      ]),
      PROJECT,
      TURN,
    );
    expect(snapshot.evidenceRefusedReason).toBe(
      "This could not be added as evidence.",
    );
  });
});

function clientWithTables(
  messageRow: { turn_id: string } | null,
  runRow: { evidence_refused_reason: string | null } | null,
) {
  // Every chainable call returns the same builder regardless of exact
  // shape, so it serves both the `messages` query (…order().limit()) and
  // the `turn_runs` query (…eq().eq()) without duplicating a mock per shape.
  function builder(row: unknown): unknown {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: row }),
    };
    return chain;
  }
  return {
    from: (table: string) =>
      builder(table === "messages" ? messageRow : runRow),
  } as unknown as SupabaseClient;
}

describe("loadLatestEvidenceOutcome", () => {
  it("returns nothing when the project has no messages at all", async () => {
    await expect(
      loadLatestEvidenceOutcome(clientWithTables(null, null), PROJECT),
    ).resolves.toBeNull();
  });

  it("returns nothing when the latest turn recorded no refusal", async () => {
    await expect(
      loadLatestEvidenceOutcome(
        clientWithTables({ turn_id: TURN }, { evidence_refused_reason: null }),
        PROJECT,
      ),
    ).resolves.toBeNull();
  });

  it("surfaces the latest turn's durable refusal in the same wording the live event uses", async () => {
    await expect(
      loadLatestEvidenceOutcome(
        clientWithTables(
          { turn_id: TURN },
          { evidence_refused_reason: "research_superseded" },
        ),
        PROJECT,
      ),
    ).resolves.toEqual({
      reason:
        "This is no longer the most recent research, so it was not added.",
    });
  });
});
