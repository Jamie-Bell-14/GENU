/**
 * Evidence, its receipt and its canonical link (T10 review rounds 1 & 2;
 * SECURITY_STANDARDS §6/§7.1/§11.2).
 *
 * The headline properties under test: `research_findings` and `evidence` are
 * both system-authored (no insert grant for `authenticated`, and invisible
 * across projects); "Add as evidence" is staged into `complete_turn`'s own
 * transaction, so a committed add and the turn's own answer are all-or-none
 * and exactly as durable and recoverable as any other write it makes
 * (T10 review round 2, P0-B); the target is always the receipt's own stored
 * focal object, never a caller-supplied one (P0-A); a foreign/unknown/stale
 * receipt or a receipt with no focal object is rejected uniformly; a repeat
 * across turns is idempotent; and the relationship written — and whether an
 * assumption's status moves, and which way — follows the caller's own
 * determined `direction`, never an unconditional claim (P0-C).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_NAME = "ppm_evidence_rls_test";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

const skip = process.env.RLS_TESTS === "skip";
const adminUrl = process.env.DATABASE_URL;

let db: Client;
let projectA: string;
let projectB: string;
let fieldA: string;
let fieldB: string;
let turnSeq = 0;

async function asTrustedWriter() {
  await db.query("reset role");
  await db.query("set role service_role");
}

async function impersonate(userId: string | null) {
  await db.query("reset role");
  if (userId === null) {
    await db.query("set role anon");
    return;
  }
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId }),
  ]);
  await db.query("set role authenticated");
}

async function addField(projectId: string, key: string): Promise<string> {
  const { rows } = await db.query(
    `insert into project_fields (project_id, area, key, label, value, origin)
     values ($1, 'problem', $2, $2, 'value', 'user_stated') returning id`,
    [projectId, key],
  );
  return rows[0].id;
}

/** Opens a running turn for the project, closing whatever was left running. */
async function openRun(
  projectId: string,
  options: { expired?: boolean } = {},
): Promise<string> {
  turnSeq += 1;
  const turnId = `55555555-0000-4000-8000-${String(turnSeq).padStart(12, "0")}`;
  await asTrustedWriter();
  await db.query(
    `update turn_runs set state = 'completed', accepting_direction = false, ended_at = now()
     where project_id = $1 and state = 'running'`,
    [projectId],
  );
  await db.query(
    `insert into turn_runs (turn_id, project_id, lease_expires_at)
     values ($1, $2, now() + ($3 || ' minutes')::interval)`,
    [turnId, projectId, options.expired ? "-1" : "15"],
  );
  return turnId;
}

async function closeRun(turnId: string, state: "completed" | "failed") {
  await asTrustedWriter();
  await db.query(
    `update turn_runs set state = $2, accepting_direction = false, ended_at = now()
     where turn_id = $1`,
    [turnId, state],
  );
}

/**
 * Completes a turn exactly as `complete_turn` does in production for a plain
 * turn that stages no project-truth writes: the assistant's message is
 * stored and the run is marked completed, together (T10 review round 4,
 * P0-2). Currency is now defined entirely by message adjacency
 * (`complete_turn`'s own evidence-refusal check), so a synthetic "this turn
 * completed" that used `closeRun` alone — flipping `turn_runs.state` without
 * ever storing a message — no longer represents what a completed turn
 * actually leaves behind, and tests using it to simulate a completed
 * research or unrelated turn were exercising a state production never
 * produces.
 */
async function completeTurnPlain(
  projectId: string,
  turnId: string,
  assistantText = "Turn complete.",
): Promise<void> {
  await asTrustedWriter();
  await db.query(
    `select public.complete_turn(
       p_project_id => $1,
       p_turn_id => $2,
       p_actor_id => $3,
       p_assistant_text => $4,
       p_fields => '[]'::jsonb,
       p_assumptions => '[]'::jsonb,
       p_evidence => '[]'::jsonb
     )`,
    [projectId, turnId, USER_A, assistantText],
  );
}

/** Records a receipt exactly as `recordResearchFinding` does. */
async function recordFinding(
  projectId: string,
  turnId: string,
  focalObjectId: string | null,
  overrides: Partial<{
    title: string;
    unavailableSources: unknown[];
    appliedDirections: string[];
  }> = {},
): Promise<string> {
  await asTrustedWriter();
  const { rows } = await db.query(
    `insert into research_findings
       (project_id, turn_id, focal_object_id, unavailable_sources,
        applied_directions, title, key_finding, why_it_matters,
        visualisation, sources, methodology, limitations, retrieved_at,
        is_demo, conflicting)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, 'Key finding.',
             'Why it matters.',
             '{"kind":"bar","unit":"%","series":[]}'::jsonb,
             '[{"id":"s1","name":"Demo source","url":null,"retrievedAt":""}]'::jsonb,
             'Method.', 'Limits.', now(), true, false)
     returning id`,
    [
      projectId,
      turnId,
      focalObjectId,
      JSON.stringify(overrides.unavailableSources ?? []),
      JSON.stringify(overrides.appliedDirections ?? []),
      overrides.title ?? "Deposit disputes",
    ],
  );
  return rows[0].id;
}

interface CompleteResult {
  outcome: string;
  written?: Record<string, number>;
  refused?: Record<string, string[]>;
}

/** Stages one "Add as evidence" proposal into `complete_turn`, as `commitTurn` does. */
async function completeTurnWithEvidence(
  projectId: string,
  turnId: string,
  receiptId: string,
  options: {
    consequenceSummary?: string;
    direction?: "supports" | "contradicts" | "unclear";
    actorId?: string;
  } = {},
): Promise<CompleteResult> {
  await asTrustedWriter();
  const evidence = [
    {
      slot: 0,
      receipt_id: receiptId,
      consequence_summary: options.consequenceSummary ?? "Supports the object.",
      direction: options.direction ?? "supports",
    },
  ];
  const { rows } = await db.query(
    `select public.complete_turn(
       p_project_id => $1,
       p_turn_id => $2,
       p_actor_id => $3,
       p_assistant_text => $4,
       p_fields => '[]'::jsonb,
       p_assumptions => '[]'::jsonb,
       p_evidence => $5::jsonb
     ) as result`,
    [
      projectId,
      turnId,
      options.actorId ?? USER_A,
      "Adding this as evidence.",
      JSON.stringify(evidence),
    ],
  );
  return rows[0].result as CompleteResult;
}

beforeAll(async () => {
  if (!adminUrl) {
    throw new Error(
      "DATABASE_URL is required for the RLS suite (or set RLS_TESTS=skip explicitly).",
    );
  }
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${DB_NAME}`);
  await admin.query(`create database ${DB_NAME}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${DB_NAME}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();

  const dir = path.join(__dirname, "..");
  await db.query(readFileSync(path.join(dir, "tests/shadow-auth.sql"), "utf8"));
  for (const file of readdirSync(path.join(dir, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.query(readFileSync(path.join(dir, "migrations", file), "utf8"));
  }
  await db.query(
    "insert into auth.users (id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')",
    [USER_A, USER_B],
  );

  await impersonate(USER_A);
  projectA = (
    await db.query(
      "insert into projects (owner_id, name) values (auth.uid(), 'A') returning id",
    )
  ).rows[0].id;
  fieldA = await addField(projectA, "primary_pain");

  await impersonate(USER_B);
  projectB = (
    await db.query(
      "insert into projects (owner_id, name) values (auth.uid(), 'B') returning id",
    )
  ).rows[0].id;
  fieldB = await addField(projectB, "primary_pain");
}, 30_000);

afterAll(async () => {
  await db?.end();
});

describe.skipIf(skip)("research_findings", () => {
  it("is not directly writable by the authenticated role", async () => {
    await impersonate(USER_A);
    await expect(
      db.query(
        `insert into research_findings
           (project_id, turn_id, title, key_finding, why_it_matters,
            visualisation, sources, methodology, limitations, retrieved_at,
            is_demo, conflicting)
         values ($1, gen_random_uuid(), 'T', 'K', 'W',
                 '{}'::jsonb, '[]'::jsonb, 'M', 'L', now(), true, false)`,
        [projectA],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("hides receipts from other users", async () => {
    const turnId = await openRun(projectA);
    const receiptId = await recordFinding(projectA, turnId, fieldA);

    await impersonate(USER_B);
    expect(
      (
        await db.query("select 1 from research_findings where id = $1", [
          receiptId,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it("denies anonymous access", async () => {
    await impersonate(null);
    await expect(db.query("select * from research_findings")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("stores the focal object, unavailable sources and applied steering the pass actually produced", async () => {
    const turnId = await openRun(projectA);
    const unavailable = [
      {
        source: { id: "s2", name: "Other", url: null, retrievedAt: "" },
        reason: "unavailable",
      },
    ];
    const receiptId = await recordFinding(projectA, turnId, fieldA, {
      title: "Provenance check",
      unavailableSources: unavailable,
      appliedDirections: ["Focus on England"],
    });

    await impersonate(USER_A);
    const { rows } = await db.query(
      "select focal_object_id, unavailable_sources, applied_directions from research_findings where id = $1",
      [receiptId],
    );
    expect(rows[0].focal_object_id).toBe(fieldA);
    expect(rows[0].unavailable_sources).toEqual(unavailable);
    expect(rows[0].applied_directions).toEqual(["Focus on England"]);
  });

  it("sets the focal object to null when its target is later deleted, rather than orphaning the receipt", async () => {
    await impersonate(USER_A);
    const temporaryField = await addField(projectA, "temporary_focus");
    const turnId = await openRun(projectA);
    const receiptId = await recordFinding(projectA, turnId, temporaryField, {
      title: "Deleted target check",
    });

    await impersonate(USER_A);
    await db.query("delete from project_fields where id = $1", [
      temporaryField,
    ]);

    const { rows } = await db.query(
      "select focal_object_id from research_findings where id = $1",
      [receiptId],
    );
    expect(rows[0].focal_object_id).toBeNull();
  });
});

describe.skipIf(skip)(
  "complete_turn: add_evidence (T10 review round 2, P0-B/P0-C)",
  () => {
    it("creates the evidence row and its relationship together, targeting the receipt's own focal object", async () => {
      // Same-turn research + add is not supported (T10 review round 4,
      // P0-1) — the receipt's own turn completes first, exactly as the
      // application always does before its own next turn can add it.
      const researchTurn = await openRun(projectA);
      const receiptId = await recordFinding(projectA, researchTurn, fieldA);
      await completeTurnPlain(projectA, researchTurn);

      const addTurn = await openRun(projectA);
      const result = await completeTurnWithEvidence(
        projectA,
        addTurn,
        receiptId,
        {
          consequenceSummary: "Supports the field; does not support the rest.",
          direction: "supports",
        },
      );
      expect(result.outcome).toBe("completed");
      expect(result.written).toEqual({ "0": 1 });

      await impersonate(USER_A);
      const evidence = await db.query(
        "select id, project_id, source_receipt_id from evidence where source_receipt_id = $1",
        [receiptId],
      );
      expect(evidence.rowCount).toBe(1);
      const evidenceId = evidence.rows[0].id;

      const relationship = await db.query(
        `select relation, origin, support, note from project_relationships
       where from_object_id = $1 and to_object_id = $2`,
        [evidenceId, fieldA],
      );
      expect(relationship.rows[0]).toMatchObject({
        relation: "supports",
        origin: "researched",
        support: "some_evidence",
        note: "Supports the field; does not support the rest.",
      });
    });

    it("is idempotent across turns: relinking the same receipt reuses both rows and refuses as already_linked", async () => {
      const researchTurn = await openRun(projectA);
      const receiptId = await recordFinding(projectA, researchTurn, fieldA, {
        title: "Idempotency check",
      });
      await completeTurnPlain(projectA, researchTurn);

      const firstAddTurn = await openRun(projectA);
      const first = await completeTurnWithEvidence(
        projectA,
        firstAddTurn,
        receiptId,
      );
      expect(first.written).toEqual({ "0": 1 });

      /*
        A genuine retry: the same receipt named again from a new turn. This
        must read as "already done" (already_linked) even though, by the
        currency rule alone, `firstAddTurn`'s own completion has since made
        `researchTurn` no longer the project's most recent *other* turn —
        idempotency is checked before currency for exactly this reason (see
        the migration's own comment).
      */
      const secondAddTurn = await openRun(projectA);
      const second = await completeTurnWithEvidence(
        projectA,
        secondAddTurn,
        receiptId,
      );
      expect(second.written ?? {}).toEqual({});
      expect(second.refused?.["0"]).toEqual(["already_linked"]);

      await impersonate(USER_A);
      const evidenceCount = await db.query(
        "select count(*)::int as n from evidence where source_receipt_id = $1",
        [receiptId],
      );
      expect(evidenceCount.rows[0].n).toBe(1);
    });

    it("rejects a receipt id from a different project as no_active_research", async () => {
      const turnIdB = await openRun(projectB);
      const receiptIdB = await recordFinding(projectB, turnIdB, fieldB);

      const turnIdA = await openRun(projectA);
      const result = await completeTurnWithEvidence(
        projectA,
        turnIdA,
        receiptIdB,
      );
      expect(result.refused?.["0"]).toEqual(["no_active_research"]);
    });

    it("rejects an unknown receipt id as no_active_research", async () => {
      const turnId = await openRun(projectA);
      const result = await completeTurnWithEvidence(
        projectA,
        turnId,
        "99999999-0000-4000-8000-000000000099",
      );
      expect(result.refused?.["0"]).toEqual(["no_active_research"]);
    });

    it("rejects a receipt whose research ran with no object in focus, as no_focal_object", async () => {
      const researchTurn = await openRun(projectA);
      const receiptId = await recordFinding(projectA, researchTurn, null, {
        title: "No focus check",
      });
      await completeTurnPlain(projectA, researchTurn);

      const addTurn = await openRun(projectA);
      const result = await completeTurnWithEvidence(
        projectA,
        addTurn,
        receiptId,
      );
      expect(result.refused?.["0"]).toEqual(["no_focal_object"]);
    });

    /*
      Currency is now one rule, the same one reload hydration already uses
      (T10 review round 4, P0-2): a receipt is current only if the most
      recent message in the project *other than this turn's own* belongs to
      the receipt's own turn. The tests below construct that adjacency
      directly through `complete_turn` itself (`completeTurnPlain`), the same
      function that stores every real turn's message, rather than flipping
      `turn_runs.state` on its own — a state no real turn ever leaves
      without also storing a message.
    */

    it("rejects a receipt whose own research pass never stored a message, as research_incomplete", async () => {
      // The exact scenario the review named: the finding was recorded
      // (`research_findings` is written before it is even shown), but
      // something later in that same turn failed, so the turn itself never
      // stored a message and is not the project's most recent one.
      const researchTurn = await openRun(projectA);
      const receiptId = await recordFinding(projectA, researchTurn, fieldA, {
        title: "Incomplete turn check",
      });
      await closeRun(researchTurn, "failed");

      const addTurn = await openRun(projectA);
      const result = await completeTurnWithEvidence(
        projectA,
        addTurn,
        receiptId,
      );
      expect(result.refused?.["0"]).toEqual(["research_incomplete"]);

      await impersonate(USER_A);
      const evidenceCount = await db.query(
        "select count(*)::int as n from evidence where source_receipt_id = $1",
        [receiptId],
      );
      expect(evidenceCount.rows[0].n).toBe(0);
    });

    it("rejects a receipt superseded by a later, completed research pass, as research_superseded", async () => {
      const firstResearchTurn = await openRun(projectA);
      const firstReceiptId = await recordFinding(
        projectA,
        firstResearchTurn,
        fieldA,
        { title: "Superseded pass" },
      );
      await completeTurnPlain(projectA, firstResearchTurn);

      // A second, later pass completes and supersedes the first — the same
      // currency rule reload hydration already applies
      // (`loadLatestResearchReceipt`), enforced here so a stale receipt
      // cannot be submitted directly either.
      const secondResearchTurn = await openRun(projectA);
      const secondReceiptId = await recordFinding(
        projectA,
        secondResearchTurn,
        fieldA,
        { title: "Superseding pass" },
      );
      await completeTurnPlain(projectA, secondResearchTurn);

      const addTurn = await openRun(projectA);
      const result = await completeTurnWithEvidence(
        projectA,
        addTurn,
        firstReceiptId,
      );
      expect(result.refused?.["0"]).toEqual(["research_superseded"]);

      await impersonate(USER_A);
      const evidenceCount = await db.query(
        "select count(*)::int as n from evidence where source_receipt_id = $1",
        [firstReceiptId],
      );
      expect(evidenceCount.rows[0].n).toBe(0);
      // The second, current receipt is unaffected and still addable.
      void secondReceiptId;
    });

    /*
      The exact gap round 4 found: round 3's check only ever looked at
      *research* history, so an unrelated turn — one that never touched
      research at all — completing afterwards did not retire an older
      receipt at the write boundary, even though both live client state and
      a reload would already say it was no longer current.
    */
    it("rejects a receipt once an unrelated, non-research turn has since completed", async () => {
      const researchTurn = await openRun(projectA);
      const receiptId = await recordFinding(projectA, researchTurn, fieldA, {
        title: "Retired by an unrelated turn",
      });
      await completeTurnPlain(projectA, researchTurn);

      // An ordinary conversational turn, nothing to do with research.
      const unrelatedTurn = await openRun(projectA);
      await completeTurnPlain(projectA, unrelatedTurn, "Unrelated reply.");

      const addTurn = await openRun(projectA);
      const result = await completeTurnWithEvidence(
        projectA,
        addTurn,
        receiptId,
      );
      expect(result.refused?.["0"]).toEqual(["research_superseded"]);
    });

    it("still accepts the latest completed pass's own receipt", async () => {
      const firstResearchTurn = await openRun(projectA);
      const firstReceiptId = await recordFinding(
        projectA,
        firstResearchTurn,
        fieldA,
        { title: "Earlier pass" },
      );
      await completeTurnPlain(projectA, firstResearchTurn);

      const secondResearchTurn = await openRun(projectA);
      const secondReceiptId = await recordFinding(
        projectA,
        secondResearchTurn,
        fieldA,
        { title: "Latest pass" },
      );
      await completeTurnPlain(projectA, secondResearchTurn);

      const addTurn = await openRun(projectA);
      const result = await completeTurnWithEvidence(
        projectA,
        addTurn,
        secondReceiptId,
      );
      expect(result.written).toEqual({ "0": 1 });

      await impersonate(USER_A);
      const evidenceCount = await db.query(
        "select count(*)::int as n from evidence where source_receipt_id = $1",
        [firstReceiptId],
      );
      expect(evidenceCount.rows[0].n).toBe(0);
    });

    /*
      Round 4, P0-1: same-turn "Research this" → "Add as evidence" is not
      supported at all. The application never attempts it (`route.ts` clears
      the request's `activeFindingId` whenever this turn ran its own
      research, so the operation is refused before it ever names a receipt
      here) — this proves the database independently refuses it too, so a
      caller bypassing that application-side guard cannot succeed either.
    */
    it("refuses a receipt naming this very turn's own still-running research, as research_not_yet_complete", async () => {
      const turnId = await openRun(projectA);
      const receiptId = await recordFinding(projectA, turnId, fieldA, {
        title: "Same-turn research and add",
      });
      const result = await completeTurnWithEvidence(
        projectA,
        turnId,
        receiptId,
      );
      expect(result.refused?.["0"]).toEqual(["research_not_yet_complete"]);

      await impersonate(USER_A);
      const evidenceCount = await db.query(
        "select count(*)::int as n from evidence where source_receipt_id = $1",
        [receiptId],
      );
      expect(evidenceCount.rows[0].n).toBe(0);
    });

    it("refuses when the turn is not running, exactly as any other staged write would", async () => {
      const turnId = await openRun(projectA);
      const receiptId = await recordFinding(projectA, turnId, fieldA, {
        title: "Not running check",
      });
      await closeRun(turnId, "completed");

      const result = await completeTurnWithEvidence(
        projectA,
        turnId,
        receiptId,
      );
      expect(result.outcome).toBe("not_running");
    });

    it("writes a neutral relation and never moves an assumption's status when direction is unclear", async () => {
      await impersonate(USER_A);
      const assumptionId = (
        await db.query(
          `insert into assumptions (project_id, statement, status, origin)
         values ($1, 'An assumption of unclear bearing', 'open', 'ai_inferred')
         returning id`,
          [projectA],
        )
      ).rows[0].id;
      const researchTurn = await openRun(projectA);
      const receiptId = await recordFinding(
        projectA,
        researchTurn,
        assumptionId,
        {
          title: "Unclear direction check",
        },
      );
      await completeTurnPlain(projectA, researchTurn);

      const addTurn = await openRun(projectA);
      const result = await completeTurnWithEvidence(
        projectA,
        addTurn,
        receiptId,
        {
          direction: "unclear",
        },
      );
      expect(result.written).toEqual({ "0": 1 });

      await impersonate(USER_A);
      const evidenceId = (
        await db.query("select id from evidence where source_receipt_id = $1", [
          receiptId,
        ])
      ).rows[0].id;
      const relationship = await db.query(
        `select relation, support from project_relationships
       where from_object_id = $1 and to_object_id = $2`,
        [evidenceId, assumptionId],
      );
      // Neutral by construction — never a claim this RPC did not genuinely
      // determine (T10 review round 2, P0-C).
      expect(relationship.rows[0]).toMatchObject({
        relation: "affects",
        support: "hypothesis",
      });
      const status = await db.query(
        "select status from assumptions where id = $1",
        [assumptionId],
      );
      expect(status.rows[0].status).toBe("open");
    });

    it("moves an open assumption to supported when direction is supports", async () => {
      await impersonate(USER_A);
      const assumptionId = (
        await db.query(
          `insert into assumptions (project_id, statement, status, origin)
         values ($1, 'Smaller agencies feel this most', 'open', 'ai_inferred')
         returning id`,
          [projectA],
        )
      ).rows[0].id;
      const researchTurn = await openRun(projectA);
      const receiptId = await recordFinding(
        projectA,
        researchTurn,
        assumptionId,
        {
          title: "Supports direction check",
        },
      );
      await completeTurnPlain(projectA, researchTurn);

      const addTurn = await openRun(projectA);
      const result = await completeTurnWithEvidence(
        projectA,
        addTurn,
        receiptId,
        {
          direction: "supports",
        },
      );
      expect(result.written).toEqual({ "0": 1 });

      await impersonate(USER_A);
      const status = await db.query(
        "select status from assumptions where id = $1",
        [assumptionId],
      );
      expect(status.rows[0].status).toBe("supported");
    });

    it("moves an open assumption to weakened when direction is contradicts", async () => {
      // The scenario the review named directly: a finding that weakens or
      // contradicts a target must never be recorded as though it supported it.
      await impersonate(USER_A);
      const assumptionId = (
        await db.query(
          `insert into assumptions (project_id, statement, status, origin)
         values ($1, 'Smaller agencies experience this more intensely', 'open', 'ai_inferred')
         returning id`,
          [projectA],
        )
      ).rows[0].id;
      const researchTurn = await openRun(projectA);
      const receiptId = await recordFinding(
        projectA,
        researchTurn,
        assumptionId,
        {
          title: "Contradicts direction check",
        },
      );
      await completeTurnPlain(projectA, researchTurn);

      const addTurn = await openRun(projectA);
      const result = await completeTurnWithEvidence(
        projectA,
        addTurn,
        receiptId,
        {
          direction: "contradicts",
          consequenceSummary:
            "Contradicts the claim that smaller agencies experience this more intensely — the scripted finding shows the opposite pattern.",
        },
      );
      expect(result.written).toEqual({ "0": 1 });

      await impersonate(USER_A);
      const evidenceId = (
        await db.query("select id from evidence where source_receipt_id = $1", [
          receiptId,
        ])
      ).rows[0].id;
      const relationship = await db.query(
        `select relation, support from project_relationships
       where from_object_id = $1 and to_object_id = $2`,
        [evidenceId, assumptionId],
      );
      expect(relationship.rows[0]).toMatchObject({
        relation: "contradicts",
        support: "hypothesis",
      });
      const status = await db.query(
        "select status from assumptions where id = $1",
        [assumptionId],
      );
      expect(status.rows[0].status).toBe("weakened");
    });

    it("never overwrites an assumption that is not open", async () => {
      await impersonate(USER_A);
      const assumptionId = (
        await db.query(
          `insert into assumptions (project_id, statement, status, origin)
         values ($1, 'Already invalidated', 'invalidated', 'ai_inferred')
         returning id`,
          [projectA],
        )
      ).rows[0].id;
      const researchTurn = await openRun(projectA);
      const receiptId = await recordFinding(
        projectA,
        researchTurn,
        assumptionId,
        {
          title: "Resolved assumption check",
        },
      );
      await completeTurnPlain(projectA, researchTurn);

      const addTurn = await openRun(projectA);
      const result = await completeTurnWithEvidence(
        projectA,
        addTurn,
        receiptId,
        {
          direction: "supports",
        },
      );
      expect(result.written).toEqual({ "0": 1 });

      await impersonate(USER_A);
      const status = await db.query(
        "select status from assumptions where id = $1",
        [assumptionId],
      );
      expect(status.rows[0].status).toBe("invalidated");
    });
  },
);

describe.skipIf(skip)("evidence", () => {
  it("is not directly writable by the authenticated role", async () => {
    const turnId = await openRun(projectA);
    const receiptId = await recordFinding(projectA, turnId, fieldA);

    await impersonate(USER_A);
    await expect(
      db.query(
        `insert into evidence
           (project_id, title, summary, source_name, retrieved_at, kind,
            is_demo, source_receipt_id)
         values ($1, 'T', 'S', 'Src', now(), 'secondary_research', true, $2)`,
        [projectA, receiptId],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("has no update or delete grant for the authenticated role", async () => {
    const researchTurn = await openRun(projectA);
    const receiptId = await recordFinding(projectA, researchTurn, fieldA);
    await completeTurnPlain(projectA, researchTurn);
    const addTurn = await openRun(projectA);
    await completeTurnWithEvidence(projectA, addTurn, receiptId);
    await impersonate(USER_A);
    const { rows } = await db.query(
      "select id from evidence where source_receipt_id = $1",
      [receiptId],
    );
    const evidenceId = rows[0].id;

    await expect(
      db.query("update evidence set title = 'changed' where id = $1", [
        evidenceId,
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("delete from evidence where id = $1", [evidenceId]),
    ).rejects.toThrow(/permission denied/);
  });

  it("hides evidence from other users", async () => {
    const researchTurn = await openRun(projectA);
    const receiptId = await recordFinding(projectA, researchTurn, fieldA);
    await completeTurnPlain(projectA, researchTurn);
    const addTurn = await openRun(projectA);
    await completeTurnWithEvidence(projectA, addTurn, receiptId);
    await impersonate(USER_A);
    const { rows } = await db.query(
      "select id from evidence where source_receipt_id = $1",
      [receiptId],
    );
    const evidenceId = rows[0].id;

    await impersonate(USER_B);
    expect(
      (await db.query("select 1 from evidence where id = $1", [evidenceId]))
        .rowCount,
    ).toBe(0);
  });

  it("denies anonymous access", async () => {
    await impersonate(null);
    await expect(db.query("select * from evidence")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("cascades deletion from the project object registry", async () => {
    const researchTurn = await openRun(projectA);
    const receiptId = await recordFinding(projectA, researchTurn, fieldA, {
      title: "Cascade check",
    });
    await completeTurnPlain(projectA, researchTurn);
    const addTurn = await openRun(projectA);
    await completeTurnWithEvidence(projectA, addTurn, receiptId);
    await impersonate(USER_A);
    const { rows } = await db.query(
      "select id from evidence where source_receipt_id = $1",
      [receiptId],
    );
    const evidenceId = rows[0].id;

    // `evidence` itself has no delete grant (only `complete_turn` writes it)
    // — deleting the registry row is what an owner actually can do, and is
    // exactly the path `evidence_object_fk ... on delete cascade` exists to
    // make safe.
    await db.query("delete from project_objects where id = $1", [evidenceId]);

    const remaining = await db.query("select 1 from evidence where id = $1", [
      evidenceId,
    ]);
    expect(remaining.rowCount).toBe(0);
    const orphanLink = await db.query(
      "select 1 from project_relationships where from_object_id = $1",
      [evidenceId],
    );
    expect(orphanLink.rowCount).toBe(0);
  });
});
