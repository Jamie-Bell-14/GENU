/**
 * The two atomic boundaries, against a real database.
 *
 * Both functions exist because their guarantees are *transactional*, so they
 * cannot be tested with a stub: a sequence of statements from the application
 * cannot promise all-or-none, and a check followed by a write cannot promise the
 * checked state still holds. Every property below is one the application used to
 * claim and could not keep.
 *
 * Two connections are used wherever the property is about concurrency — a single
 * pg client serialises its queries, so `Promise.all` on one connection proves
 * nothing about two clients racing.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const DB_NAME = "ppm_turn_operations_test";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

const skip = process.env.RLS_TESTS === "skip";
const adminUrl = process.env.DATABASE_URL;

let db: Client;
/** A genuinely separate session, for the races. */
let other: Client;
let projectA: string;
let turnSeq = 0;

const MESSAGE = "Landlords and tenants argue about property condition.";

function nextTurnId() {
  turnSeq += 1;
  return `55555555-0000-4000-8000-${String(turnSeq).padStart(12, "0")}`;
}

async function asTrustedWriter(client: Client = db) {
  await client.query("reset role");
  await client.query("set role service_role");
}

/**
 * Fixture setup and inspection, as the database owner.
 *
 * Deliberately not the trusted writer: `service_role` has no grant on messages,
 * project fields or assumptions in this schema — the two functions under test
 * reach those tables as `security definer`, which is the point. A fixture that
 * borrowed a grant the application does not have would be testing a different
 * database from the one that ships.
 */
async function asOwner(client: Client = db) {
  await client.query("reset role");
}

async function impersonate(userId: string, client: Client = db) {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId }),
  ]);
  await client.query("set role authenticated");
}

const ANSWER =
  "Condition disputes cluster at tenancy end. Who raises it first?";

/*
  Called with *named* parameters throughout, spelled exactly as the TypeScript
  ports spell them (`src/lib/services/trusted-writer.ts`). That is deliberate:
  the defect this suite exists to catch was a join failure between the two sides,
  and positional arguments would keep passing while the names drifted apart.
*/
async function startTurn(
  turnId: string,
  client: Client = db,
  actorId: string = USER_A,
) {
  await asTrustedWriter(client);
  const { rows } = await client.query(
    `select public.start_turn(
       p_project_id => $1, p_turn_id => $2, p_actor_id => $3, p_content => $4
     ) as outcome`,
    [projectA, turnId, actorId, MESSAGE],
  );
  return rows[0].outcome as string;
}

interface CompleteResult {
  outcome: string;
  written?: Record<string, number>;
  refused?: Record<string, string[]>;
}

async function completeTurn(
  turnId: string,
  options: {
    fields?: unknown[];
    assumptions?: unknown[];
    answer?: string;
    actorId?: string;
    client?: Client;
  } = {},
) {
  const client = options.client ?? db;
  await asTrustedWriter(client);
  const { rows } = await client.query(
    `select public.complete_turn(
       p_project_id => $1,
       p_turn_id => $2,
       p_actor_id => $3,
       p_assistant_text => $4,
       p_fields => $5::jsonb,
       p_assumptions => $6::jsonb
     ) as result`,
    [
      projectA,
      turnId,
      options.actorId ?? USER_A,
      options.answer ?? ANSWER,
      JSON.stringify(options.fields ?? []),
      JSON.stringify(options.assumptions ?? []),
    ],
  );
  return rows[0].result as CompleteResult;
}

/** Opens a turn and returns its id, so a completion has a run to close. */
async function openTurn() {
  const turnId = nextTurnId();
  await startTurn(turnId);
  return turnId;
}

const field = (patch: Record<string, unknown> = {}) => ({
  slot: 0,
  area: "problem",
  key: "primary_pain",
  label: "Primary pain",
  value: "Deposit disputes at tenancy end.",
  origin: "ai_inferred",
  support: "hypothesis",
  source_excerpt: null,
  ...patch,
});

const assumption = (patch: Record<string, unknown> = {}) => ({
  slot: 1,
  statement: "Smaller agencies feel this most.",
  why_it_matters: "It decides who the first customer is.",
  alternatives: ["Larger agencies have more disputes by volume."],
  importance: "material",
  origin: "ai_inferred",
  source_excerpt: null,
  ...patch,
});

async function storedField(key = "primary_pain") {
  await asOwner();
  const { rows } = await db.query(
    `select value, origin, support, label, source_turn_id, source_excerpt
       from public.project_fields
      where project_id = $1 and key = $2`,
    [projectA, key],
  );
  return rows[0] as
    | {
        value: string;
        origin: string;
        support: string;
        label: string;
        source_turn_id: string | null;
        source_excerpt: string | null;
      }
    | undefined;
}

async function countRows(
  table: string,
  where = "project_id = $1",
  param: string = projectA,
) {
  await asOwner();
  const { rows } = await db.query(
    `select count(*)::int as n from public.${table} where ${where}`,
    [param],
  );
  return rows[0].n as number;
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
  other = new Client({ connectionString: url.toString() });
  await other.connect();

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
  await other?.end();
});

/** Each test starts from a project with no live run and no model. */
beforeEach(async () => {
  if (skip) return;
  await asOwner();
  await db.query(
    `update public.turn_runs set state = 'completed', ended_at = now()
      where project_id = $1 and state = 'running'`,
    [projectA],
  );
  await db.query("delete from public.messages where project_id = $1", [
    projectA,
  ]);
  await db.query("delete from public.project_fields where project_id = $1", [
    projectA,
  ]);
  await db.query("delete from public.assumptions where project_id = $1", [
    projectA,
  ]);
});

describe.skipIf(skip)("start_turn", () => {
  it("saves the message and opens the run together", async () => {
    const turnId = nextTurnId();
    expect(await startTurn(turnId)).toBe("started");

    // Read as the person whose message it is, which is who actually sees it.
    await impersonate(USER_A);
    const messages = await db.query(
      "select role, content from public.messages where turn_id = $1",
      [turnId],
    );
    expect(messages.rows).toEqual([{ role: "user", content: MESSAGE }]);
    await asOwner();
    const runs = await db.query(
      "select state from public.turn_runs where turn_id = $1",
      [turnId],
    );
    expect(runs.rows[0].state).toBe("running");
  });

  it("writes no message at all when the turn is refused", async () => {
    await startTurn(nextTurnId());
    const refused = nextTurnId();
    expect(await startTurn(refused)).toBe("already_running");

    /*
      The orphan-message defect. The route used to save the message and *then*
      try to open the run, so every refused start left a message with no run and
      no answer — and the client, restoring its draft on a non-OK response,
      re-sent it as a duplicate.
    */
    expect(await countRows("messages", "turn_id = $1", refused)).toBe(0);
  });

  it("takes over from a worker whose lease has lapsed", async () => {
    /*
      The deadlock this fixes. The one-running-turn index tests `state =
      'running'`, and an expired lease does not change the stored state — so a
      run whose worker died kept the project's only slot for ever while steering
      and recovery correctly reported that same turn as dead.
    */
    const dead = nextTurnId();
    await startTurn(dead);
    await asTrustedWriter();
    await db.query(
      "update public.turn_runs set lease_expires_at = now() - interval '1 minute' where turn_id = $1",
      [dead],
    );

    const fresh = nextTurnId();
    expect(await startTurn(fresh)).toBe("started");

    const deadRow = await db.query(
      "select state, ended_at from public.turn_runs where turn_id = $1",
      [dead],
    );
    expect(deadRow.rows[0].state).toBe("failed");
    expect(deadRow.rows[0].ended_at).not.toBeNull();
  });

  it("still refuses while the previous worker is alive", async () => {
    const live = nextTurnId();
    await startTurn(live);
    // A lease with time left on it is a turn that is genuinely running, whether
    // or not it is slow.
    expect(await startTurn(nextTurnId())).toBe("already_running");
    const row = await db.query(
      "select state from public.turn_runs where turn_id = $1",
      [live],
    );
    expect(row.rows[0].state).toBe("running");
  });

  it("lets exactly one of two simultaneous starts through", async () => {
    const first = nextTurnId();
    const second = nextTurnId();
    await asTrustedWriter();
    await asTrustedWriter(other);

    const start = (client: Client, turnId: string) =>
      client.query(
        `select public.start_turn(
           p_project_id => $1, p_turn_id => $2, p_actor_id => $3, p_content => $4
         ) as outcome`,
        [projectA, turnId, USER_A, MESSAGE],
      );
    const outcomes = await Promise.all([
      start(db, first),
      start(other, second),
    ]);
    const results = outcomes.map((o) => o.rows[0].outcome).sort();
    expect(results).toEqual(["already_running", "started"]);

    // One run, and exactly one message: the loser wrote nothing.
    expect(
      await countRows("turn_runs", "project_id = $1 and state = 'running'"),
    ).toBe(1);
    expect(await countRows("messages")).toBe(1);
  });

  it("is not callable by a browser session", async () => {
    // It bypasses RLS and writes an operational record, so it belongs to the
    // trusted writer alone (SECURITY_STANDARDS §11.2).
    await impersonate(USER_A);
    await expect(
      db.query("select public.start_turn($1, $2, $3, $4)", [
        projectA,
        nextTurnId(),
        USER_A,
        MESSAGE,
      ]),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses an actor who does not own the project", async () => {
    /*
      The elevated path carries its own authorisation. It bypasses RLS by
      definition, so "the route checked first" is not a control the database can
      rely on — and a route that forgot would otherwise write into someone else's
      project.
    */
    await expect(startTurn(nextTurnId(), db, USER_B)).rejects.toThrow(
      /not_project_owner/,
    );
    expect(await countRows("messages")).toBe(0);
  });
});

describe.skipIf(skip)("complete_turn", () => {
  it("stores the answer, the writes and the outcome in one commit", async () => {
    const turnId = await openTurn();
    const result = await completeTurn(turnId, {
      fields: [field()],
      assumptions: [assumption()],
    });

    expect(result.outcome).toBe("completed");
    // Per slot, so an outcome describes the operation that produced it.
    expect(result.written).toEqual({ "0": 1, "1": 1 });
    expect(result.refused).toEqual({});

    expect((await storedField())?.value).toBe(
      "Deposit disputes at tenancy end.",
    );
    expect(await countRows("assumptions")).toBe(1);
    expect(
      await countRows(
        "messages",
        "turn_id = $1 and role = 'assistant'",
        turnId,
      ),
    ).toBe(1);
    await asOwner();
    const run = await db.query(
      "select state, accepting_direction from public.turn_runs where turn_id = $1",
      [turnId],
    );
    expect(run.rows[0].state).toBe("completed");
    expect(run.rows[0].accepting_direction).toBe(false);
  });

  it("loses the answer too when a write in the set is malformed", async () => {
    /*
      All-or-none, and the reason this is one function call rather than an ordered
      sequence of them: catch-up treats a stored answer as settlement, so an
      answer that outlived its project writes would read as a completed turn
      whose changes had silently vanished.
    */
    const turnId = await openTurn();
    await expect(
      completeTurn(turnId, {
        fields: [
          field(),
          field({ key: "secondary_pain", area: "not_an_area" }),
        ],
      }),
    ).rejects.toThrow();

    expect(await countRows("project_fields")).toBe(0);
    expect(
      await countRows(
        "messages",
        "turn_id = $1 and role = 'assistant'",
        turnId,
      ),
    ).toBe(0);
    // Still running, so recovery reports it honestly rather than as completed.
    await asOwner();
    const run = await db.query(
      "select state from public.turn_runs where turn_id = $1",
      [turnId],
    );
    expect(run.rows[0].state).toBe("running");
  });

  it("rolls back an accepted field when an assumption in the same set is invalid", async () => {
    const turnId = await openTurn();
    await expect(
      completeTurn(turnId, {
        fields: [field()],
        assumptions: [
          // Claims the person said it, with nothing to quote. An application
          // invariant rather than an expected refusal, so it aborts.
          assumption({ origin: "user_stated", source_excerpt: null }),
        ],
      }),
    ).rejects.toThrow(/unsourced_user_stated/);

    expect(await countRows("project_fields")).toBe(0);
    expect(await countRows("assumptions")).toBe(0);
  });

  it("refuses a user_stated field with no verified words behind it", async () => {
    // Origin alone is an assertion. A claim that the person said something has
    // to carry the words that were checked, or it cannot be audited later.
    const turnId = await openTurn();
    await expect(
      completeTurn(turnId, {
        fields: [field({ origin: "user_stated", source_excerpt: null })],
      }),
    ).rejects.toThrow(/unsourced_user_stated/);
  });

  it("persists the verified words and the turn they came from", async () => {
    const turnId = await openTurn();
    await completeTurn(turnId, {
      fields: [
        field({
          value: "argue about property condition",
          origin: "user_stated",
          source_excerpt: "argue about property condition",
        }),
      ],
    });
    const stored = await storedField();
    expect(stored?.origin).toBe("user_stated");
    expect(stored?.source_excerpt).toBe("argue about property condition");
    expect(stored?.source_turn_id).toBe(turnId);
  });

  it("refuses to replace wording the person owns, and keeps the answer", async () => {
    // Written as the owner, through the grants a browser session really has:
    // this is a person editing their own project (T7).
    await impersonate(USER_A);
    await db.query(
      `insert into public.project_fields
         (project_id, area, key, label, value, origin, support)
       values ($1, 'problem', 'primary_pain', 'Primary pain',
               'The wording I chose myself.', 'user_stated', 'hypothesis')`,
      [projectA],
    );

    const turnId = await openTurn();
    const result = await completeTurn(turnId, { fields: [field()] });

    /*
      A refusal is not a failure. Changing a person's own wording belongs to the
      approval path, but throwing away the answer they are reading would be a
      second, worse mistake — so the row is refused, reported per slot, and
      everything else in the turn still commits.
    */
    expect(result.outcome).toBe("completed");
    expect(result.refused).toEqual({ "0": ["user_owned_field"] });
    expect(result.written).toEqual({});
    expect((await storedField())?.value).toBe("The wording I chose myself.");
    expect(
      await countRows(
        "messages",
        "turn_id = $1 and role = 'assistant'",
        turnId,
      ),
    ).toBe(1);
  });

  it("allows a support revision that leaves the person's wording alone", async () => {
    await impersonate(USER_A);
    await db.query(
      `insert into public.project_fields
         (project_id, area, key, label, value, origin, support, source_excerpt)
       values ($1, 'problem', 'primary_pain', 'Primary pain',
               'Deposit disputes at tenancy end.', 'user_stated', 'hypothesis',
               'Deposit disputes at tenancy end.')`,
      [projectA],
    );

    const turnId = await openTurn();
    await completeTurn(turnId, {
      fields: [field({ support: "some_evidence", label: "The core pain" })],
    });
    const stored = await storedField();
    expect(stored?.support).toBe("some_evidence");
    expect(stored?.label).toBe("The core pain");
    /*
      And the origin survives. An automatic revision that supplied `origin`
      unconditionally would quietly rewrite the person's own words into the
      model's inference — the same row, with its meaning changed.
    */
    expect(stored?.origin).toBe("user_stated");
    expect(stored?.source_excerpt).toBe("Deposit disputes at tenancy end.");
  });

  it("revises a field the model already owns", async () => {
    await completeTurn(await openTurn(), {
      fields: [field({ value: "An earlier reading." })],
    });
    await completeTurn(await openTurn(), { fields: [field()] });
    expect((await storedField())?.value).toBe(
      "Deposit disputes at tenancy end.",
    );
  });

  it("writes nothing when the run is no longer this turn's to finish", async () => {
    /*
      The lease lapsed and a later turn reconciled the run, so recovery may
      already have told the user this turn did not finish. A late worker must not
      overwrite a verdict the person has seen — not with an answer, and not with
      project changes.
    */
    const abandoned = await openTurn();
    await asTrustedWriter();
    await db.query(
      "update public.turn_runs set lease_expires_at = now() - interval '1 minute' where turn_id = $1",
      [abandoned],
    );
    // A new turn reconciles the dead one, exactly as `start_turn` does.
    await startTurn(nextTurnId());

    const result = await completeTurn(abandoned, { fields: [field()] });
    expect(result.outcome).toBe("not_running");
    expect(await countRows("project_fields")).toBe(0);
    expect(
      await countRows(
        "messages",
        "turn_id = $1 and role = 'assistant'",
        abandoned,
      ),
    ).toBe(0);
  });

  it("refuses a run whose lease has lapsed even though its row still says running", async () => {
    /*
      The P0 this closes. `state = 'running'` alone is not enough: an expired
      lease does not change the stored state, only how a snapshot *reads* it —
      so a worker whose heartbeat had already failed could reach this point with
      the row still saying `running`, while `turn_snapshot` had already been
      telling the user the turn was `expired` and recovery may have told them it
      did not finish. Unlike the test above, nothing has reconciled this row: it
      is exactly the state a slow finalisation racing a dying heartbeat leaves
      behind, and the earlier version of this function trusted it anyway.
    */
    const turnId = await openTurn();
    await asTrustedWriter();
    await db.query(
      "update public.turn_runs set lease_expires_at = now() - interval '1 minute' where turn_id = $1",
      [turnId],
    );

    const result = await completeTurn(turnId, {
      fields: [field()],
      assumptions: [assumption()],
    });
    expect(result.outcome).toBe("not_running");
    expect(await countRows("project_fields")).toBe(0);
    expect(await countRows("assumptions")).toBe(0);
    expect(
      await countRows(
        "messages",
        "turn_id = $1 and role = 'assistant'",
        turnId,
      ),
    ).toBe(0);

    // Untouched: still running in name, exactly as a dead heartbeat leaves it.
    // The next `start_turn` for this project reconciles it, not this call.
    await asOwner();
    const row = await db.query(
      "select state from public.turn_runs where turn_id = $1",
      [turnId],
    );
    expect(row.rows[0].state).toBe("running");
  });

  it("leaves one coherent outcome when a heartbeat races a completion in flight", async () => {
    /*
      The lifecycle property, not just the state check: a heartbeat and a
      completion take the same row lock, so one of them always observes the
      other's committed result rather than two conflicting terminal writes.

      Forced into a specific order — completion wins the row — because that is
      the case the route's fix makes true: the heartbeat now stops only *after*
      `finishTurn` has committed, never before it, so a renewal that starts
      while a completion is in flight is the renewal that has to lose. A raw
      lock is taken first and awaited, rather than merely dispatching both
      calls and hoping timing cooperates: two independent connections give no
      guarantee about which one's `for update` reaches the server first, and an
      unforced test would only prove the property on whichever run happened to
      land in the right order.
    */
    const turnId = await openTurn();
    await asTrustedWriter(other);
    await other.query("begin");
    // Confirmed held before the renewal is even dispatched. A session may
    // re-lock a row it already holds, so `complete_turn` below still runs
    // normally inside this same transaction.
    await other.query(
      "select 1 from public.turn_runs where turn_id = $1 for update",
      [turnId],
    );

    await asTrustedWriter();
    const renewing = db.query(
      "select public.renew_turn_lease($1, 900) as outcome",
      [turnId],
    );

    const completing = other.query(
      `select public.complete_turn(
         p_project_id => $1,
         p_turn_id => $2,
         p_actor_id => $3,
         p_assistant_text => $4,
         p_fields => $5::jsonb,
         p_assumptions => '[]'::jsonb
       ) as result`,
      [projectA, turnId, USER_A, ANSWER, JSON.stringify([field()])],
    );
    await completing;
    await other.query("commit");
    const renewal = await renewing;

    // The completion won the row: the heartbeat's renewal, unblocked only once
    // the completion had already committed, sees a turn that already ended.
    expect(renewal.rows[0].outcome).toBe("finished");
    const row = await db.query(
      "select state from public.turn_runs where turn_id = $1",
      [turnId],
    );
    expect(row.rows[0].state).toBe("completed");
  });

  it("loses to a concurrent user edit rather than racing it", async () => {
    /*
      The check-then-write race. The application used to read the existing rows,
      decide the write was permitted, and then write — so an edit committed in
      between was silently overwritten. The check now happens under the row's own
      lock, inside the same transaction as the write.
    */
    await completeTurn(await openTurn(), { fields: [field()] });
    const turnId = await openTurn();

    await impersonate(USER_A);
    await db.query("begin");
    // Take the row first, as the user's own edit does.
    await db.query(
      `update public.project_fields
          set value = 'The wording I chose myself.', origin = 'user_stated'
        where project_id = $1 and key = 'primary_pain'`,
      [projectA],
    );

    const commit = completeTurn(turnId, {
      fields: [field()],
      client: other,
    });
    // The commit blocks on the lock; the edit wins the row.
    await db.query("commit");

    expect((await commit).refused).toEqual({ "0": ["user_owned_field"] });
    expect((await storedField())?.value).toBe("The wording I chose myself.");
  });

  it("refuses an actor who does not own the project", async () => {
    const turnId = await openTurn();
    await expect(
      completeTurn(turnId, { fields: [field()], actorId: USER_B }),
    ).rejects.toThrow(/not_project_owner/);
    expect(await countRows("project_fields")).toBe(0);
  });

  it("is not callable by a browser session", async () => {
    const turnId = await openTurn();
    await impersonate(USER_A);
    await expect(
      db.query(
        "select public.complete_turn($1, $2, $3, 'text', '[]'::jsonb, '[]'::jsonb)",
        [projectA, turnId, USER_A],
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
