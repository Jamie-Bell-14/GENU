import { expect, test, type Page } from "@playwright/test";

/**
 * VERTICAL_SLICE_SPEC Steps 7–8 (T11): a connected-change proposal spanning
 * several project areas, reviewed and decided item by item, including
 * partial approval and undo — against the scripted engine and the dev-only
 * proposal store in src/lib/dev/pending-proposals.ts (T11 review round 1,
 * P1: "e2e Steps 7–8 incl. partial approval and undo").
 *
 * Staleness ("stale"/"changed_since") is a real database property the dev
 * store cannot honestly reproduce; that contract is proved against Postgres
 * in supabase/tests/change-proposals-rls.test.ts, not here.
 *
 * Every proposal-decision assertion is scoped to the conversation region:
 * the canvas offers its own "Review changes" affordance while impact-review
 * is active (living-canvas.tsx's `pendingProposal` prop), so the unscoped
 * role query is ambiguous by design, not by accident.
 *
 * `pending-proposals.ts` and `dev-project-fields.ts` are one process-wide
 * store shared by the whole `next dev` server this suite runs against, not
 * something Playwright isolates per test. Each test resets them via
 * `/api/dev/reset` and this file runs serially, so a reset can never land
 * mid-test for a test running concurrently in another worker, and no test
 * ever reads another test's leftover "before" value for the same field.
 */
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page, request }) => {
  await request.post("/api/dev/reset");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/dev/workspace");
  await page.waitForFunction(
    () => localStorage.getItem("ppm.workspace-layout") !== null,
  );
});

async function send(page: Page, message: string) {
  await page.getByLabel("Message").fill(message);
  await page.getByRole("button", { name: "Send" }).click();
}

async function proposeChange(page: Page) {
  await send(page, "Propose a change");
  await expect(
    page.getByText("Narrow the target customer to small letting agencies"),
  ).toBeVisible();
  return page.getByRole("region", { name: "Conversation" });
}

test("Step 7: a connected-change proposal spans several project areas, nothing applied yet", async ({
  page,
}) => {
  const conversation = await proposeChange(page);

  const card = conversation.getByRole("group", { name: "Proposal actions" });
  await expect(card).toBeVisible();
  await expect(
    conversation.getByRole("button", { name: "Review changes" }),
  ).toBeVisible();
  await expect(
    conversation.getByRole("button", { name: "Approve direction" }),
  ).toBeVisible();
  await expect(
    conversation.getByRole("button", { name: "Keep current direction" }),
  ).toBeVisible();

  await conversation.getByRole("button", { name: "Review changes" }).click();
  const sheet = page.getByRole("dialog");
  await expect(
    sheet.getByText("Target customer", { exact: true }),
  ).toBeVisible();
  await expect(
    sheet.getByText("Problem definition", { exact: true }),
  ).toBeVisible();
  await expect(
    sheet.getByText("Value proposition", { exact: true }),
  ).toBeVisible();
  await expect(sheet.getByText("MVP scope", { exact: true })).toBeVisible();
  // None of these fields exist yet in a fresh dev workspace — "before" is
  // read from real project state, never trusted from the engine's own
  // candidate (T11 review round 2, P1), so "Currently" is honestly empty.
  await expect(sheet.getByText("Not yet set").first()).toBeVisible();
  await expect(
    sheet.getByLabel("Proposed value for Target customer"),
  ).toHaveValue("Letting agencies under 20 staff");
});

test("Step 8: partial approval warns specifically, then applies only the included items", async ({
  page,
}) => {
  const conversation = await proposeChange(page);
  await conversation.getByRole("button", { name: "Review changes" }).click();
  const sheet = page.getByRole("dialog");

  // Exclude the MVP scope item; leave the other three as proposed.
  const included = sheet.getByRole("button", { name: "Included" });
  await expect(included).toHaveCount(4);
  await included.last().click();

  const warning = sheet.getByRole("alert");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("MVP scope");
  await expect(warning).toContainText("stays as it is");

  await sheet.getByRole("button", { name: "Approve" }).click();
  await expect(sheet).toBeHidden();

  await expect(conversation.getByText("Partially approved")).toBeVisible();
  await expect(
    conversation.getByRole("button", { name: "Review changes" }),
  ).toBeVisible();
  await expect(
    conversation.getByRole("button", { name: "Undo" }),
  ).toBeVisible();
});

test("Step 8: approval visibly updates the project, and undo visibly restores it (T11 review round 2, P1)", async ({
  page,
}) => {
  const conversation = await proposeChange(page);
  await conversation.getByRole("button", { name: "Approve direction" }).click();
  await expect(conversation.getByText(/^Approved/)).toBeVisible();

  await page.getByRole("radio", { name: "Structured view" }).click();
  const canvas = page.getByRole("region", { name: "Living canvas" });
  await expect(
    canvas.getByText("Letting agencies under 20 staff"),
  ).toBeVisible();

  await conversation.getByRole("button", { name: "Undo" }).click();
  await expect(
    conversation.getByText("Undone — reverted to the prior values"),
  ).toBeVisible();
  await expect(canvas.getByText("Letting agencies under 20 staff")).toHaveCount(
    0,
  );
});

test("Step 8 edge case: undo restores the outcome to its prior state and closes off further undo", async ({
  page,
}) => {
  const conversation = await proposeChange(page);
  await conversation.getByRole("button", { name: "Approve direction" }).click();
  await expect(conversation.getByText(/^Approved/)).toBeVisible();

  await conversation.getByRole("button", { name: "Undo" }).click();
  await expect(
    conversation.getByText("Undone — reverted to the prior values"),
  ).toBeVisible();
  await expect(conversation.getByRole("button", { name: "Undo" })).toHaveCount(
    0,
  );
  await expect(
    conversation.getByRole("button", { name: "Review changes" }),
  ).toHaveCount(0);
});

test("Step 8 edge case: a decided proposal reopens read-only, with no Approve action", async ({
  page,
}) => {
  const conversation = await proposeChange(page);
  await conversation.getByRole("button", { name: "Approve direction" }).click();
  await expect(conversation.getByText(/^Approved/)).toBeVisible();

  await conversation.getByRole("button", { name: "Review changes" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Awaiting review")).toHaveCount(0);
  await expect(sheet.getByText("Approved")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Included" })).toHaveCount(0);
});

test("Step 8 edge case: a decision that cannot refresh the canvas says so honestly, and Retry recovers it", async ({
  page,
}) => {
  const conversation = await proposeChange(page);

  let blockRefresh = true;
  await page.route("**/api/dev/project-model", async (route) => {
    if (blockRefresh) {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await conversation.getByRole("button", { name: "Approve direction" }).click();
  await expect(conversation.getByText(/^Approved/)).toBeVisible();

  const notice = conversation.getByRole("alert").filter({
    hasText: "could not refresh",
  });
  await expect(notice).toBeVisible();

  blockRefresh = false;
  await conversation.getByRole("button", { name: "Retry" }).click();
  await expect(notice).toHaveCount(0);
});

test("exclude-all reads as keeping the current direction, not a silent no-op", async ({
  page,
}) => {
  const conversation = await proposeChange(page);
  await conversation
    .getByRole("button", { name: "Keep current direction" })
    .click();
  await expect(
    conversation.getByText("Rejected — kept the current direction"),
  ).toBeVisible();
  await expect(conversation.getByRole("button", { name: "Undo" })).toHaveCount(
    0,
  );
});
