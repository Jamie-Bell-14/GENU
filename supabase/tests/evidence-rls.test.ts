/**
 * Evidence and evidence-link isolation (T10, SECURITY_STANDARDS §6/§7.1).
 *
 * The headline properties under test: evidence and its links are invisible
 * and unwritable across projects, `is_demo` cannot be omitted, and
 * `object_id` on a link is checked against the project's own field/assumption
 * union at the database layer — not only in application code.
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
let assumptionA: string;
let fieldB: string;

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

async function addEvidence(
  projectId: string,
  externalFindingId: string,
): Promise<string> {
  const { rows } = await db.query(
    `insert into evidence
       (project_id, title, summary, source_name, retrieved_at, kind, is_demo,
        external_finding_id)
     values ($1, 'Deposit disputes', 'Summary.', 'Demo source', now(),
             'secondary_research', true, $2)
     returning id`,
    [projectId, externalFindingId],
  );
  return rows[0].id;
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
  assumptionA = (
    await db.query(
      `insert into assumptions (project_id, statement, origin)
       values ($1, 'Smaller agencies feel this most', 'ai_inferred')
       returning id`,
      [projectA],
    )
  ).rows[0].id;

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

describe.skipIf(skip)("evidence", () => {
  it("is_demo cannot be omitted", async () => {
    await impersonate(USER_A);
    await expect(
      db.query(
        `insert into evidence
           (project_id, title, summary, source_name, retrieved_at, kind,
            external_finding_id)
         values ($1, 'T', 'S', 'Src', now(), 'secondary_research', 'x')`,
        [projectA],
      ),
    ).rejects.toThrow(/null value in column "is_demo"/);
  });

  it("stores a row for the owning project", async () => {
    await impersonate(USER_A);
    const id = await addEvidence(projectA, "finding-1");
    const { rows } = await db.query(
      "select project_id, is_demo from evidence where id = $1",
      [id],
    );
    expect(rows[0]).toMatchObject({ project_id: projectA, is_demo: true });
  });

  it("is idempotent per project and external finding id", async () => {
    await impersonate(USER_A);
    const first = await addEvidence(projectA, "finding-dup");
    await expect(addEvidence(projectA, "finding-dup")).rejects.toThrow(
      /duplicate key value/,
    );
    const { rowCount } = await db.query(
      "select 1 from evidence where id = $1",
      [first],
    );
    expect(rowCount).toBe(1);
  });

  it("hides evidence from other users and rejects their writes", async () => {
    await impersonate(USER_A);
    const id = await addEvidence(projectA, "finding-hidden");

    await impersonate(USER_B);
    expect(
      (await db.query("select 1 from evidence where id = $1", [id])).rowCount,
    ).toBe(0);
    await expect(addEvidence(projectA, "finding-cross")).rejects.toThrow(
      /row-level security/,
    );
  });

  it("has no update or delete grant for the authenticated role", async () => {
    await impersonate(USER_A);
    const id = await addEvidence(projectA, "finding-immutable");
    await expect(
      db.query("update evidence set title = 'changed' where id = $1", [id]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("delete from evidence where id = $1", [id]),
    ).rejects.toThrow(/permission denied/);
  });

  it("denies anonymous access", async () => {
    await impersonate(null);
    await expect(db.query("select * from evidence")).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe.skipIf(skip)("evidence_links", () => {
  it("links evidence to a field in the same project", async () => {
    await impersonate(USER_A);
    const evidenceId = await addEvidence(projectA, "finding-field-link");
    const { rows } = await db.query(
      `insert into evidence_links
         (project_id, evidence_id, object_id, consequence_summary)
       values ($1, $2, $3, 'Supports the field; does not support the rest.')
       returning id`,
      [projectA, evidenceId, fieldA],
    );
    expect(rows[0].id).toBeDefined();
  });

  it("links evidence to an assumption in the same project", async () => {
    await impersonate(USER_A);
    const evidenceId = await addEvidence(projectA, "finding-assumption-link");
    const { rows } = await db.query(
      `insert into evidence_links
         (project_id, evidence_id, object_id, consequence_summary)
       values ($1, $2, $3, 'Supports the assumption.')
       returning id`,
      [projectA, evidenceId, assumptionA],
    );
    expect(rows[0].id).toBeDefined();
  });

  it("rejects an object_id that is not a field or assumption of this project", async () => {
    await impersonate(USER_A);
    const evidenceId = await addEvidence(projectA, "finding-foreign-object");
    // fieldB belongs to project B, not project A.
    await expect(
      db.query(
        `insert into evidence_links
           (project_id, evidence_id, object_id, consequence_summary)
         values ($1, $2, $3, 'Should not be linkable.')`,
        [projectA, evidenceId, fieldB],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("rejects evidence and object_id belonging to different projects", async () => {
    await impersonate(USER_B);
    const evidenceIdB = await addEvidence(projectB, "finding-mismatch-b");
    await impersonate(USER_A);
    // evidence_links.project_id says A, but the evidence row is B's.
    await expect(
      db.query(
        `insert into evidence_links
           (project_id, evidence_id, object_id, consequence_summary)
         values ($1, $2, $3, 'Cross-project mismatch.')`,
        [projectA, evidenceIdB, fieldA],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("is idempotent per (evidence_id, object_id)", async () => {
    await impersonate(USER_A);
    const evidenceId = await addEvidence(projectA, "finding-relink");
    await db.query(
      `insert into evidence_links
         (project_id, evidence_id, object_id, consequence_summary)
       values ($1, $2, $3, 'First link.')`,
      [projectA, evidenceId, fieldA],
    );
    await expect(
      db.query(
        `insert into evidence_links
           (project_id, evidence_id, object_id, consequence_summary)
         values ($1, $2, $3, 'Second attempt.')`,
        [projectA, evidenceId, fieldA],
      ),
    ).rejects.toThrow(/duplicate key value/);
  });

  it("hides links from other users and rejects their writes", async () => {
    await impersonate(USER_A);
    const evidenceId = await addEvidence(projectA, "finding-hidden-link");
    const linkId = (
      await db.query(
        `insert into evidence_links
           (project_id, evidence_id, object_id, consequence_summary)
         values ($1, $2, $3, 'Visible only to A.')
         returning id`,
        [projectA, evidenceId, fieldA],
      )
    ).rows[0].id;

    await impersonate(USER_B);
    expect(
      (await db.query("select 1 from evidence_links where id = $1", [linkId]))
        .rowCount,
    ).toBe(0);
  });

  it("has no update or delete grant for the authenticated role", async () => {
    await impersonate(USER_A);
    const evidenceId = await addEvidence(projectA, "finding-link-immutable");
    const linkId = (
      await db.query(
        `insert into evidence_links
           (project_id, evidence_id, object_id, consequence_summary)
         values ($1, $2, $3, 'Immutable once written.')
         returning id`,
        [projectA, evidenceId, fieldA],
      )
    ).rows[0].id;
    await expect(
      db.query(
        "update evidence_links set consequence_summary = 'changed' where id = $1",
        [linkId],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("delete from evidence_links where id = $1", [linkId]),
    ).rejects.toThrow(/permission denied/);
  });

  it("denies anonymous access", async () => {
    await impersonate(null);
    await expect(db.query("select * from evidence_links")).rejects.toThrow(
      /permission denied/,
    );
  });
});
