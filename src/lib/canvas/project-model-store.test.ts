import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { loadLatestResearchReceipt } from "./project-model-store";

/**
 * `loadLatestResearchReceipt` is what a reload uses to decide whether "Add
 * as evidence" can honestly be offered again (T10 review round 2, P0-A;
 * round 8, P1: also whether the latest current receipt actually has
 * something to add evidence to).
 */
const PROJECT = "11111111-1111-4111-8111-111111111111";
const TURN = "dddddddd-0000-4000-8000-000000000001";
const FOCAL = "aaaaaaaa-0000-4000-8000-000000000001";

function findingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "receipt-1",
    turn_id: TURN,
    focal_object_id: FOCAL,
    title: "Deposit disputes",
    key_finding: "Roughly 1 in 6.",
    why_it_matters: "It matters.",
    visualisation: { kind: "bar", unit: "%", series: [] },
    sources: [],
    methodology: "Method.",
    limitations: "Limits.",
    retrieved_at: "2026-07-30T00:00:00.000Z",
    is_demo: true,
    conflicting: false,
    unavailable_sources: [],
    ...overrides,
  };
}

const currentMessage = { turn_id: TURN, role: "assistant" };

function chainReturning(row: unknown) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: row }),
  };
  return chain;
}

function clientWithTables(
  messageRow: { turn_id: string; role: string } | null,
  findingRowValue: Record<string, unknown> | null,
) {
  return {
    from: (table: string) =>
      chainReturning(table === "messages" ? messageRow : findingRowValue),
  } as unknown as SupabaseClient;
}

describe("loadLatestResearchReceipt", () => {
  it("hydrates a current receipt with a focal object as actionable research", async () => {
    const client = clientWithTables(currentMessage, findingRow());
    await expect(
      loadLatestResearchReceipt(client, PROJECT),
    ).resolves.toMatchObject({
      finding: { id: "receipt-1", title: "Deposit disputes" },
      turnId: TURN,
    });
  });

  it("returns nothing once a later message has moved past the receipt's own turn", async () => {
    const client = clientWithTables(
      { turn_id: "eeeeeeee-0000-4000-8000-000000000002", role: "assistant" },
      findingRow(),
    );
    await expect(
      loadLatestResearchReceipt(client, PROJECT),
    ).resolves.toBeNull();
  });

  /*
    T10 review round 8, P1: a receipt whose pass ran with nothing in focus
    stores `focal_object_id = null`, which `complete_turn` always refuses as
    `no_focal_object` — the live turn already withholds "Add as evidence" for
    exactly this reason. A reload must reach the same answer rather than
    hydrating a receipt that can only ever be submitted for a guaranteed
    refusal.
  */
  it("does not hydrate a current receipt with no focal object as actionable research", async () => {
    const client = clientWithTables(
      currentMessage,
      findingRow({ focal_object_id: null }),
    );
    await expect(
      loadLatestResearchReceipt(client, PROJECT),
    ).resolves.toBeNull();
  });

  it("does not resurrect an older, focused receipt when the latest current receipt has no focal object", async () => {
    let researchFindingsQueries = 0;
    const client = {
      from: (table: string) => {
        if (table === "research_findings") researchFindingsQueries += 1;
        return chainReturning(
          table === "messages"
            ? currentMessage
            : findingRow({ id: "receipt-2", focal_object_id: null }),
        );
      },
    } as unknown as SupabaseClient;

    await expect(
      loadLatestResearchReceipt(client, PROJECT),
    ).resolves.toBeNull();
    // Exactly the one read for "the latest receipt" — no second query reaches
    // for an older, still-focused one once this one turns out to have no
    // target of its own.
    expect(researchFindingsQueries).toBe(1);
  });
});
