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
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

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

/**
 * Creates another project owned by user A.
 *
 * Only one turn per project may be running at a time (T9, issue #7 in review),
 * so a test that needs two simultaneous runs needs two projects. That is the
 * constraint working, not a test being worked around: two running turns on one
 * project is precisely the state the index exists to prevent.
 */
async function anotherProject(name: string): Promise<string> {
  await impersonate(USER_A);
  const { rows } = await db.query(
    "insert into projects (owner_id, name) values (auth.uid(), $1) returning id",
    [name],
  );
  return rows[0].id as string;
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

describe.skipIf(skip)("turn_runs", () => {
  const RUN = "66666666-6666-4666-8666-666666666666";

  it("is opened by the trusted writer and readable by the owner", async () => {
    await asTrustedWriter();
    await db.query(
      "insert into turn_runs (turn_id, project_id) values ($1, $2)",
      [RUN, projectA],
    );

    await impersonate(USER_A);
    const { rows } = await db.query(
      "select state, ended_at from turn_runs where turn_id = $1",
      [RUN],
    );
    expect(rows[0]).toEqual({ state: "running", ended_at: null });
  });

  it("cannot be created or changed from a browser session", async () => {
    // Steering and recovery read this, so a user forging it would be able to
    // reopen a finished turn or hide a running one.
    await impersonate(USER_A);
    await expect(
      db.query("insert into turn_runs (turn_id, project_id) values ($1, $2)", [
        "77777777-7777-4777-8777-777777777777",
        projectA,
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("update turn_runs set state = 'running'"),
    ).rejects.toThrow(/permission denied/);
  });

  it("records exactly one terminal state", async () => {
    await asTrustedWriter();
    const first = await db.query(
      `update turn_runs set state = 'completed', ended_at = now()
       where turn_id = $1 and state = 'running'`,
      [RUN],
    );
    expect(first.rowCount).toBe(1);

    // A second terminal write finds no running row and changes nothing.
    const second = await db.query(
      `update turn_runs set state = 'failed', ended_at = now()
       where turn_id = $1 and state = 'running'`,
      [RUN],
    );
    expect(second.rowCount).toBe(0);

    const { rows } = await db.query(
      "select state from turn_runs where turn_id = $1",
      [RUN],
    );
    expect(rows[0].state).toBe("completed");
  });

  it("refuses a terminal state without an end time, and the reverse", async () => {
    await asTrustedWriter();
    await expect(
      db.query(
        "insert into turn_runs (turn_id, project_id, state) values ($1, $2, 'completed')",
        ["88888888-8888-4888-8888-888888888888", projectA],
      ),
    ).rejects.toThrow(/turn_runs_terminal_has_end/);
    await expect(
      db.query(
        `insert into turn_runs (turn_id, project_id, state, ended_at)
         values ($1, $2, 'running', now())`,
        ["99999999-9999-4999-8999-999999999999", projectA],
      ),
    ).rejects.toThrow(/turn_runs_terminal_has_end/);
  });

  it("is invisible to other users", async () => {
    await impersonate(USER_B);
    expect((await db.query("select * from turn_runs")).rowCount).toBe(0);
  });
});

describe.skipIf(skip)("the steering window", () => {
  const OPEN = "aaaaaaaa-0000-4000-8000-00000000000a";
  const SEALED = "aaaaaaaa-0000-4000-8000-00000000000b";
  /** Each running turn needs its own project; see `anotherProject`. */
  let openProject: string;
  let sealedProject: string;

  beforeAll(async () => {
    openProject = await anotherProject("steering-open");
    sealedProject = await anotherProject("steering-sealed");
    await asTrustedWriter();
    await db.query(
      `insert into turn_runs (turn_id, project_id)
       values ($1, $3), ($2, $4)`,
      [OPEN, SEALED, openProject, sealedProject],
    );
  });

  it("accepts a direction inserted before the window is sealed", async () => {
    await asTrustedWriter();
    const accepted = await db.query(
      "select public.accept_turn_direction($1, $2, $3, 'next_step') as outcome",
      [openProject, OPEN, "Before the seal."],
    );
    expect(accepted.rows[0].outcome).toBe("accepted");

    // Sealing at the final boundary returns exactly what was inserted first.
    const taken = await db.query(
      "select note from public.take_turn_directions($1, $2, $3, $4, true)",
      [openProject, OPEN, new Date(0).toISOString(), NIL_UUID],
    );
    expect(taken.rows.map((row) => row.note)).toEqual(["Before the seal."]);
  });

  it("refuses a direction once the window has been sealed", async () => {
    await asTrustedWriter();
    // The final boundary passes with nothing pending.
    await db.query(
      "select * from public.take_turn_directions($1, $2, $3, $4, true)",
      [sealedProject, SEALED, new Date(0).toISOString(), NIL_UUID],
    );

    const refused = await db.query(
      "select public.accept_turn_direction($1, $2, $3, 'next_step') as outcome",
      [sealedProject, SEALED, "After the seal."],
    );
    // The run is still 'running' — finalisation has not happened yet — but
    // there is no step left to consume this, so it is not accepted.
    expect(refused.rows[0].outcome).toBe("closed");
    expect(
      (
        await db.query("select 1 from turn_directions where turn_id = $1", [
          SEALED,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it("refuses a direction for a finished or foreign turn", async () => {
    await asTrustedWriter();
    await db.query(
      `update turn_runs set state = 'completed', ended_at = now()
       where turn_id = $1`,
      [OPEN],
    );
    const finished = await db.query(
      "select public.accept_turn_direction($1, $2, $3, 'next_step') as outcome",
      [openProject, OPEN, "Too late."],
    );
    expect(finished.rows[0].outcome).toBe("finished");

    const foreign = await db.query(
      "select public.accept_turn_direction($1, $2, $3, 'next_step') as outcome",
      [projectA, "cccccccc-0000-4000-8000-00000000000c", "Not ours."],
    );
    expect(foreign.rows[0].outcome).toBe("unknown");
  });

  it("refuses a direction once the run's lease has expired", async () => {
    // Its own project: an expired lease is still `state = 'running'`, so it
    // occupies the project's single running slot.
    const project = await anotherProject("lease-expired");
    await asTrustedWriter();
    const expired = "aaaaaaaa-0000-4000-8000-00000000000e";
    await db.query(
      `insert into turn_runs (turn_id, project_id, lease_expires_at)
       values ($1, $2, now() - interval '1 minute')`,
      [expired, project],
    );
    const refused = await db.query(
      "select public.accept_turn_direction($1, $2, $3, 'next_step') as outcome",
      [project, expired, "The worker is gone."],
    );
    expect(refused.rows[0].outcome).toBe("expired");
  });

  it("reports an expired run as expired, with its result if any", async () => {
    const project = await anotherProject("expired-snapshot");
    await asTrustedWriter();
    const expired = "aaaaaaaa-0000-4000-8000-00000000000f";
    await db.query(
      `insert into turn_runs (turn_id, project_id, lease_expires_at)
       values ($1, $2, now() - interval '1 minute')`,
      [expired, project],
    );

    await impersonate(USER_A);
    const { rows } = await db.query(
      "select state, message_id from public.turn_snapshot($1, $2)",
      [project, expired],
    );
    expect(rows[0]).toEqual({ state: "expired", message_id: null });
  });

  it("returns state and result from one snapshot", async () => {
    await impersonate(USER_A);
    const turnId = "aaaaaaaa-0000-4000-8000-000000000010";
    await db.query(
      `insert into messages (id, project_id, turn_id, role, content)
       values ($1, $2, $1, 'assistant', 'The answer.')`,
      [turnId, projectA],
    );
    await asTrustedWriter();
    await db.query(
      `insert into turn_runs (turn_id, project_id, state, ended_at)
       values ($1, $2, 'completed', now())`,
      [turnId, projectA],
    );

    await impersonate(USER_A);
    const { rows } = await db.query(
      "select state, message_content from public.turn_snapshot($1, $2)",
      [projectA, turnId],
    );
    expect(rows[0]).toEqual({
      state: "completed",
      message_content: "The answer.",
    });
  });

  it("returns every accepted direction at the sealing read", async () => {
    /*
      More directions can be accepted than an arbitrary read cap would return.
      Anything left behind would be a direction the user was explicitly
      promised would apply, silently stranded.
    */
    const project = await anotherProject("sealing-read");
    await asTrustedWriter();
    const turnId = "aaaaaaaa-0000-4000-8000-000000000011";
    await db.query(
      "insert into turn_runs (turn_id, project_id) values ($1, $2)",
      [turnId, project],
    );

    for (let index = 0; index < 15; index += 1) {
      const { rows } = await db.query(
        "select public.accept_turn_direction($1, $2, $3, 'next_step') as outcome",
        [project, turnId, `Direction ${index}`],
      );
      expect(rows[0].outcome).toBe("accepted");
    }

    /*
      `created_at::text` keeps the timestamp's microseconds through the driver.
      A cursor that loses precision re-delivers a row rather than skipping one,
      which is the safe direction, but the test should exercise the exact
      round-trip the application makes.
    */
    const taken = await db.query(
      "select id, note, created_at::text as created_at from public.take_turn_directions($1, $2, $3, $4, true)",
      [project, turnId, new Date(0).toISOString(), NIL_UUID],
    );
    expect(taken.rows).toHaveLength(15);

    // Consumed exactly once: resuming from the last row it returned yields
    // nothing more.
    const last = taken.rows[taken.rows.length - 1];
    const again = await db.query(
      "select note from public.take_turn_directions($1, $2, $3, $4, false)",
      [project, turnId, last.created_at, last.id],
    );
    expect(again.rows).toEqual([]);
  });

  it("refuses a direction beyond the per-turn bound, before promising anything", async () => {
    const project = await anotherProject("per-turn-bound");
    await asTrustedWriter();
    const turnId = "aaaaaaaa-0000-4000-8000-000000000012";
    await db.query(
      "insert into turn_runs (turn_id, project_id) values ($1, $2)",
      [turnId, project],
    );

    /*
      The bound is application-owned, so the test reads it rather than
      hard-coding a number that could drift from the migration. Read with the
      superuser role: `private` is not granted to the API roles, which is
      itself the point of putting it there.
    */
    await db.query("reset role");
    const bound = (
      await db.query("select private.max_directions_per_turn() as bound")
    ).rows[0].bound as number;
    await asTrustedWriter();
    for (let index = 0; index < bound; index += 1) {
      await db.query(
        "select public.accept_turn_direction($1, $2, $3, 'next_step') as outcome",
        [project, turnId, `Direction ${index}`],
      );
    }

    const refused = await db.query(
      "select public.accept_turn_direction($1, $2, $3, 'next_step') as outcome",
      [project, turnId, "One too many"],
    );
    expect(refused.rows[0].outcome).toBe("too_many");
    // Refused before the row exists, so nothing was accepted and stranded.
    expect(
      (
        await db.query(
          "select count(*)::int as total from turn_directions where turn_id = $1",
          [turnId],
        )
      ).rows[0].total,
    ).toBe(bound);
  });

  it("leaves the window open when no sealing read happened", async () => {
    const project = await anotherProject("window-open");
    /*
      The reason a failed read must not be treated as "sealed": nothing has
      changed, so the endpoint would still accept a direction the turn can no
      longer consume.
    */
    await asTrustedWriter();
    const turnId = "aaaaaaaa-0000-4000-8000-000000000013";
    await db.query(
      "insert into turn_runs (turn_id, project_id) values ($1, $2)",
      [turnId, project],
    );
    const { rows } = await db.query(
      "select accepting_direction from turn_runs where turn_id = $1",
      [turnId],
    );
    expect(rows[0].accepting_direction).toBe(true);
    expect(
      (
        await db.query(
          "select public.accept_turn_direction($1, $2, $3, 'next_step') as outcome",
          [project, turnId, "Still open"],
        )
      ).rows[0].outcome,
    ).toBe("accepted");
  });

  it("uses a stable cursor so rows sharing a timestamp are not skipped", async () => {
    const project = await anotherProject("stable-cursor");
    await asTrustedWriter();
    const turnId = "aaaaaaaa-0000-4000-8000-000000000014";
    await db.query(
      "insert into turn_runs (turn_id, project_id) values ($1, $2)",
      [turnId, project],
    );
    // Three rows with an identical timestamp: a timestamp-only cursor would
    // skip the ones sharing the last returned value.
    const stamp = new Date().toISOString();
    await db.query(
      `insert into turn_directions (project_id, turn_id, note, application, created_at)
       values ($1, $2, 'one', 'next_step', $3),
              ($1, $2, 'two', 'next_step', $3),
              ($1, $2, 'three', 'next_step', $3)`,
      [project, turnId, stamp],
    );

    const first = await db.query(
      "select id, note, created_at::text as created_at from public.take_turn_directions($1, $2, $3, $4, false)",
      [project, turnId, new Date(0).toISOString(), NIL_UUID],
    );
    expect(first.rows).toHaveLength(3);

    // Resuming after the first row returns exactly the remaining two — a
    // timestamp-only cursor would have skipped both, since all three share it.
    const rest = await db.query(
      "select note from public.take_turn_directions($1, $2, $3, $4, false)",
      [project, turnId, first.rows[0].created_at, first.rows[0].id],
    );
    expect(rest.rows.map((row) => row.note)).toEqual(
      first.rows.slice(1).map((row) => row.note),
    );
  });

  it("does not show another user's turn through the snapshot", async () => {
    await impersonate(USER_B);
    const { rows } = await db.query(
      "select * from public.turn_snapshot($1, $2)",
      [sealedProject, SEALED],
    );
    expect(rows).toEqual([]);
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
