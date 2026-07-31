import { expect, test, type Page } from "@playwright/test";

/**
 * VERTICAL_SLICE_SPEC Steps 4–6 (T10): research flow, evidence-led result,
 * evidence entering the project — against the scripted engine and
 * `MockResearchProvider`, exactly as docs/ARCHITECTURE.md §17 prescribes for
 * this suite (no live model, no external fetch).
 */
test.beforeEach(async ({ page }) => {
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

/**
 * A recommended scene is queued, not applied under the cursor
 * (docs/ADAPTIVE_CANVAS_MVP.md §7) — the research view only replaces what is
 * on screen once the user takes it.
 */
async function showResearchView(page: Page) {
  await page
    .getByRole("region", { name: "Living canvas" })
    .getByRole("button", { name: "Show it" })
    .click();
}

test("Step 4: research activity is observably real, and the turn is steerable", async ({
  page,
}) => {
  await send(page, "Research this");

  // Never a fake progress percentage, at any point.
  await expect(page.getByText(/\d+\s?% complete/)).toHaveCount(0);

  // Steerable: the composer can add direction while research is running.
  const direction = page.getByRole("button", { name: "Add direction" });
  await expect(direction).toBeVisible();
  await page
    .getByLabel("Message")
    .fill("Focus on England and prioritise official sources.");
  await direction.click();
  await expect(
    page.getByText(
      /applied at the next step of this turn|picked up by this turn|no longer running, so the direction was not recorded/,
    ),
  ).toBeVisible();

  // The full history retains the named research steps once the turn ends —
  // asserted from the retrievable log rather than a transient live label,
  // which the scripted provider's short, timed steps can outrun.
  await expect(
    page.getByRole("button", { name: "Add as evidence" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Activity history" }).click();
  const panel = page.getByRole("dialog");
  await expect(
    panel.getByText(/GOV\.UK tenancy-deposit data searched/),
  ).toBeVisible();
  await expect(panel.getByText(/Scheme annual reports reviewed/)).toBeVisible();
  await page.keyboard.press("Escape");
});

test("Step 5: the finding is an evidence-led view, labelled as demonstration data", async ({
  page,
}) => {
  await send(page, "Research this");
  await expect(
    page.getByRole("button", { name: "Add as evidence" }),
  ).toBeVisible();
  await showResearchView(page);

  const canvas = page.getByRole("region", { name: "Living canvas" });
  await expect(
    canvas.getByText(/demonstration data.*not a live lookup/i),
  ).toBeVisible();
  await expect(canvas.getByText(/Deposit disputes are common/i)).toBeVisible();
  await expect(canvas.getByText(/Why it matters/i)).toBeVisible();
  // Honest about disagreement between the demonstration sources, styled
  // distinctly rather than presented as a settled figure.
  await expect(canvas.getByText(/sources disagree/i)).toBeVisible();

  // Explore data: the chart has a text/table alternative.
  await canvas.getByRole("radio", { name: "Explore data" }).click();
  await expect(canvas.getByRole("table")).toBeVisible();

  // Inspect sources: provenance is separated from the AI's interpretation.
  await canvas.getByRole("button", { name: /Demonstration.*Scheme/i }).click();
  await expect(canvas.getByText("Retrieved", { exact: true })).toBeVisible();
  await expect(canvas.getByText(/AI interpretation/i)).toBeVisible();
});

test("Step 5 edge case: an unavailable source is reported, not hidden", async ({
  page,
}) => {
  await send(page, "Research this");
  await expect(
    page.getByRole("button", { name: "Add as evidence" }),
  ).toBeVisible();
  await showResearchView(page);

  const canvas = page.getByRole("region", { name: "Living canvas" });
  // The scripted scenario always has one unavailable source, shown in its
  // own section rather than only alluded to in prose.
  await expect(canvas.getByText(/Sources unavailable/i)).toBeVisible();
  await expect(
    canvas.getByText(/Demonstration Regional Housing Authority/i),
  ).toBeVisible();
});

test("Step 6: adding evidence links it and states an honest consequence", async ({
  page,
}) => {
  await send(page, "Research this");
  const addAsEvidence = page.getByRole("button", { name: "Add as evidence" });
  await expect(addAsEvidence).toBeVisible();
  await addAsEvidence.click();
  await page.getByRole("button", { name: "Send" }).click();

  const conversation = page.getByRole("region", { name: "Conversation" });
  await expect(conversation.getByText(/I added the evidence/i)).toBeVisible();
  // Honest about what it does not support, not only what it does.
  await expect(conversation.getByText(/does not establish/i)).toBeVisible();
});

/*
  Idempotency for "add as evidence twice" is a database property (the
  `add_evidence_link` RPC's own conflict handling on `evidence` and
  `project_relationships`) and is proved directly against Postgres in
  supabase/tests/evidence-rls.test.ts. This dev route persists nothing at all
  (see its module doc), so it cannot honestly simulate a second call finding
  an existing row — it always reports "linked", which would make an e2e
  assertion here test the dev harness rather than the product.
*/
