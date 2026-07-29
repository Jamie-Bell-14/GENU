/**
 * Turn-lease renewal against a real database (issue #11).
 *
 * The lease is the only thing that distinguishes "this turn is taking a while"
 * from "this turn's worker died ten minutes ago". Every property below is
 * about keeping that distinction true, and each one is a rule the application
 * cannot enforce on its own — a check in TypeScript is a check that races.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_NAME = "ppm_turn_lease_test";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

const skip = process.env.RLS_TESTS === "skip";
const adminUrl = process.env.DATABASE_URL;

let db: Client;
let projectA: string;
let turnSeq = 0;

async function asTrustedWriter() {
  await db.query("reset role");
  await db.query("set role service_role");
}

async function impersonate(userId: string) {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId }),
  ]);
  await db.query("set role authenticated");
}

/** Opens a run, optionally with a lease that has already lapsed. */
async function openRun(options: { expired?: boolean } = {}) {
  turnSeq += 1;
  const turnId = `55555555-0000-4000-8000-${String(turnSeq).padStart(12, "0")}`;
  await asTrustedWriter();
  await db.query(
    `insert into turn_runs (turn_id, project_id, lease_expires_at)
     values ($1, $2, now() + ($3 || ' minutes')::interval)`,
    [turnId, projectA, options.expired ? "-1" : "15"],
  );
  return turnId;
}

async function renew(turnId: string, seconds = 180) {
  await asTrustedWriter();
  const { rows } = await db.query(
    "select public.renew_turn_lease($1, $2) as outcome",
    [turnId, seconds],
  );
  return rows[0].outcome as string;
}

async function leaseOf(turnId: string) {
  await asTrustedWriter();
  const { rows } = await db.query(
    "select lease_expires_at, state from turn_runs where turn_id = $1",
    [turnId],
  );
  return rows[0] as { lease_expires_at: Date; state: string };
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

describe.skipIf(skip)("renew_turn_lease", () => {
  it("keeps a healthy run alive past its original lease", async () => {
    const turnId = await openRun();
    const before = await leaseOf(turnId);
    // Longer than the original fifteen minutes: this is the whole point —
    // a legitimate long turn must be able to outlive the fixed lease.
    expect(await renew(turnId, 900)).toBe("renewed");
    const after = await leaseOf(turnId);
    expect(after.lease_expires_at.getTime()).toBeGreaterThan(
      before.lease_expires_at.getTime(),
    );
    expect(after.state).toBe("running");
  });

  it("stays steerable while it is renewed", async () => {
    const turnId = await openRun();
    await renew(turnId);
    await asTrustedWriter();
    const { rows } = await db.query(
      "select public.accept_turn_direction($1, $2, 'Focus on smaller agencies.', 'next_step') as outcome",
      [projectA, turnId],
    );
    expect(rows[0].outcome).toBe("accepted");
  });

  it("refuses steering once a dead worker's lease has lapsed", async () => {
    const turnId = await openRun({ expired: true });
    await asTrustedWriter();
    const { rows } = await db.query(
      "select public.accept_turn_direction($1, $2, 'Too late.', 'next_step') as outcome",
      [projectA, turnId],
    );
    expect(rows[0].outcome).toBe("expired");
  });

  it("does not revive a run whose lease has already lapsed", async () => {
    /*
      The resurrection case. Once the lease lapses, recovery may already have
      concluded the turn was unfinished and told the user so. A late heartbeat
      reopening the window would contradict a verdict the user has seen.
    */
    const turnId = await openRun({ expired: true });
    expect(await renew(turnId)).toBe("expired");

    // Read as the owner, which is who actually looks: recovery still reports
    // the run as expired, and the refused renewal did not change that.
    await impersonate(USER_A);
    const snapshot = await db.query(
      "select state from public.turn_snapshot($1, $2)",
      [projectA, turnId],
    );
    expect(snapshot.rows[0].state).toBe("expired");
  });

  it.each(["completed", "failed"] as const)(
    "cannot pull a %s turn back to running",
    async (state) => {
      const turnId = await openRun();
      await asTrustedWriter();
      await db.query(
        "update turn_runs set state = $2, accepting_direction = false, ended_at = now() where turn_id = $1",
        [turnId, state],
      );

      expect(await renew(turnId)).toBe("finished");
      const after = await leaseOf(turnId);
      expect(after.state).toBe(state);
    },
  );

  it("reports an unknown run rather than creating one", async () => {
    expect(await renew("99999999-0000-4000-8000-000000000099")).toBe("unknown");
    await asTrustedWriter();
    const { rowCount } = await db.query(
      "select 1 from turn_runs where turn_id = '99999999-0000-4000-8000-000000000099'",
    );
    expect(rowCount).toBe(0);
  });

  it("leaves exactly one terminal outcome when a close and a heartbeat race", async () => {
    /*
      Both operations take the same row lock, so one of them observes the
      other's committed result. The invariant is not "the heartbeat loses" —
      either order is legitimate — but that the run ends with one terminal
      state and a lease that was not extended past it.
    */
    const turnId = await openRun();
    await asTrustedWriter();

    const closing = db.query(
      `update turn_runs
         set state = 'completed', accepting_direction = false, ended_at = now()
       where turn_id = $1 and state = 'running'`,
      [turnId],
    );
    const beating = db.query(
      "select public.renew_turn_lease($1, 600) as outcome",
      [turnId],
    );
    const [, beat] = await Promise.all([closing, beating]);

    const after = await leaseOf(turnId);
    expect(after.state).toBe("completed");
    // Whichever ran first, the run is closed and the heartbeat did not
    // reopen it.
    expect(["renewed", "finished"]).toContain(beat.rows[0].outcome);

    const second = await db.query(
      `update turn_runs
         set state = 'failed', ended_at = now()
       where turn_id = $1 and state = 'running'`,
      [turnId],
    );
    expect(second.rowCount).toBe(0);
  });

  it("caps how far one call may extend a lease", async () => {
    const turnId = await openRun();
    await renew(turnId, 60 * 60 * 24 * 365);
    const after = await leaseOf(turnId);
    const hours = (after.lease_expires_at.getTime() - Date.now()) / 3_600_000;
    // A bad argument must not lease a run for a year.
    expect(hours).toBeLessThan(1);
  });

  it("is not callable by a browser session", async () => {
    // A user extending the life of their own turn defeats the point of a
    // lease, so the grant is service_role only.
    const turnId = await openRun();
    await impersonate(USER_A);
    await expect(
      db.query("select public.renew_turn_lease($1, 300)", [turnId]),
    ).rejects.toThrow(/permission denied/);

    await impersonate(USER_B);
    await expect(
      db.query("select public.renew_turn_lease($1, 300)", [turnId]),
    ).rejects.toThrow(/permission denied/);
  });
});
