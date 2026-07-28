/**
 * RLS isolation for the project model tables (SECURITY_STANDARDS §6/§7.1).
 * Child tables authorise through private.is_project_owner(), so this proves
 * the helper actually gates them.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_NAME = "ppm_model_rls_test";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

const skip = process.env.RLS_TESTS === "skip";
const adminUrl = process.env.DATABASE_URL;

let db: Client;
let projectA: string;

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
  const { rows } = await db.query(
    "insert into projects (owner_id, name) values (auth.uid(), 'A') returning id",
  );
  projectA = rows[0].id;
}, 30_000);

afterAll(async () => {
  await db?.end();
});

describe.skipIf(skip)("project_fields RLS", () => {
  it("lets the owner write and read their model fields", async () => {
    await impersonate(USER_A);
    await db.query(
      `insert into project_fields (project_id, area, key, label, value, origin, support)
       values ($1, 'problem', 'statement', 'Problem', 'Condition disputes', 'user_stated', 'hypothesis')`,
      [projectA],
    );
    const read = await db.query("select label, support from project_fields");
    expect(read.rows).toEqual([{ label: "Problem", support: "hypothesis" }]);
  });

  it("isolates fields from other users entirely", async () => {
    await impersonate(USER_B);
    expect((await db.query("select * from project_fields")).rowCount).toBe(0);
    await expect(
      db.query(
        `insert into project_fields (project_id, area, key, label, value, origin)
         values ($1, 'problem', 'intrusion', 'X', 'Y', 'user_stated')`,
        [projectA],
      ),
    ).rejects.toThrow(/row-level security/);
    expect(
      (await db.query("update project_fields set value = 'tampered'")).rowCount,
    ).toBe(0);
    expect((await db.query("delete from project_fields")).rowCount).toBe(0);
  });

  it("rejects values outside the closed enums", async () => {
    await impersonate(USER_A);
    await expect(
      db.query(
        `insert into project_fields (project_id, area, key, label, value, origin)
         values ($1, 'unknown_area', 'k', 'L', 'V', 'user_stated')`,
        [projectA],
      ),
    ).rejects.toThrow(/invalid input value for enum/);
    await expect(
      db.query(
        `insert into project_fields (project_id, area, key, label, value, origin, support)
         values ($1, 'customer', 'k', 'L', 'V', 'user_stated', 'certain')`,
        [projectA],
      ),
    ).rejects.toThrow(/invalid input value for enum/);
  });

  it("keeps one row per area and key", async () => {
    await impersonate(USER_A);
    await expect(
      db.query(
        `insert into project_fields (project_id, area, key, label, value, origin)
         values ($1, 'problem', 'statement', 'Duplicate', 'V', 'ai_inferred')`,
        [projectA],
      ),
    ).rejects.toThrow(/duplicate key value/);
  });
});

describe.skipIf(skip)("assumptions RLS", () => {
  it("lets the owner record and update an assumption", async () => {
    await impersonate(USER_A);
    await db.query(
      `insert into assumptions (project_id, statement, origin, status)
       values ($1, 'Smaller agencies feel this most', 'ai_inferred', 'open')`,
      [projectA],
    );
    const updated = await db.query(
      "update assumptions set status = 'weakened' returning status",
    );
    expect(updated.rows[0].status).toBe("weakened");
  });

  it("isolates assumptions from other users", async () => {
    await impersonate(USER_B);
    expect((await db.query("select * from assumptions")).rowCount).toBe(0);
    await expect(
      db.query(
        `insert into assumptions (project_id, statement, origin)
         values ($1, 'Injected', 'ai_inferred')`,
        [projectA],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("denies anonymous access to the whole model", async () => {
    await impersonate(null);
    await expect(db.query("select * from project_fields")).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.query("select * from assumptions")).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe.skipIf(skip)("assumption presentation data", () => {
  it("stores alternatives and recommended validation", async () => {
    await impersonate(USER_A);
    const { rows } = await db.query(
      `insert into assumptions
         (project_id, statement, origin, alternatives, recommended_validation)
       values ($1, 'Agencies feel this most', 'ai_inferred',
               '["Settled informally", "Only without records"]'::jsonb,
               'Ask five agents')
       returning alternatives, recommended_validation`,
      [projectA],
    );
    expect(rows[0].alternatives).toEqual([
      "Settled informally",
      "Only without records",
    ]);
    expect(rows[0].recommended_validation).toBe("Ask five agents");
  });

  it("rejects malformed alternatives so the renderer cannot receive them", async () => {
    await impersonate(USER_A);
    for (const bad of ['{"a": 1}', "[1, 2]", '"text"']) {
      await expect(
        db.query(
          `insert into assumptions (project_id, statement, origin, alternatives)
           values ($1, 'Bad shape', 'ai_inferred', $2::jsonb)`,
          [projectA, bad],
        ),
      ).rejects.toThrow(/alternatives_is_string_array/);
    }
  });

  it("bounds the recommended validation length", async () => {
    await impersonate(USER_A);
    await expect(
      db.query(
        `insert into assumptions
           (project_id, statement, origin, recommended_validation)
         values ($1, 'Too long', 'ai_inferred', $2)`,
        [projectA, "x".repeat(501)],
      ),
    ).rejects.toThrow(/violates check constraint/);
  });
});

describe.skipIf(skip)("editing project text", () => {
  it("lets the owner rewrite a field value", async () => {
    await impersonate(USER_A);
    const { rowCount } = await db.query(
      `update project_fields
       set value = 'Revised wording', origin = 'user_stated'
       where area = 'problem' and key = 'statement'`,
    );
    expect(rowCount).toBe(1);
  });

  it("prevents another user rewriting it", async () => {
    await impersonate(USER_B);
    const { rowCount } = await db.query(
      "update project_fields set value = 'Tampered'",
    );
    expect(rowCount).toBe(0);
  });

  it("still enforces the length constraint on an edit", async () => {
    await impersonate(USER_A);
    await expect(
      db.query("update project_fields set value = $1", ["x".repeat(2001)]),
    ).rejects.toThrow(/violates check constraint/);
  });
});
