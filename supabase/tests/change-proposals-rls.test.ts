/**
 * Connected-change proposals: staging, approval, undo (T11;
 * docs/VERTICAL_SLICE_TASKS.md T11; SECURITY_STANDARDS §11.2).
 *
 * The headline properties under test: `change_proposals`/`change_items`/
 * `documents`/`document_versions`/`decisions` are all system- or
 * function-authored (no direct insert grant for `authenticated`, invisible
 * across projects); a proposal is staged into `complete_turn`'s own
 * transaction exactly like a field or an assumption, with each item's
 * "before" snapshotted from real project truth at that moment; `apply_change_proposal`
 * re-reads every included item's live value at approval time only to compare
 * it against that snapshot, and refuses the whole decision — writing
 * nothing — if any of them has drifted (no partial
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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
    /**
     * Assumptions staged in the same turn (T11 review round 5, issue #28) —
     * empty by default, matching every existing caller of this helper.
     */
    assumptions?: {
      statement: string;
      whyItMatters: string;
      importance: "low" | "material";
      contingentOnProposal: boolean;
    }[];
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
  const assumptions = (overrides.assumptions ?? []).map((assumption, i) => ({
    slot: i + 1,
    statement: assumption.statement,
    why_it_matters: assumption.whyItMatters,
    importance: assumption.importance,
    origin: "ai_inferred",
    contingent_on_proposal: assumption.contingentOnProposal,
  }));
  const { rows } = await db.query(
    `select public.complete_turn(
       p_project_id => $1,
       p_turn_id => $2,
       p_actor_id => $3,
       p_assistant_text => $4,
       p_fields => '[]'::jsonb,
       p_assumptions => $6::jsonb,
       p_evidence => '[]'::jsonb,
       p_proposals => $5::jsonb
     ) as result`,
    [
      projectId,
      turnId,
      actorId,
      "Proposing a connected change.",
      JSON.stringify(proposals),
      JSON.stringify(assumptions),
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
}, 30_000);

afterAll(async () => {
  await db?.end();
});

async function createProject(ownerId: string, name: string): Promise<string> {
  await impersonate(ownerId);
  const { rows } = await db.query(
    "insert into projects (owner_id, name) values (auth.uid(), $1) returning id",
    [name],
  );
  return rows[0].id;
}

/*
  A fresh project A and B before every test (T11 review round 3, P0). Round
  2's fix only cleared `project_fields`, but `change_proposals`, `change_items`,
  `documents`, `document_versions`, `decisions` and `audit_events` all
  accumulate on whichever project a test uses — reusing one project for the
  whole file let an earlier test's documents/versions/history leak into a
  later test's assertions even once fields themselves were cleared (e.g. a
  document already existing where a test expects none, or extra
  document_versions rows from an earlier approval). Recreating both projects
  before every test is a genuinely clean slate rather than an ever-growing
  list of tables to remember to clear.
*/
beforeEach(async () => {
  projectA = await createProject(USER_A, "A");
  projectB = await createProject(USER_B, "B");
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

  it("writes one document version per affected document, containing every included item's section, not one version per item", async () => {
    // Two distinct items in the *same* document (T11 review round 3, P1) —
    // a document version is the document's whole ordered section set, so
    // approving both must produce a single new version containing both
    // resulting sections, not two successive versions each missing the
    // other's.
    const turnId = await openRun(projectA);
    const result = await completeTurnWithProposal(
      projectA,
      turnId,
      USER_A,
      [
        {
          area: "mvp_scope",
          key: "core_feature",
          before: null,
          after: "Deposit dispute case tracking.",
        },
        {
          area: "mvp_scope",
          key: "secondary_feature",
          before: null,
          after: "Automated reminder emails.",
        },
      ],
      { title: "Two sections, one document" },
    );
    const summary = result.proposals!["0"];
    const items = await db.query(
      "select id, key from change_items where proposal_id = $1",
      [summary.id],
    );
    const decisions = items.rows.map((row) => ({
      itemId: row.id as string,
      included: true,
    }));

    await impersonate(USER_A);
    const applied = await applyProposal(summary.id, decisions);
    expect(applied).toMatchObject({ outcome: "completed", status: "approved" });

    const versions = await db.query(
      `select dv.id, dv.content from document_versions dv
       join documents d on d.id = dv.document_id
       where d.project_id = $1 and d.slug = 'mvp_scope'`,
      [projectA],
    );
    expect(versions.rowCount).toBe(1);

    const document = await db.query(
      "select current_version_id from documents where project_id = $1 and slug = 'mvp_scope'",
      [projectA],
    );
    expect(document.rows[0].current_version_id).toBe(versions.rows[0].id);

    const sections = versions.rows[0].content.sections as {
      key: string;
      text: string;
      state: string;
    }[];
    expect(sections).toHaveLength(2);
    const byKey = Object.fromEntries(sections.map((s) => [s.key, s]));
    expect(byKey.core_feature).toMatchObject({
      text: "Deposit dispute case tracking.",
      state: "approved",
    });
    expect(byKey.secondary_feature).toMatchObject({
      text: "Automated reminder emails.",
      state: "approved",
    });
  });

  it("a later proposal to the same document preserves the earlier version's untouched sections", async () => {
    // First approval creates the document with one section.
    const firstTurn = await openRun(projectA);
    const first = await completeTurnWithProposal(projectA, firstTurn, USER_A, [
      {
        area: "mvp_scope",
        key: "core_feature",
        before: null,
        after: "Deposit dispute case tracking.",
      },
    ]);
    const firstItems = await db.query(
      "select id from change_items where proposal_id = $1",
      [first.proposals!["0"].id],
    );
    await impersonate(USER_A);
    await applyProposal(first.proposals!["0"].id, [
      { itemId: firstItems.rows[0].id, included: true },
    ]);

    // Second, unrelated proposal touches a *different* key in the same
    // document — the new version must still contain the first section.
    const secondTurn = await openRun(projectA);
    const second = await completeTurnWithProposal(
      projectA,
      secondTurn,
      USER_A,
      [
        {
          area: "mvp_scope",
          key: "secondary_feature",
          before: null,
          after: "Automated reminder emails.",
        },
      ],
    );
    const secondItems = await db.query(
      "select id from change_items where proposal_id = $1",
      [second.proposals!["0"].id],
    );
    await impersonate(USER_A);
    await applyProposal(second.proposals!["0"].id, [
      { itemId: secondItems.rows[0].id, included: true },
    ]);

    const versions = await db.query(
      `select count(*)::int as n from document_versions dv
       join documents d on d.id = dv.document_id
       where d.project_id = $1 and d.slug = 'mvp_scope'`,
      [projectA],
    );
    expect(versions.rows[0].n).toBe(2);

    const current = await db.query(
      `select dv.content from documents d
       join document_versions dv on dv.id = d.current_version_id
       where d.project_id = $1 and d.slug = 'mvp_scope'`,
      [projectA],
    );
    const sections = current.rows[0].content.sections as { key: string }[];
    expect(sections.map((s) => s.key).sort()).toEqual([
      "core_feature",
      "secondary_feature",
    ]);
  });

  it("approving replaces a pre-existing field's origin and support, never leaving stale provenance on the approved text", async () => {
    await impersonate(USER_A);
    await db.query(
      `insert into project_fields (project_id, area, key, label, value, origin, support)
       values ($1, 'mvp_scope', 'core_feature', 'core_feature', 'Manual tracking', 'user_stated', 'credible')`,
      [projectA],
    );

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

    const field = await db.query(
      `select value, origin, support from project_fields
       where project_id = $1 and area = 'mvp_scope' and key = 'core_feature'`,
      [projectA],
    );
    // A person-approved AI proposal, not a value the person typed themselves
    // — and its support reflects what was evidenced for this new wording
    // (none yet), never the prior text's earned 'credible'.
    expect(field.rows[0]).toMatchObject({
      value: "Deposit dispute tracker",
      origin: "ai_inferred",
      support: "hypothesis",
    });
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
    // proposal's own recorded "before", between proposal and decision — the
    // same RLS-permitted owner write `evidence-rls.test.ts` uses, not
    // `service_role` (which has no grant on `project_fields` at all; every
    // real write to it goes through `complete_turn`/`apply_change_proposal`
    // as the owner, never as the service role directly).
    await impersonate(USER_A);
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

  it("a duplicate item id in the decisions array cannot inflate the included count", async () => {
    const { proposalId, customerItemId, valuePropItemId } = await stageProposal(
      { title: "Duplicate decision check" },
    );

    // The request schema rejects this before it ever reaches the database
    // (change-proposals.test.ts); this proves the RPC itself is also robust
    // to a malformed or bypassing caller (T11 review round 2, P0).
    await impersonate(USER_A);
    const result = await applyProposal(proposalId, [
      { itemId: customerItemId, included: true },
      { itemId: customerItemId, included: true },
      { itemId: valuePropItemId, included: false },
    ]);
    expect(result).toMatchObject({
      outcome: "completed",
      status: "partially_approved",
      included: 1,
      total: 2,
    });

    const documents = await db.query(
      "select slug from documents where project_id = $1 and slug = 'target_customer'",
      [projectA],
    );
    // One document_versions row, not two — the duplicate was never applied
    // a second time.
    const versions = await db.query(
      `select count(*)::int as n from document_versions dv
       join documents d on d.id = dv.document_id
       where d.project_id = $1 and d.slug = 'target_customer'`,
      [projectA],
    );
    expect(documents.rowCount).toBe(1);
    expect(versions.rows[0].n).toBe(1);
  });

  it("an unknown item id in the decisions array is silently ignored, not applied or errored on", async () => {
    const { proposalId, customerItemId, valuePropItemId } = await stageProposal(
      { title: "Unknown item check" },
    );

    await impersonate(USER_A);
    const result = await applyProposal(proposalId, [
      { itemId: customerItemId, included: true },
      { itemId: "99999999-0000-4000-8000-000000000099", included: true },
      { itemId: valuePropItemId, included: false },
    ]);
    expect(result).toMatchObject({
      outcome: "completed",
      status: "partially_approved",
      included: 1,
      total: 2,
    });
  });

  it("stores what was actually decided on every item, not the creation default, including for a full rejection", async () => {
    const { proposalId, customerItemId, valuePropItemId } = await stageProposal(
      { title: "Rejection item-flag check" },
    );

    // "Keep current direction" submits no decisions at all — silence is
    // excluded, and that must be what change_items itself records, not the
    // `included = true` every row is created with (T11 review round 2, P1).
    await impersonate(USER_A);
    const result = await applyProposal(proposalId, []);
    expect(result).toMatchObject({ outcome: "completed", status: "rejected" });

    const items = await db.query(
      "select id, included from change_items where proposal_id = $1",
      [proposalId],
    );
    expect(items.rows).toHaveLength(2);
    expect(items.rows.every((row) => row.included === false)).toBe(true);
    expect(items.rows.map((row) => row.id).sort()).toEqual(
      [customerItemId, valuePropItemId].sort(),
    );
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

  it("removes the created section from the document's current version, not just the field (T11 review round 4, P1)", async () => {
    const { proposalId } = await stageAndApprove();

    await impersonate(USER_A);
    await undoProposal(proposalId);

    const current = await db.query(
      `select dv.content from documents d
       join document_versions dv on dv.id = d.current_version_id
       where d.project_id = $1 and d.slug = 'mvp_scope'`,
      [projectA],
    );
    const sections = current.rows[0].content.sections as { key: string }[];
    // `before` was null, so the field never existed prior to this proposal —
    // undoing it must drop the section entirely rather than leave a ghost
    // empty-text entry behind for a field that canonical truth now says
    // doesn't exist.
    expect(sections.map((s) => s.key)).not.toContain("core_feature");
  });

  it("undoing a proposal that added a section to an already-existing document preserves the original section (T11 review round 4, P1)", async () => {
    // First proposal creates the document with one section.
    await stageAndApprove();

    // Second, separate proposal adds a *different* section to the same
    // document.
    const secondTurn = await openRun(projectA);
    const second = await completeTurnWithProposal(
      projectA,
      secondTurn,
      USER_A,
      [
        {
          area: "mvp_scope",
          key: "secondary_feature",
          before: null,
          after: "Automated reminder emails.",
        },
      ],
    );
    const secondItems = await db.query(
      "select id from change_items where proposal_id = $1",
      [second.proposals!["0"].id],
    );
    const secondItemId = secondItems.rows[0].id as string;

    await impersonate(USER_A);
    await applyProposal(second.proposals!["0"].id, [
      { itemId: secondItemId, included: true },
    ]);
    await undoProposal(second.proposals!["0"].id);

    const current = await db.query(
      `select dv.content from documents d
       join document_versions dv on dv.id = d.current_version_id
       where d.project_id = $1 and d.slug = 'mvp_scope'`,
      [projectA],
    );
    const sections = current.rows[0].content.sections as { key: string }[];
    // Undoing the second proposal must remove only the section it added —
    // the first proposal's still-approved section must survive untouched.
    expect(sections.map((s) => s.key)).toEqual(["core_feature"]);
    expect(await fieldValue(projectA, "mvp_scope", "core_feature")).toBe(
      "Deposit dispute tracker",
    );
  });

  it("restores the field's prior origin and support, not only its value", async () => {
    await impersonate(USER_A);
    await db.query(
      `insert into project_fields (project_id, area, key, label, value, origin, support)
       values ($1, 'mvp_scope', 'core_feature', 'core_feature', 'Manual tracking', 'user_stated', 'credible')`,
      [projectA],
    );

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
    await undoProposal(summary.id);

    const field = await db.query(
      `select value, origin, support from project_fields
       where project_id = $1 and area = 'mvp_scope' and key = 'core_feature'`,
      [projectA],
    );
    // Approval overwrote value, origin and support; undo has to restore all
    // three — leaving "ai_inferred"/"hypothesis" behind would say the
    // reverted text is still an unvalidated AI proposal, when it is once
    // again exactly what the person themselves stated (T11 review round 2,
    // P1).
    expect(field.rows[0]).toMatchObject({
      value: "Manual tracking",
      origin: "user_stated",
      support: "credible",
    });
  });

  it("refuses — writing nothing — when the field has changed again since the approval it would undo", async () => {
    const { proposalId } = await stageAndApprove();

    // Same reasoning as the stale-item test above: the owner's own direct
    // edit, not a `service_role` write `project_fields` has no grant for.
    await impersonate(USER_A);
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

/*
  A proposal-contingent assumption's lifecycle (T11 review round 5, issue
  #28): recorded alongside a connected-change proposal, it must not read as
  active project truth until that proposal is actually approved — and
  rejecting or undoing the proposal must not leave it looking settled.
*/
describe.skipIf(skip)(
  "assumption lifecycle tied to a connected-change proposal",
  () => {
    async function assumptionRow(projectId: string, statement: string) {
      const { rows } = await db.query(
        `select source_change_proposal_id, pending_decision
         from assumptions where project_id = $1 and statement = $2`,
        [projectId, statement],
      );
      return rows[0] as
        | {
            source_change_proposal_id: string | null;
            pending_decision: boolean;
          }
        | undefined;
    }

    it("starts pending and invisible, then is promoted the moment its proposal is approved", async () => {
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
            after: "Small agencies",
          },
        ],
        {
          assumptions: [
            {
              statement: "Smaller agencies churn faster.",
              whyItMatters: "It changes the retention story.",
              importance: "material",
              contingentOnProposal: true,
            },
          ],
        },
      );
      const proposalId = result.proposals!["0"].id;

      // Reading `assumptions` directly needs the owning user's own role —
      // `assumptions` is granted only to `authenticated`, not `service_role`,
      // which is what `completeTurnWithProposal`'s own `asTrustedWriter()`
      // leaves active (the identical class of oversight round 1 already hit
      // once for `project_fields`).
      await impersonate(USER_A);
      const staged = await assumptionRow(
        projectA,
        "Smaller agencies churn faster.",
      );
      expect(staged).toMatchObject({
        source_change_proposal_id: proposalId,
        pending_decision: true,
      });

      const items = await db.query(
        "select id from change_items where proposal_id = $1",
        [proposalId],
      );
      await impersonate(USER_A);
      await applyProposal(proposalId, [
        { itemId: items.rows[0].id, included: true },
      ]);

      const promoted = await assumptionRow(
        projectA,
        "Smaller agencies churn faster.",
      );
      expect(promoted).toMatchObject({ pending_decision: false });
    });

    it("stays pending forever when the proposal is rejected — never an active hypothesis", async () => {
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
            after: "Property management companies",
          },
        ],
        {
          assumptions: [
            {
              statement: "Property managers pay faster than landlords.",
              whyItMatters: "It changes the pricing model.",
              importance: "material",
              contingentOnProposal: true,
            },
          ],
        },
      );
      const proposalId = result.proposals!["0"].id;

      await impersonate(USER_A);
      const decision = await applyProposal(proposalId, []);
      expect(decision).toMatchObject({
        outcome: "completed",
        status: "rejected",
      });

      const row = await assumptionRow(
        projectA,
        "Property managers pay faster than landlords.",
      );
      // The row survives — a historical trace of what was proposed and
      // declined — but never becomes active, exactly as if it were never
      // promoted at all.
      expect(row).toMatchObject({
        source_change_proposal_id: proposalId,
        pending_decision: true,
      });
    });

    it("stays pending on a partial approval, even when the item its reasoning depends on was the one included (T11 review round 6, P1)", async () => {
      // The link is to the whole proposal, not the specific item/area an
      // assumption reasons about — so a partial approval must never promote
      // it, regardless of which items happened to be included. A proposal
      // touching two areas, with the assumption's own reasoning naming only
      // one of them, is the concrete case the review raised; this proves the
      // conservative rule (full approval only) holds even in the more
      // favourable direction, where the included item is the one the
      // assumption is actually about.
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
            after: "Tenants",
          },
          {
            area: "mvp_scope",
            key: "core_feature",
            before: null,
            after: "Deposit dispute tracking",
          },
        ],
        {
          assumptions: [
            {
              statement: "Tenants will pay for deposit-protection tooling.",
              whyItMatters: "It changes who the paying customer is.",
              importance: "material",
              contingentOnProposal: true,
            },
          ],
        },
      );
      const proposalId = result.proposals!["0"].id;
      const items = await db.query(
        "select id, area from change_items where proposal_id = $1",
        [proposalId],
      );
      const customerItemId = items.rows.find(
        (row: { area: string }) => row.area === "customer",
      ).id as string;

      await impersonate(USER_A);
      const decision = await applyProposal(proposalId, [
        { itemId: customerItemId, included: true },
      ]);
      expect(decision).toMatchObject({
        outcome: "completed",
        status: "partially_approved",
      });

      expect(
        await assumptionRow(
          projectA,
          "Tenants will pay for deposit-protection tooling.",
        ),
      ).toMatchObject({
        source_change_proposal_id: proposalId,
        pending_decision: true,
      });
    });

    it("is retired back to pending when its approved proposal is undone", async () => {
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
            after: "Letting agencies",
          },
        ],
        {
          assumptions: [
            {
              statement: "Letting agencies negotiate on price.",
              whyItMatters: "It changes the pricing model.",
              importance: "material",
              contingentOnProposal: true,
            },
          ],
        },
      );
      const proposalId = result.proposals!["0"].id;
      const items = await db.query(
        "select id from change_items where proposal_id = $1",
        [proposalId],
      );

      await impersonate(USER_A);
      await applyProposal(proposalId, [
        { itemId: items.rows[0].id, included: true },
      ]);
      expect(
        await assumptionRow(projectA, "Letting agencies negotiate on price."),
      ).toMatchObject({ pending_decision: false });

      await undoProposal(proposalId);

      expect(
        await assumptionRow(projectA, "Letting agencies negotiate on price."),
      ).toMatchObject({ pending_decision: true });
    });

    it("records an assumption not marked contingent as immediately active, unchanged from before this fix", async () => {
      const turnId = await openRun(projectA);
      await completeTurnWithProposal(
        projectA,
        turnId,
        USER_A,
        [
          {
            area: "problem",
            key: "core_problem",
            before: null,
            after: "Slow deposit disputes",
          },
        ],
        {
          assumptions: [
            {
              statement: "Disputes concentrate at move-out.",
              whyItMatters: "It changes when to intervene.",
              importance: "material",
              contingentOnProposal: false,
            },
          ],
        },
      );

      await impersonate(USER_A);
      expect(
        await assumptionRow(projectA, "Disputes concentrate at move-out."),
      ).toMatchObject({
        source_change_proposal_id: null,
        pending_decision: false,
      });
    });
  },
);

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
