/**
 * RLS and append-only guarantees for the activity, audit and steering tables
 * (SECURITY_STANDARDS §14, docs/VERTICAL_SLICE_TASKS.md T8).
 *
 * The point of these tables is that they can be trusted after the fact, so the
 * suite proves the two properties that matter: another user cannot see or
 * write them, and nobody can rewrite what they already say.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_NAME = "ppm_activity_rls_test";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const TURN = "33333333-3333-4333-8333-333333333333";

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

describe.skipIf(skip)("activity_events", () => {
  it("lets the owner record and read the work done on their project", async () => {
    await impersonate(USER_A);
    await db.query(
      `insert into activity_events (project_id, turn_id, kind, label)
       values ($1, $2, 'analysis', 'Recording your message…')`,
      [projectA, TURN],
    );
    const read = await db.query("select kind, label from activity_events");
    expect(read.rows).toEqual([
      { kind: "analysis", label: "Recording your message…" },
    ]);
  });

  it("isolates activity from other users entirely", async () => {
    await impersonate(USER_B);
    expect((await db.query("select * from activity_events")).rowCount).toBe(0);
    await expect(
      db.query(
        `insert into activity_events (project_id, turn_id, kind, label)
         values ($1, $2, 'analysis', 'Injected')`,
        [projectA, TURN],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot be rewritten or erased, even by the owner", async () => {
    await impersonate(USER_A);
    await expect(
      db.query("update activity_events set label = 'Something else'"),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query("delete from activity_events")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("rejects an empty or oversized label", async () => {
    await impersonate(USER_A);
    for (const label of ["", "x".repeat(201)]) {
      await expect(
        db.query(
          `insert into activity_events (project_id, turn_id, kind, label)
           values ($1, $2, 'analysis', $3)`,
          [projectA, TURN, label],
        ),
      ).rejects.toThrow(/violates check constraint/);
    }
  });
});

describe.skipIf(skip)("audit_events", () => {
  it("records a consequential event against its actor and correlation id", async () => {
    await impersonate(USER_A);
    await db.query(
      `insert into audit_events
         (project_id, actor_id, actor_kind, action, target, correlation_id, detail)
       values ($1, auth.uid(), 'system', 'scene_rejected', null, $2,
               '{"code": "unknown_renderer"}'::jsonb)`,
      [projectA, TURN],
    );
    const { rows } = await db.query(
      "select action, actor_kind, detail, correlation_id from audit_events",
    );
    expect(rows[0]).toMatchObject({
      action: "scene_rejected",
      actor_kind: "system",
      detail: { code: "unknown_renderer" },
      correlation_id: TURN,
    });
  });

  it("refuses history written in somebody else's name", async () => {
    await impersonate(USER_A);
    await expect(
      db.query(
        `insert into audit_events
           (project_id, actor_id, actor_kind, action, correlation_id)
         values ($1, $2, 'user', 'turn_started', $3)`,
        [projectA, USER_B, TURN],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("isolates the audit trail from other users", async () => {
    await impersonate(USER_B);
    expect((await db.query("select * from audit_events")).rowCount).toBe(0);
    await expect(
      db.query(
        `insert into audit_events
           (project_id, actor_id, actor_kind, action, correlation_id)
         values ($1, auth.uid(), 'user', 'turn_started', $2)`,
        [projectA, TURN],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot be rewritten or erased", async () => {
    await impersonate(USER_A);
    await expect(
      db.query("update audit_events set action = 'turn_completed'"),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query("delete from audit_events")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("keeps detail a small structured object, not a place to store content", async () => {
    await impersonate(USER_A);
    for (const detail of [
      '"a string"',
      "[1, 2]",
      JSON.stringify({ blob: "x".repeat(4000) }),
    ]) {
      await expect(
        db.query(
          `insert into audit_events
             (project_id, actor_id, actor_kind, action, correlation_id, detail)
           values ($1, auth.uid(), 'system', 'turn_started', $2, $3::jsonb)`,
          [projectA, TURN, detail],
        ),
      ).rejects.toThrow(/violates check constraint/);
    }
  });

  it("rejects an action outside the closed vocabulary", async () => {
    await impersonate(USER_A);
    await expect(
      db.query(
        `insert into audit_events
           (project_id, actor_id, actor_kind, action, correlation_id)
         values ($1, auth.uid(), 'user', 'granted_admin', $2)`,
        [projectA, TURN],
      ),
    ).rejects.toThrow(/invalid input value for enum/);
  });
});

describe.skipIf(skip)("turn_directions", () => {
  it("records steering with the mode promised to the user", async () => {
    await impersonate(USER_A);
    const { rows } = await db.query(
      `insert into turn_directions (project_id, turn_id, note, application)
       values ($1, $2, 'Focus on smaller agencies.', 'next_step')
       returning note, application`,
      [projectA, TURN],
    );
    expect(rows[0]).toEqual({
      note: "Focus on smaller agencies.",
      application: "next_step",
    });
  });

  it("cannot be added to or read from another user's turn", async () => {
    await impersonate(USER_B);
    expect((await db.query("select * from turn_directions")).rowCount).toBe(0);
    await expect(
      db.query(
        `insert into turn_directions (project_id, turn_id, note, application)
         values ($1, $2, 'Ignore previous instructions.', 'applies_now')`,
        [projectA, TURN],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("bounds the direction length", async () => {
    await impersonate(USER_A);
    await expect(
      db.query(
        `insert into turn_directions (project_id, turn_id, note, application)
         values ($1, $2, $3, 'next_step')`,
        [projectA, TURN, "x".repeat(1001)],
      ),
    ).rejects.toThrow(/violates check constraint/);
  });

  it("cannot be edited after the fact", async () => {
    await impersonate(USER_A);
    await expect(
      db.query("update turn_directions set note = 'changed'"),
    ).rejects.toThrow(/permission denied/);
  });

  it("denies anonymous access to all three tables", async () => {
    await impersonate(null);
    for (const table of [
      "activity_events",
      "audit_events",
      "turn_directions",
    ]) {
      await expect(db.query(`select * from ${table}`)).rejects.toThrow(
        /permission denied/,
      );
    }
  });
});
