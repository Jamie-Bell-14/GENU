/**
 * Connected-change proposals: staging, approval, undo (T11;
 * docs/VERTICAL_SLICE_TASKS.md T11; SECURITY_STANDARDS §11.2).
 *
 * The headline properties under test: `change_proposals`/`change_items`/
 * `documents`/`document_versions`/`decisions` are all system- or
 * function-authored (no direct insert grant for `authenticated`, invisible
 * across projects); a proposal is staged into `complete_turn`'s own
 * transaction exactly like a field or an assumption; `apply_change_proposal`
 * recomputes every item's "before" at approval time and refuses the whole
 * decision — writing nothing — if any of them has drifted (no partial
 * application on staleness); exclude-all is recorded as a rejection, not a
 * silent no-op; approving twice is refused as already_decided rather than
 * double-applied; only the project's owner can apply or undo; undo restores
 * prior values as new writes and refuses, writing nothing, if a field it
 * would restore has changed again since the approval it would undo; and
 * every approval, rejection and undo leaves its own `audit_events` row.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_NAME = "ppm_change_proposals_rls_test";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

const skip = process.env.RLS_TESTS === "skip";
const adminUrl = process.env.DATABASE_URL;

let db: Client;
let projectA: string;
let projectB: string;
let turnSeq = 0;

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

/** Opens a running turn for the project, closing whatever was left running. */
async function openRun(projectId: string): Promise<string> {
  turnSeq += 1;
  const turnId = `66666666-0000-4000-8000-${String(turnSeq).padStart(12, "0")}`;
  await asTrustedWriter();
  await db.query(
    `update turn_runs set state = 'completed', accepting_direction = false, ended_at = now()
     where project_id = $1 and state = 'running'`,
    [projectId],
  );
  await db.query("reset role");
  await db.query(
    `insert into messages (project_id, turn_id, role, content)
     values ($1, $2, 'user', 'User message.')`,
    [projectId, turnId],
  );
  await asTrustedWriter();
  await db.query(
    `insert into turn_runs (turn_id, project_id, lease_expires_at)
     values ($1, $2, now() + interval '15 minutes')`,
    [turnId, projectId],
  );
  return turnId;
}

interface ProposalSummary {
  id: string;
  title: string;
  rationale: string;
  areas: string[];
}

interface CompleteResult {
  outcome: string;
  written?: Record<string, number>;
  proposals?: Record<string, ProposalSummary>;
}

/** Stages one connected-change proposal into `complete_turn`, as `commitTurn` does. */
async function completeTurnWithProposal(
  projectId: string,
  turnId: string,
  actorId: string,
  items: { area: string; key: string; before: string | null; after: string }[],
  overrides: {
    title?: string;
    rationale?: string;
    remainingUncertainty?: string;
  } = {},
): Promise<CompleteResult> {
  await asTrustedWriter();
  const proposals = [
    {
      slot: 0,
      title: overrides.title ?? "Narrow the target customer",
      rationale:
        overrides.rationale ?? "The evidence points at smaller agencies.",
      remaining_uncertainty:
        overrides.remainingUncertainty ?? "No pricing evidence yet.",
      items,
    },
  ];
  const { rows } = await db.query(
    `select public.complete_turn(
       p_project_id => $1,
       p_turn_id => $2,
       p_actor_id => $3,
       p_assistant_text => $4,
       p_fields => '[]'::jsonb,
       p_assumptions => '[]'::jsonb,
       p_evidence => '[]'::jsonb,
       p_proposals => $5::jsonb
     ) as result`,
    [
      projectId,
      turnId,
      actorId,
      "Proposing a connected change.",
      JSON.stringify(proposals),
    ],
  );
  return rows[0].result as CompleteResult;
}

async function fieldValue(
  projectId: string,
  area: string,
  key: string,
): Promise<string | null> {
  const { rows } = await db.query(
    "select value from project_fields where project_id = $1 and area = $2 and key = $3",
    [projectId, area, key],
  );
  return rows[0]?.value ?? null;
}

type ApplyResult = Record<string, unknown> & { outcome: string };

async function applyProposal(
  proposalId: string,
  decisions: { itemId: string; included: boolean; after?: string }[],
): Promise<ApplyResult> {
  const { rows } = await db.query(
    `select public.apply_change_proposal(
       p_proposal_id => $1,
       p_decisions => $2::jsonb
     ) as result`,
    [
      proposalId,
      JSON.stringify(
        decisions.map((decision) => ({
          item_id: decision.itemId,
          included: decision.included,
          ...(decision.after !== undefined ? { after: decision.after } : {}),
        })),
      ),
    ],
  );
  return rows[0].result as ApplyResult;
}

async function undoProposal(proposalId: string): Promise<ApplyResult> {
  const { rows } = await db.query(
    "select public.undo_change_proposal(p_proposal_id => $1) as result",
    [proposalId],
  );
  return rows[0].result as ApplyResult;
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

  await impersonate(USER_B);
  projectB = (
    await db.query(
      "insert into projects (owner_id, name) values (auth.uid(), 'B') returning id",
    )
  ).rows[0].id;
}, 30_000);

afterAll(async () => {
  await db?.end();
});

describe.skipIf(skip)("change_proposals / change_items", () => {
  it("is not directly writable by the authenticated role", async () => {
    await impersonate(USER_A);
    await expect(
      db.query(
        `insert into change_proposals (project_id, source_turn_id, title, rationale)
         values ($1, gen_random_uuid(), 'T', 'R')`,
        [projectA],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("denies anonymous access", async () => {
    await impersonate(null);
    await expect(db.query("select * from change_proposals")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("hides proposals from other users", async () => {
    const turnId = await openRun(projectA);
    const result = await completeTurnWithProposal(projectA, turnId, USER_A, [
      {
        area: "customer",
        key: "primary_customer",
        before: null,
        after: "Small agencies",
      },
    ]);
    const proposalId = result.proposals?.["0"]?.id;
    expect(proposalId).toBeTruthy();

    await impersonate(USER_B);
    expect(
      (
        await db.query("select 1 from change_proposals where id = $1", [
          proposalId,
        ])
      ).rowCount,
    ).toBe(0);
  });
});

describe.skipIf(skip)("complete_turn: propose_connected_change", () => {
  it("stages the proposal and its items, inert until approved", async () => {
    const turnId = await openRun(projectA);
    const result = await completeTurnWithProposal(projectA, turnId, USER_A, [
      {
        area: "customer",
        key: "primary_customer",
        before: "Letting agencies",
        after: "Letting agencies under 20 staff",
      },
      {
        area: "value_proposition",
        key: "core_value",
        before: null,
        after: "Faster deposit disputes",
      },
    ]);
    expect(result.outcome).toBe("completed");
    expect(result.written).toEqual({ "0": 1 });
    const summary = result.proposals?.["0"];
    expect(summary).toMatchObject({
      title: "Narrow the target customer",
      rationale: "The evidence points at smaller agencies.",
    });
    expect(new Set(summary?.areas)).toEqual(
      new Set(["customer", "value_proposition"]),
    );

    await impersonate(USER_A);
    const proposal = await db.query(
      "select status, source_turn_id from change_proposals where id = $1",
      [summary!.id],
    );
    expect(proposal.rows[0]).toMatchObject({
      status: "proposed",
      source_turn_id: turnId,
    });
    const items = await db.query(
      "select area, key, before, after, included from change_items where proposal_id = $1 order by area",
      [summary!.id],
    );
    expect(items.rows).toHaveLength(2);
    // Included by default — the proposal itself is not applied, but nothing
    // about an item defaults to excluded either (DESIGN.md §13.2).
    expect(items.rows.every((row) => row.included)).toBe(true);

    // Nothing was written to project truth by staging alone.
    expect(
      await fieldValue(projectA, "customer", "primary_customer"),
    ).toBeNull();
  });
});

describe.skipIf(skip)("apply_change_proposal", () => {
  async function stageProposal(overrides: { title?: string } = {}) {
    const turnId = await openRun(projectA);
    const result = await completeTurnWithProposal(
      projectA,
      turnId,
      USER_A,
      [
        {
          area: "customer",
          key: "primary_customer",
          before: null,
          after: "Small letting agencies",
        },
        {
          area: "value_proposition",
          key: "core_value",
          before: null,
          after: "Faster deposit disputes",
        },
      ],
      overrides,
    );
    const summary = result.proposals!["0"];
    const items = await db.query(
      "select id, area, key from change_items where proposal_id = $1 order by area",
      [summary.id],
    );
    return {
      proposalId: summary.id as string,
      customerItemId: items.rows[0].id as string,
      valuePropItemId: items.rows[1].id as string,
    };
  }

  it("full approval writes fields, a document version per area and a decision, in one transaction", async () => {
    const { proposalId, customerItemId, valuePropItemId } = await stageProposal(
      {
        title: "Full approval check",
      },
    );

    await impersonate(USER_A);
    const result = await applyProposal(proposalId, [
      { itemId: customerItemId, included: true },
      { itemId: valuePropItemId, included: true },
    ]);
    expect(result).toMatchObject({
      outcome: "completed",
      status: "approved",
      included: 2,
      total: 2,
    });
    expect(result.decision_id).toBeTruthy();

    expect(await fieldValue(projectA, "customer", "primary_customer")).toBe(
      "Small letting agencies",
    );
    expect(await fieldValue(projectA, "value_proposition", "core_value")).toBe(
      "Faster deposit disputes",
    );

    const documents = await db.query(
      "select slug, current_version_id from documents where project_id = $1 order by slug",
      [projectA],
    );
    expect(documents.rows.map((row) => row.slug)).toEqual([
      "target_customer",
      "value_proposition",
    ]);
    for (const row of documents.rows) {
      expect(row.current_version_id).toBeTruthy();
    }

    const decision = await db.query(
      "select approved_by, change_proposal_id from decisions where change_proposal_id = $1",
      [proposalId],
    );
    expect(decision.rows[0]).toMatchObject({
      approved_by: USER_A,
      change_proposal_id: proposalId,
    });

    const status = await db.query(
      "select status, decided_at from change_proposals where id = $1",
      [proposalId],
    );
    expect(status.rows[0].status).toBe("approved");
    expect(status.rows[0].decided_at).toBeTruthy();

    const audit = await db.query(
      `select action from audit_events
       where project_id = $1 and action = 'proposal_approved'
       order by created_at desc limit 1`,
      [projectA],
    );
    expect(audit.rowCount).toBe(1);
  });

  it("partial approval writes only the included item and records partially_approved", async () => {
    const { proposalId, customerItemId, valuePropItemId } = await stageProposal(
      {
        title: "Partial approval check",
      },
    );

    await impersonate(USER_A);
    const result = await applyProposal(proposalId, [
      { itemId: customerItemId, included: true },
      { itemId: valuePropItemId, included: false },
    ]);
    expect(result).toMatchObject({
      outcome: "completed",
      status: "partially_approved",
      included: 1,
      total: 2,
    });

    expect(await fieldValue(projectA, "customer", "primary_customer")).toBe(
      "Small letting agencies",
    );
    expect(
      await fieldValue(projectA, "value_proposition", "core_value"),
    ).toBeNull();

    const documents = await db.query(
      "select slug from documents where project_id = $1 and slug = 'value_proposition'",
      [projectA],
    );
    expect(documents.rowCount).toBe(0);
  });

  it("an edited value overrides the proposal's own after", async () => {
    const { proposalId, customerItemId, valuePropItemId } = await stageProposal(
      {
        title: "Edited value check",
      },
    );

    await impersonate(USER_A);
    await applyProposal(proposalId, [
      {
        itemId: customerItemId,
        included: true,
        after: "Independent agencies with 5-20 staff",
      },
      { itemId: valuePropItemId, included: false },
    ]);

    expect(await fieldValue(projectA, "customer", "primary_customer")).toBe(
      "Independent agencies with 5-20 staff",
    );
  });

  it("exclude-all is recorded as a rejection, not a silent no-op", async () => {
    const { proposalId } = await stageProposal({ title: "Exclude-all check" });

    await impersonate(USER_A);
    const result = await applyProposal(proposalId, []);
    expect(result).toMatchObject({
      outcome: "completed",
      status: "rejected",
      included: 0,
      total: 2,
    });

    const decision = await db.query(
      "select 1 from decisions where change_proposal_id = $1",
      [proposalId],
    );
    expect(decision.rowCount).toBe(0);

    const audit = await db.query(
      `select action from audit_events
       where project_id = $1 and action = 'proposal_rejected'
       order by created_at desc limit 1`,
      [projectA],
    );
    expect(audit.rowCount).toBe(1);
  });

  it("refuses a second decision on an already-decided proposal, without writing anything further", async () => {
    const { proposalId, customerItemId, valuePropItemId } = await stageProposal(
      {
        title: "Idempotency check",
      },
    );

    await impersonate(USER_A);
    await applyProposal(proposalId, [
      { itemId: customerItemId, included: true },
      { itemId: valuePropItemId, included: true },
    ]);

    const second = await applyProposal(proposalId, [
      { itemId: customerItemId, included: false },
      { itemId: valuePropItemId, included: false },
    ]);
    expect(second).toMatchObject({
      outcome: "conflict",
      reason: "already_decided",
      status: "approved",
    });

    // The first approval's value is untouched by the refused second call.
    expect(await fieldValue(projectA, "customer", "primary_customer")).toBe(
      "Small letting agencies",
    );
  });

  it("refuses the whole decision — writing nothing — when any one item has gone stale", async () => {
    const { proposalId, customerItemId, valuePropItemId } = await stageProposal(
      {
        title: "Stale item check",
      },
    );

    // The person edits the customer field directly, out from under the
    // proposal's own recorded "before", between proposal and decision.
    await asTrustedWriter();
    await db.query(
      `insert into project_fields (project_id, area, key, label, value, origin)
       values ($1, 'customer', 'primary_customer', 'primary_customer', 'Edited independently', 'user_stated')
       on conflict (project_id, area, key) do update set value = excluded.value`,
      [projectA],
    );

    await impersonate(USER_A);
    const result = await applyProposal(proposalId, [
      { itemId: customerItemId, included: true },
      { itemId: valuePropItemId, included: true },
    ]);
    expect(result).toMatchObject({
      outcome: "conflict",
      reason: "stale",
      item_id: customerItemId,
    });

    // Nothing was written for *either* item — including the one that was
    // not itself stale (§7.4: no partial application).
    expect(
      await fieldValue(projectA, "value_proposition", "core_value"),
    ).toBeNull();
    const status = await db.query(
      "select status from change_proposals where id = $1",
      [proposalId],
    );
    expect(status.rows[0].status).toBe("proposed");
  });

  it("only the project's owner can apply; a foreign or unknown proposal answers uniformly", async () => {
    const { proposalId, customerItemId } = await stageProposal({
      title: "Ownership check",
    });

    await impersonate(USER_B);
    await expect(
      applyProposal(proposalId, [{ itemId: customerItemId, included: true }]),
    ).rejects.toThrow(/not_found_or_not_owner/);

    await expect(
      applyProposal("99999999-0000-4000-8000-000000000099", []),
    ).rejects.toThrow(/not_found_or_not_owner/);
  });
});

describe.skipIf(skip)("undo_change_proposal", () => {
  async function stageAndApprove() {
    const turnId = await openRun(projectA);
    const result = await completeTurnWithProposal(projectA, turnId, USER_A, [
      {
        area: "mvp_scope",
        key: "core_feature",
        before: null,
        after: "Deposit dispute tracker",
      },
    ]);
    const summary = result.proposals!["0"];
    const items = await db.query(
      "select id from change_items where proposal_id = $1",
      [summary.id],
    );
    const itemId = items.rows[0].id as string;

    await impersonate(USER_A);
    await applyProposal(summary.id, [{ itemId, included: true }]);
    return { proposalId: summary.id as string, itemId };
  }

  it("restores the prior value as a new write, and deletes a field the proposal itself created", async () => {
    const { proposalId } = await stageAndApprove();
    expect(await fieldValue(projectA, "mvp_scope", "core_feature")).toBe(
      "Deposit dispute tracker",
    );

    await impersonate(USER_A);
    const result = await undoProposal(proposalId);
    expect(result.outcome).toBe("completed");

    // `before` was null — the proposal created the field, so undo deletes it
    // rather than writing back an empty value it could never legitimately hold.
    expect(await fieldValue(projectA, "mvp_scope", "core_feature")).toBeNull();

    const status = await db.query(
      "select status from change_proposals where id = $1",
      [proposalId],
    );
    expect(status.rows[0].status).toBe("undone");

    const audit = await db.query(
      `select action from audit_events
       where project_id = $1 and action = 'proposal_undone'
       order by created_at desc limit 1`,
      [projectA],
    );
    expect(audit.rowCount).toBe(1);
  });

  it("refuses — writing nothing — when the field has changed again since the approval it would undo", async () => {
    const { proposalId } = await stageAndApprove();

    await asTrustedWriter();
    await db.query(
      `update project_fields set value = 'Edited again after approval'
       where project_id = $1 and area = 'mvp_scope' and key = 'core_feature'`,
      [projectA],
    );

    await impersonate(USER_A);
    const result = await undoProposal(proposalId);
    expect(result).toMatchObject({
      outcome: "conflict",
      reason: "changed_since",
    });

    expect(await fieldValue(projectA, "mvp_scope", "core_feature")).toBe(
      "Edited again after approval",
    );
    const status = await db.query(
      "select status from change_proposals where id = $1",
      [proposalId],
    );
    expect(status.rows[0].status).toBe("approved");
  });

  it("refuses a proposal that was rejected, not approved", async () => {
    const turnId = await openRun(projectA);
    const result = await completeTurnWithProposal(projectA, turnId, USER_A, [
      {
        area: "problem",
        key: "core_problem",
        before: null,
        after: "Slow disputes",
      },
    ]);
    const summary = result.proposals!["0"];

    await impersonate(USER_A);
    await applyProposal(summary.id, []);

    const undo = await undoProposal(summary.id);
    expect(undo).toMatchObject({
      outcome: "conflict",
      reason: "not_undoable",
      status: "rejected",
    });
  });

  it("only the project's owner can undo", async () => {
    const { proposalId } = await stageAndApprove();
    await impersonate(USER_B);
    await expect(undoProposal(proposalId)).rejects.toThrow(
      /not_found_or_not_owner/,
    );
  });
});

describe.skipIf(skip)("documents / document_versions / decisions", () => {
  it("has no direct write grant for the authenticated role", async () => {
    await impersonate(USER_A);
    await expect(
      db.query(
        "insert into documents (project_id, slug, title) values ($1, 'problem_definition', 'T')",
        [projectA],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(
        `insert into decisions (project_id, title, reasoning_summary, approved_by)
         values ($1, 'T', 'R', $2)`,
        [projectA, USER_A],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("hides documents and decisions from other users", async () => {
    const turnId = await openRun(projectB);
    const result = await completeTurnWithProposal(projectB, turnId, USER_B, [
      {
        area: "problem",
        key: "core_problem",
        before: null,
        after: "Slow disputes",
      },
    ]);
    const summary = result.proposals!["0"];
    const items = await db.query(
      "select id from change_items where proposal_id = $1",
      [summary.id],
    );

    await impersonate(USER_B);
    await applyProposal(summary.id, [
      { itemId: items.rows[0].id, included: true },
    ]);

    await impersonate(USER_A);
    expect(
      (
        await db.query("select 1 from documents where project_id = $1", [
          projectB,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await db.query(
          "select 1 from decisions where change_proposal_id = $1",
          [summary.id],
        )
      ).rowCount,
    ).toBe(0);
  });
});
