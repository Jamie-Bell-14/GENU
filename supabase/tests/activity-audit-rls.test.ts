/**
 * Integrity of the activity, audit and steering tables (SECURITY_STANDARDS §14,
 * docs/VERTICAL_SLICE_TASKS.md T8).
 *
 * The point of these tables is that they can be trusted after the fact, which
 * takes three properties, each proved here: another user cannot read them, an
 * ordinary browser session cannot *write* them at all — so history cannot be
 * fabricated, not merely not rewritten — and the trusted server writer can.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_NAME = "ppm_activity_rls_test";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const TURN = "33333333-3333-4333-8333-333333333333";
const OPERATION = "44444444-4444-4444-8444-444444444444";

const skip = process.env.RLS_TESTS === "skip";
const adminUrl = process.env.DATABASE_URL;

let db: Client;
let projectA: string;

/** The elevated writer: what the server-side module holds, and nothing else. */
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
  it("is written by the trusted writer and read by the owner", async () => {
    await asTrustedWriter();
    await db.query(
      `insert into activity_events
         (project_id, turn_id, operation_id, step, state)
       values ($1, $2, $3, 'reading_project_model', 'active'),
              ($1, $2, $3, 'reading_project_model', 'succeeded')`,
      [projectA, TURN, OPERATION],
    );

    await impersonate(USER_A);
    const read = await db.query(
      "select step, state from activity_events order by created_at, state",
    );
    expect(read.rows).toEqual([
      { step: "reading_project_model", state: "active" },
      { step: "reading_project_model", state: "succeeded" },
    ]);
  });

  it("cannot be written by a browser session, even the owner's", async () => {
    // This is the property append-only alone does not give: a project owner
    // must not be able to mint activity that never happened.
    await impersonate(USER_A);
    await expect(
      db.query(
        `insert into activity_events
           (project_id, turn_id, operation_id, step, state)
         values ($1, $2, $3, 'reading_project_model', 'active')`,
        [projectA, TURN, OPERATION],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("isolates activity from other users entirely", async () => {
    await impersonate(USER_B);
    expect((await db.query("select * from activity_events")).rowCount).toBe(0);
  });

  it("cannot be rewritten or erased by anyone holding a session", async () => {
    await impersonate(USER_A);
    await expect(
      db.query("update activity_events set state = 'succeeded'"),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query("delete from activity_events")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("keeps two invocations of the same step as two operations", async () => {
    // Identity is the invocation, not the step name: a turn that runs the same
    // real operation twice must not lose one of them.
    await asTrustedWriter();
    const second = "55555555-5555-4555-8555-555555555555";
    await db.query(
      `insert into activity_events
         (project_id, turn_id, operation_id, step, state)
       values ($1, $2, $3, 'considering_direction', 'succeeded'),
              ($1, $2, $4, 'considering_direction', 'failed')`,
      [projectA, TURN, OPERATION, second],
    );

    await impersonate(USER_A);
    const { rows } = await db.query(
      `select distinct operation_id from activity_events
       where step = 'considering_direction'`,
    );
    expect(rows).toHaveLength(2);
  });

  it("accepts only steps in the application's closed vocabulary", async () => {
    // The words a user reads are looked up from the catalogue on read, so an
    // unknown step cannot exist to be displayed.
    await asTrustedWriter();
    await expect(
      db.query(
        `insert into activity_events
           (project_id, turn_id, operation_id, step, state)
         values ($1, $2, $3, 'ran_advanced_reasoning', 'active')`,
        [projectA, TURN, OPERATION],
      ),
    ).rejects.toThrow(/invalid input value for enum/);
  });
});

describe.skipIf(skip)("audit_events", () => {
  it("records a consequential event against its actor and correlation id", async () => {
    await asTrustedWriter();
    await db.query(
      `insert into audit_events
         (project_id, actor_id, actor_kind, action, target, correlation_id, detail)
       values ($1, $2, 'system', 'scene_rejected', null, $3,
               '{"code": "unknown_renderer"}'::jsonb)`,
      [projectA, USER_A, TURN],
    );

    await impersonate(USER_A);
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

  it("cannot be forged from a browser session", async () => {
    // The specific attack this closes: an owner writing audit rows that
    // attribute actions to the system, or claiming actions never taken.
    await impersonate(USER_A);
    await expect(
      db.query(
        `insert into audit_events
           (project_id, actor_id, actor_kind, action, correlation_id)
         values ($1, auth.uid(), 'system', 'scene_recommended', $2)`,
        [projectA, TURN],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("isolates the audit trail from other users", async () => {
    await impersonate(USER_B);
    expect((await db.query("select * from audit_events")).rowCount).toBe(0);
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
    await asTrustedWriter();
    for (const detail of [
      '"a string"',
      "[1, 2]",
      JSON.stringify({ blob: "x".repeat(4000) }),
    ]) {
      await expect(
        db.query(
          `insert into audit_events
             (project_id, actor_id, actor_kind, action, correlation_id, detail)
           values ($1, $2, 'system', 'turn_started', $3, $4::jsonb)`,
          [projectA, USER_A, TURN, detail],
        ),
      ).rejects.toThrow(/violates check constraint/);
    }
  });

  it("rejects an action outside the closed vocabulary", async () => {
    await asTrustedWriter();
    await expect(
      db.query(
        `insert into audit_events
           (project_id, actor_id, actor_kind, action, correlation_id)
         values ($1, $2, 'user', 'granted_admin', $3)`,
        [projectA, USER_A, TURN],
      ),
    ).rejects.toThrow(/invalid input value for enum/);
  });

  it("records an object edit as a consequential change", async () => {
    await asTrustedWriter();
    await db.query(
      `insert into audit_events
         (project_id, actor_id, actor_kind, action, target, correlation_id, detail)
       values ($1, $2, 'user', 'object_edited', $3, $4,
               '{"kind": "field", "outcome": "applied"}'::jsonb)`,
      [projectA, USER_A, projectA, TURN],
    );

    await impersonate(USER_A);
    const { rows } = await db.query(
      "select action, detail from audit_events where action = 'object_edited'",
    );
    expect(rows[0].detail).toEqual({ kind: "field", outcome: "applied" });
    // The wording before and after is project content and is not stored here.
    expect(JSON.stringify(rows[0].detail)).not.toMatch(/text|value|statement/);
  });
});

describe.skipIf(skip)("turn_directions", () => {
  it("records steering with the mode promised to the user", async () => {
    await asTrustedWriter();
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

  it("cannot be written from a browser session", async () => {
    await impersonate(USER_A);
    await expect(
      db.query(
        `insert into turn_directions (project_id, turn_id, note, application)
         values ($1, $2, 'Recorded as if the system agreed.', 'applies_now')`,
        [projectA, TURN],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("is invisible to other users", async () => {
    await impersonate(USER_B);
    expect((await db.query("select * from turn_directions")).rowCount).toBe(0);
  });

  it("bounds the direction length", async () => {
    await asTrustedWriter();
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
