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

async function startTurn(turnId: string, client: Client = db) {
  await asTrustedWriter(client);
  const { rows } = await client.query(
    "select public.start_turn($1, $2, $3) as outcome",
    [projectA, turnId, MESSAGE],
  );
  return rows[0].outcome as string;
}

async function applyOperations(
  turnId: string,
  fields: unknown[],
  assumptions: unknown[] = [],
) {
  await asTrustedWriter();
  const { rows } = await db.query(
    "select public.apply_turn_operations($1, $2, $3::jsonb, $4::jsonb) as result",
    [projectA, turnId, JSON.stringify(fields), JSON.stringify(assumptions)],
  );
  return rows[0].result as { fields: number; assumptions: number };
}

const field = (patch: Record<string, unknown> = {}) => ({
  area: "problem",
  key: "primary_pain",
  label: "Primary pain",
  value: "Deposit disputes at tenancy end.",
  origin: "ai_inferred",
  support: "hypothesis",
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

    const outcomes = await Promise.all([
      db.query("select public.start_turn($1, $2, $3) as outcome", [
        projectA,
        first,
        MESSAGE,
      ]),
      other.query("select public.start_turn($1, $2, $3) as outcome", [
        projectA,
        second,
        MESSAGE,
      ]),
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
      db.query("select public.start_turn($1, $2, $3)", [
        projectA,
        nextTurnId(),
        MESSAGE,
      ]),
    ).rejects.toThrow(/permission denied/);
  });
});

describe.skipIf(skip)("apply_turn_operations", () => {
  it("writes a turn's fields and assumptions in one call", async () => {
    const turnId = nextTurnId();
    const result = await applyOperations(
      turnId,
      [field()],
      [
        {
          statement: "Smaller agencies feel this most.",
          why_it_matters: "It decides who the first customer is.",
          alternatives: ["Larger agencies have more disputes by volume."],
          importance: "material",
          origin: "ai_inferred",
          source_excerpt: null,
        },
      ],
    );
    expect(result).toEqual({ fields: 1, assumptions: 1 });
    expect((await storedField())?.value).toBe(
      "Deposit disputes at tenancy end.",
    );
    expect(await countRows("assumptions")).toBe(1);
  });

  it("writes nothing when a later operation in the set fails", async () => {
    /*
      The all-or-none property, and the reason this is one function call rather
      than a loop in TypeScript: field A landing while assumption B fails leaves
      the project half-changed by a turn reported as failed.
    */
    const turnId = nextTurnId();
    await expect(
      applyOperations(
        turnId,
        [field(), field({ key: "secondary_pain", area: "not_an_area" })],
        [],
      ),
    ).rejects.toThrow();

    expect(await countRows("project_fields")).toBe(0);
  });

  it("rolls back an accepted field when an assumption in the same set fails", async () => {
    const turnId = nextTurnId();
    await expect(
      applyOperations(
        turnId,
        [field()],
        [
          {
            statement: "Claimed as the person's words.",
            why_it_matters: "It changes who to build for.",
            alternatives: [],
            importance: "material",
            // Claims the person said it, with nothing to quote.
            origin: "user_stated",
            source_excerpt: null,
          },
        ],
      ),
    ).rejects.toThrow(/unsourced_user_stated/);

    expect(await countRows("project_fields")).toBe(0);
    expect(await countRows("assumptions")).toBe(0);
  });

  it("refuses a user_stated field with no verified words behind it", async () => {
    // Origin alone is an assertion. A claim that the person said something has
    // to carry the words that were checked, or it cannot be audited later.
    await expect(
      applyOperations(
        nextTurnId(),
        [field({ origin: "user_stated", source_excerpt: null })],
        [],
      ),
    ).rejects.toThrow(/unsourced_user_stated/);
  });

  it("persists the verified words and the turn they came from", async () => {
    const turnId = nextTurnId();
    await applyOperations(
      turnId,
      [
        field({
          value: "argue about property condition",
          origin: "user_stated",
          source_excerpt: "argue about property condition",
        }),
      ],
      [],
    );
    const stored = await storedField();
    expect(stored?.origin).toBe("user_stated");
    expect(stored?.source_excerpt).toBe("argue about property condition");
    expect(stored?.source_turn_id).toBe(turnId);
  });

  it("refuses to replace wording the person owns", async () => {
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

    await expect(applyOperations(nextTurnId(), [field()], [])).rejects.toThrow(
      /user_owned_field/,
    );
    // Refused, not written-then-reverted: the person's wording is untouched.
    expect((await storedField())?.value).toBe("The wording I chose myself.");
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

    await applyOperations(
      nextTurnId(),
      [field({ support: "some_evidence", label: "The core pain" })],
      [],
    );
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
    await applyOperations(
      nextTurnId(),
      [field({ value: "An earlier reading." })],
      [],
    );
    await applyOperations(nextTurnId(), [field()], []);
    expect((await storedField())?.value).toBe(
      "Deposit disputes at tenancy end.",
    );
  });

  it("loses to a concurrent user edit rather than racing it", async () => {
    /*
      The check-then-write race. The application used to read the existing rows,
      decide the write was permitted, and then write — so an edit committed in
      between was silently overwritten. The check now happens under the row's own
      lock, inside the same transaction as the write.
    */
    await applyOperations(nextTurnId(), [field()], []);

    await impersonate(USER_A);
    await db.query("begin");
    // Take the row first, as the user's own edit does.
    await db.query(
      `update public.project_fields
          set value = 'The wording I chose myself.', origin = 'user_stated'
        where project_id = $1 and key = 'primary_pain'`,
      [projectA],
    );

    await asTrustedWriter(other);
    const commit = other.query(
      "select public.apply_turn_operations($1, $2, $3::jsonb, '[]'::jsonb)",
      [projectA, nextTurnId(), JSON.stringify([field()])],
    );
    // The commit blocks on the lock; the edit wins the row.
    await db.query("commit");

    await expect(commit).rejects.toThrow(/user_owned_field/);
    expect((await storedField())?.value).toBe("The wording I chose myself.");
  });

  it("is not callable by a browser session", async () => {
    await impersonate(USER_A);
    await expect(
      db.query(
        "select public.apply_turn_operations($1, $2, '[]'::jsonb, '[]'::jsonb)",
        [projectA, nextTurnId()],
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
