/**
 * Identity registry and relationship isolation
 * (SECURITY_STANDARDS §6/§7.1, docs/ADAPTIVE_CANVAS_MVP.md §5).
 *
 * The headline property under test is that cross-project relationships are
 * impossible at the database level, not merely discouraged in application code.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_NAME = "ppm_relationships_rls_test";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

const skip = process.env.RLS_TESTS === "skip";
const adminUrl = process.env.DATABASE_URL;

let db: Client;
let projectA: string;
let projectB: string;
let problemA: string;
let causeA: string;
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
  problemA = await addField(projectA, "problem_statement");
  causeA = await addField(projectA, "possible_cause");

  await impersonate(USER_B);
  projectB = (
    await db.query(
      "insert into projects (owner_id, name) values (auth.uid(), 'B') returning id",
    )
  ).rows[0].id;
  fieldB = await addField(projectB, "problem_statement");
}, 30_000);

afterAll(async () => {
  await db?.end();
});

describe.skipIf(skip)("project object identity", () => {
  it("registers every project field in the identity registry", async () => {
    await impersonate(USER_A);
    const { rows } = await db.query(
      "select kind, project_id from project_objects where id = $1",
      [problemA],
    );
    expect(rows[0]).toMatchObject({ kind: "field", project_id: projectA });
  });

  it("registers assumptions under the same identity space", async () => {
    await impersonate(USER_A);
    const { rows } = await db.query(
      `insert into assumptions (project_id, statement, origin)
       values ($1, 'Smaller agencies feel this most', 'ai_inferred')
       returning id`,
      [projectA],
    );
    const registered = await db.query(
      "select kind from project_objects where id = $1",
      [rows[0].id],
    );
    expect(registered.rows[0].kind).toBe("assumption");
  });

  it("removes identity when the underlying object is deleted", async () => {
    await impersonate(USER_A);
    const temporary = await addField(projectA, "temporary");
    await db.query("delete from project_fields where id = $1", [temporary]);
    const { rowCount } = await db.query(
      "select 1 from project_objects where id = $1",
      [temporary],
    );
    expect(rowCount).toBe(0);
  });

  it("isolates the registry between users", async () => {
    await impersonate(USER_B);
    const { rowCount } = await db.query(
      "select 1 from project_objects where id = $1",
      [problemA],
    );
    expect(rowCount).toBe(0);
  });
});

describe.skipIf(skip)("relationship integrity", () => {
  it("stores a relationship between two objects in the same project", async () => {
    await impersonate(USER_A);
    const { rows } = await db.query(
      `insert into project_relationships
         (project_id, from_object_id, to_object_id, relation, origin, support)
       values ($1, $2, $3, 'possible_cause_of', 'ai_inferred', 'hypothesis')
       returning id, relation, origin`,
      [projectA, causeA, problemA],
    );
    expect(rows[0]).toMatchObject({
      relation: "possible_cause_of",
      origin: "ai_inferred",
    });
  });

  it("makes a cross-project relationship structurally impossible", async () => {
    await impersonate(USER_A);
    // Endpoint belongs to user B's project: the composite foreign key rejects
    // it before RLS is even consulted.
    await expect(
      db.query(
        `insert into project_relationships
           (project_id, from_object_id, to_object_id, relation, origin)
         values ($1, $2, $3, 'affects', 'ai_inferred')`,
        [projectA, problemA, fieldB],
      ),
    ).rejects.toThrow(/violates foreign key constraint/);
  });

  it("rejects relationship types outside the closed vocabulary", async () => {
    await impersonate(USER_A);
    await expect(
      db.query(
        `insert into project_relationships
           (project_id, from_object_id, to_object_id, relation, origin)
         values ($1, $2, $3, 'looks_related_to', 'ai_inferred')`,
        [projectA, problemA, causeA],
      ),
    ).rejects.toThrow(/invalid input value for enum/);
  });

  it("rejects self-referencing and duplicate relationships", async () => {
    await impersonate(USER_A);
    await expect(
      db.query(
        `insert into project_relationships
           (project_id, from_object_id, to_object_id, relation, origin)
         values ($1, $2, $2, 'affects', 'ai_inferred')`,
        [projectA, problemA],
      ),
    ).rejects.toThrow(/no_self_loop/);

    await expect(
      db.query(
        `insert into project_relationships
           (project_id, from_object_id, to_object_id, relation, origin)
         values ($1, $2, $3, 'possible_cause_of', 'user_stated')`,
        [projectA, causeA, problemA],
      ),
    ).rejects.toThrow(/duplicate key value/);
  });

  it("requires an explicit origin so provenance cannot be lost", async () => {
    await impersonate(USER_A);
    await expect(
      db.query(
        `insert into project_relationships
           (project_id, from_object_id, to_object_id, relation)
         values ($1, $2, $3, 'affects')`,
        [projectA, problemA, causeA],
      ),
    ).rejects.toThrow(/null value in column "origin"/);
  });

  it("hides relationships from other users and rejects their writes", async () => {
    await impersonate(USER_B);
    expect(
      (await db.query("select * from project_relationships")).rowCount,
    ).toBe(0);
    await expect(
      db.query(
        `insert into project_relationships
           (project_id, from_object_id, to_object_id, relation, origin)
         values ($1, $2, $3, 'affects', 'ai_inferred')`,
        [projectA, problemA, causeA],
      ),
    ).rejects.toThrow(/row-level security|foreign key constraint/);
    expect(
      (await db.query("update project_relationships set support = 'credible'"))
        .rowCount,
    ).toBe(0);
    expect((await db.query("delete from project_relationships")).rowCount).toBe(
      0,
    );
  });

  it("cascades relationship removal when an endpoint is deleted", async () => {
    await impersonate(USER_A);
    const before = await db.query(
      "select count(*)::int from project_relationships",
    );
    expect(before.rows[0].count).toBeGreaterThan(0);
    await db.query("delete from project_fields where id = $1", [causeA]);
    const after = await db.query(
      "select count(*)::int from project_relationships",
    );
    expect(after.rows[0].count).toBe(0);
  });

  it("denies anonymous access to identity and relationships", async () => {
    await impersonate(null);
    await expect(db.query("select * from project_objects")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.query("select * from project_relationships"),
    ).rejects.toThrow(/permission denied/);
  });
});
