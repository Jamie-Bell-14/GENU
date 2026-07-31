/**
 * Evidence, its receipt and its canonical link (T10 review round 1,
 * P0-1/P0-2/P0-3; SECURITY_STANDARDS §6/§7.1/§11.2).
 *
 * The headline properties under test: `research_findings` and `evidence` are
 * both system-authored (no insert grant for `authenticated`, and invisible
 * across projects); `add_evidence_link` is the only way an `evidence` row and
 * its `project_relationships` link can ever come to exist, that pair is
 * all-or-none, a foreign/unknown/stale receipt or object is rejected
 * uniformly, a repeat call is idempotent, and an 'open' assumption's status
 * moves to 'supported' on a genuine new link but never further and never for
 * an already-resolved assumption.
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

/** Records a receipt exactly as `recordResearchFinding` does. */
async function recordFinding(
  projectId: string,
  turnId: string,
  overrides: Partial<{ title: string }> = {},
): Promise<string> {
  await asTrustedWriter();
  const { rows } = await db.query(
    `insert into research_findings
       (project_id, turn_id, title, key_finding, why_it_matters,
        visualisation, sources, methodology, limitations, retrieved_at,
        is_demo, conflicting)
     values ($1, $2, $3, 'Key finding.', 'Why it matters.',
             '{"kind":"bar","unit":"%","series":[]}'::jsonb,
             '[{"id":"s1","name":"Demo source","url":null,"retrievedAt":""}]'::jsonb,
             'Method.', 'Limits.', now(), true, false)
     returning id`,
    [projectId, turnId, overrides.title ?? "Deposit disputes"],
  );
  return rows[0].id;
}

async function linkEvidence(
  projectId: string,
  turnId: string,
  actorId: string,
  receiptId: string,
  objectId: string,
  consequenceSummary = "Supports the object.",
): Promise<string> {
  await asTrustedWriter();
  const { rows } = await db.query(
    "select public.add_evidence_link($1, $2, $3, $4, $5, $6) as outcome",
    [projectId, turnId, actorId, receiptId, objectId, consequenceSummary],
  );
  return rows[0].outcome as string;
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
    const receiptId = await recordFinding(projectA, turnId);

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
});

describe.skipIf(skip)("add_evidence_link", () => {
  it("is not callable by a browser session", async () => {
    const turnId = await openRun(projectA);
    const receiptId = await recordFinding(projectA, turnId);

    await impersonate(USER_A);
    await expect(
      db.query(
        "select public.add_evidence_link($1, $2, auth.uid(), $3, $4, 'x')",
        [projectA, turnId, receiptId, fieldA],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("creates the evidence row and its relationship together, and reports linked", async () => {
    const turnId = await openRun(projectA);
    const receiptId = await recordFinding(projectA, turnId);

    const outcome = await linkEvidence(
      projectA,
      turnId,
      USER_A,
      receiptId,
      fieldA,
      "Supports the field; does not support the rest.",
    );
    expect(outcome).toBe("linked");

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

  it("is idempotent: relinking the same receipt to the same object reuses both rows", async () => {
    const turnId = await openRun(projectA);
    const receiptId = await recordFinding(projectA, turnId);

    expect(
      await linkEvidence(projectA, turnId, USER_A, receiptId, fieldA),
    ).toBe("linked");
    expect(
      await linkEvidence(projectA, turnId, USER_A, receiptId, fieldA),
    ).toBe("already_linked");

    await impersonate(USER_A);
    const evidenceCount = await db.query(
      "select count(*)::int as n from evidence where source_receipt_id = $1",
      [receiptId],
    );
    expect(evidenceCount.rows[0].n).toBe(1);
    const linkCount = await db.query(
      `select count(*)::int as n from project_relationships r
       join evidence e on e.id = r.from_object_id
       where e.source_receipt_id = $1
         and r.to_object_id = $2
         and r.relation = 'supports'`,
      [receiptId, fieldA],
    );
    expect(linkCount.rows[0].n).toBe(1);
  });

  it("rejects a receipt id from a different project as no_active_research", async () => {
    const turnIdB = await openRun(projectB);
    const receiptIdB = await recordFinding(projectB, turnIdB);

    const turnIdA = await openRun(projectA);
    expect(
      await linkEvidence(projectA, turnIdA, USER_A, receiptIdB, fieldA),
    ).toBe("no_active_research");
  });

  it("rejects an unknown receipt id as no_active_research", async () => {
    const turnId = await openRun(projectA);
    expect(
      await linkEvidence(
        projectA,
        turnId,
        USER_A,
        "99999999-0000-4000-8000-000000000099",
        fieldA,
      ),
    ).toBe("no_active_research");
  });

  it("rejects an object from a different project as no_focal_object", async () => {
    const turnId = await openRun(projectA);
    const receiptId = await recordFinding(projectA, turnId);

    expect(
      await linkEvidence(projectA, turnId, USER_A, receiptId, fieldB),
    ).toBe("no_focal_object");
  });

  it("refuses a turn that has already finished", async () => {
    const turnId = await openRun(projectA);
    const receiptId = await recordFinding(projectA, turnId);
    await closeRun(turnId, "completed");

    expect(
      await linkEvidence(projectA, turnId, USER_A, receiptId, fieldA),
    ).toBe("not_running");
  });

  it("refuses a turn whose lease has already lapsed", async () => {
    const turnId = await openRun(projectA, { expired: true });
    const receiptId = await recordFinding(projectA, turnId);

    expect(
      await linkEvidence(projectA, turnId, USER_A, receiptId, fieldA),
    ).toBe("not_running");
  });

  it("moves an open assumption to supported on a genuine new link", async () => {
    const turnId = await openRun(projectA);
    const receiptId = await recordFinding(projectA, turnId, {
      title: "Assumption evidence",
    });
    await impersonate(USER_A);
    const assumptionId = (
      await db.query(
        `insert into assumptions (project_id, statement, status, origin)
         values ($1, 'Smaller agencies feel this most', 'open', 'ai_inferred')
         returning id`,
        [projectA],
      )
    ).rows[0].id;

    expect(
      await linkEvidence(projectA, turnId, USER_A, receiptId, assumptionId),
    ).toBe("linked");

    await impersonate(USER_A);
    const status = await db.query(
      "select status from assumptions where id = $1",
      [assumptionId],
    );
    expect(status.rows[0].status).toBe("supported");
  });

  it("never overwrites an assumption that is not open", async () => {
    const turnId = await openRun(projectA);
    const receiptId = await recordFinding(projectA, turnId, {
      title: "Resolved assumption evidence",
    });
    await impersonate(USER_A);
    const assumptionId = (
      await db.query(
        `insert into assumptions (project_id, statement, status, origin)
         values ($1, 'Already invalidated', 'invalidated', 'ai_inferred')
         returning id`,
        [projectA],
      )
    ).rows[0].id;

    expect(
      await linkEvidence(projectA, turnId, USER_A, receiptId, assumptionId),
    ).toBe("linked");

    await impersonate(USER_A);
    const status = await db.query(
      "select status from assumptions where id = $1",
      [assumptionId],
    );
    expect(status.rows[0].status).toBe("invalidated");
  });
});

describe.skipIf(skip)("evidence", () => {
  it("is not directly writable by the authenticated role", async () => {
    const turnId = await openRun(projectA);
    const receiptId = await recordFinding(projectA, turnId);

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
    const turnId = await openRun(projectA);
    const receiptId = await recordFinding(projectA, turnId);
    await linkEvidence(projectA, turnId, USER_A, receiptId, fieldA);
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
    const turnId = await openRun(projectA);
    const receiptId = await recordFinding(projectA, turnId);
    await linkEvidence(projectA, turnId, USER_A, receiptId, fieldA);
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
    const turnId = await openRun(projectA);
    const receiptId = await recordFinding(projectA, turnId, {
      title: "Cascade check",
    });
    await linkEvidence(projectA, turnId, USER_A, receiptId, fieldA);
    await impersonate(USER_A);
    const { rows } = await db.query(
      "select id from evidence where source_receipt_id = $1",
      [receiptId],
    );
    const evidenceId = rows[0].id;

    // `evidence` itself has no delete grant (only `add_evidence_link` writes
    // it) — deleting the registry row is what an owner actually can do, and
    // is exactly the path `evidence_object_fk ... on delete cascade` exists
    // to make safe.
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
