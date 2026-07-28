/**
 * RLS isolation for conversation messages and the rate-limit function
 * (SECURITY_STANDARDS §6/§7.1/§17). Shares the harness contract with
 * rls.test.ts: a disposable database built from migrations plus the shadow
 * auth environment.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_NAME = "ppm_messages_rls_test";
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

describe.skipIf(skip)("messages RLS", () => {
  it("lets the project owner write and read their messages", async () => {
    await impersonate(USER_A);
    await db.query(
      "insert into messages (project_id, turn_id, role, content) values ($1, gen_random_uuid(), 'user', 'hello')",
      [projectA],
    );
    const read = await db.query("select content from messages");
    expect(read.rows.map((r) => r.content)).toEqual(["hello"]);
  });

  it("prevents another user reading or writing messages in that project", async () => {
    await impersonate(USER_B);
    const read = await db.query("select * from messages");
    expect(read.rowCount).toBe(0);
    await expect(
      db.query(
        "insert into messages (project_id, turn_id, role, content) values ($1, gen_random_uuid(), 'user', 'intrusion')",
        [projectA],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("keeps conversation history append-only for the owner", async () => {
    await impersonate(USER_A);
    // No UPDATE or DELETE policy exists, so both are refused outright.
    await expect(
      db.query("update messages set content = 'rewritten'"),
    ).rejects.toThrow(/permission denied|row-level security/);
    await expect(db.query("delete from messages")).rejects.toThrow(
      /permission denied|row-level security/,
    );
  });

  it("rejects roles and lengths outside the schema constraints", async () => {
    await impersonate(USER_A);
    await expect(
      db.query(
        "insert into messages (project_id, turn_id, role, content) values ($1, gen_random_uuid(), 'system', 'x')",
        [projectA],
      ),
    ).rejects.toThrow(/violates check constraint/);
    await expect(
      db.query(
        "insert into messages (project_id, turn_id, role, content) values ($1, gen_random_uuid(), 'user', $2)",
        [projectA, "x".repeat(8001)],
      ),
    ).rejects.toThrow(/violates check constraint/);
  });

  it("denies anonymous access to messages", async () => {
    await impersonate(null);
    await expect(db.query("select * from messages")).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe.skipIf(skip)("rate limiting", () => {
  it("allows attempts up to the limit, then reports a retry delay", async () => {
    await impersonate(USER_A);
    for (let i = 0; i < 3; i++) {
      const { rows } = await db.query(
        "select * from check_rate_limit('test_action', 3, 60)",
      );
      expect(rows[0].allowed).toBe(true);
    }
    const { rows } = await db.query(
      "select * from check_rate_limit('test_action', 3, 60)",
    );
    expect(rows[0].allowed).toBe(false);
    expect(rows[0].retry_after_seconds).toBeGreaterThan(0);
  });

  it("counts each user separately", async () => {
    await impersonate(USER_B);
    const { rows } = await db.query(
      "select * from check_rate_limit('test_action', 3, 60)",
    );
    expect(rows[0].allowed).toBe(true);
  });

  it("keeps counters unreadable and unforgeable by users", async () => {
    await impersonate(USER_B);
    // The table carries no grants and no policies: only the definer function
    // may touch it, so direct access fails outright rather than returning an
    // empty result. Users cannot read others' counters or forge their own.
    await expect(db.query("select * from rate_limit_events")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.query(
        "insert into rate_limit_events (user_id, action) values ($1, 'turn')",
        [USER_A],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses to run without an authenticated actor", async () => {
    await impersonate(null);
    await expect(
      db.query("select * from check_rate_limit('test_action', 3, 60)"),
    ).rejects.toThrow(/authentication required|permission denied/);
  });
});
