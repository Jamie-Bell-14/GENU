/**
 * Two-user RLS isolation suite (SECURITY_STANDARDS §6/§7.1).
 *
 * Runs against a disposable database created from supabase/migrations plus
 * the shadow auth environment. Requires DATABASE_URL with superuser rights
 * (local Postgres or the CI service container); the suite fails fast when it
 * is missing so CI can never silently skip it — set RLS_TESTS=skip to opt
 * out explicitly (e.g. on a machine with no Postgres).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_NAME = "ppm_rls_test";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

const skip = process.env.RLS_TESTS === "skip";
const adminUrl = process.env.DATABASE_URL;

function testDbUrl(base: string): string {
  const url = new URL(base);
  url.pathname = `/${DB_NAME}`;
  return url.toString();
}

let db: Client;

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

async function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
  await db.query("reset role");
  try {
    return await fn();
  } finally {
    await db.query("reset role");
  }
}

describe.skipIf(skip)("projects RLS", () => {
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

    db = new Client({ connectionString: testDbUrl(adminUrl) });
    await db.connect();
    const dir = path.join(__dirname, "..");
    await db.query(
      readFileSync(path.join(dir, "tests/shadow-auth.sql"), "utf8"),
    );
    const migrations = readdirSync(path.join(dir, "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(migrations.length).toBeGreaterThan(0);
    for (const file of migrations) {
      await db.query(readFileSync(path.join(dir, "migrations", file), "utf8"));
    }
    await db.query(
      "insert into auth.users (id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')",
      [USER_A, USER_B],
    );
  }, 30_000);

  afterAll(async () => {
    await db?.end();
  });

  it("lets an owner create and read their own project", async () => {
    await impersonate(USER_A);
    const inserted = await db.query(
      "insert into projects (owner_id, name) values (auth.uid(), 'Project A') returning id, owner_id",
    );
    expect(inserted.rows[0].owner_id).toBe(USER_A);
    const read = await db.query("select name from projects");
    expect(read.rows.map((r) => r.name)).toEqual(["Project A"]);
  });

  it("rejects inserting a project owned by someone else (mass assignment)", async () => {
    await impersonate(USER_A);
    await expect(
      db.query("insert into projects (owner_id, name) values ($1, 'Forged')", [
        USER_B,
      ]),
    ).rejects.toThrow(/row-level security/);
  });

  it("hides other users' projects from reads", async () => {
    await impersonate(USER_B);
    const read = await db.query("select * from projects");
    expect(read.rowCount).toBe(0);
  });

  it("blocks cross-user updates and deletes silently (no existence leak)", async () => {
    await impersonate(USER_A);
    const { rows } = await db.query("select id from projects limit 1");
    const projectId = rows[0].id;

    await impersonate(USER_B);
    const update = await db.query(
      "update projects set name = 'Taken over' where id = $1",
      [projectId],
    );
    expect(update.rowCount).toBe(0);
    const del = await db.query("delete from projects where id = $1", [
      projectId,
    ]);
    expect(del.rowCount).toBe(0);
    // Existence inference: a real-but-foreign id and a nonexistent id look
    // identical to the caller.
    const foreign = await db.query("select * from projects where id = $1", [
      projectId,
    ]);
    const absent = await db.query("select * from projects where id = $1", [
      "33333333-3333-4333-8333-333333333333",
    ]);
    expect(foreign.rowCount).toBe(absent.rowCount);
  });

  it("lets the owner update their project but never its ownership", async () => {
    await impersonate(USER_A);
    const renamed = await db.query(
      "update projects set name = 'Renamed' where name = 'Project A' returning name",
    );
    expect(renamed.rows[0].name).toBe("Renamed");
    await expect(
      db.query("update projects set owner_id = $1 where name = 'Renamed'", [
        USER_B,
      ]),
    ).rejects.toThrow(/ownership cannot be changed|row-level security/);
  });

  it("denies anonymous access entirely", async () => {
    await impersonate(null);
    await expect(db.query("select * from projects")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("scopes private.is_project_owner to the calling user", async () => {
    const projectId = await asAdmin(async () => {
      const { rows } = await db.query("select id from projects limit 1");
      return rows[0].id as string;
    });
    await impersonate(USER_A);
    const own = await db.query("select private.is_project_owner($1) as ok", [
      projectId,
    ]);
    expect(own.rows[0].ok).toBe(true);
    await impersonate(USER_B);
    const foreign = await db.query(
      "select private.is_project_owner($1) as ok",
      [projectId],
    );
    expect(foreign.rows[0].ok).toBe(false);
  });
});
