import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Scanning a page that is still hydrating reports violations that do not exist
 * a frame later. Waiting for the document to be interactive and for the render
 * to settle makes the scan a fact about the page rather than about timing.
 */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

/**
 * T8 acceptance: a scripted multi-step turn must be observable, steerable,
 * stoppable and honestly recorded.
 */
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/dev/workspace");
  await page.waitForFunction(
    () => localStorage.getItem("ppm.workspace-layout") !== null,
  );
});

async function send(page: import("@playwright/test").Page, message: string) {
  await page.getByLabel("Message").fill(message);
  await page.getByRole("button", { name: "Send" }).click();
}

test("activity appears while work happens and fades when it is done", async ({
  page,
}) => {
  const conversation = page.getByRole("region", { name: "Conversation" });
  await send(page, "Tenants and landlords argue about property condition.");

  /*
    The step is reported at the conversation while the turn runs — in whichever
    lifecycle state it is currently in, since reading the demo model is fast —
    and is gone once the turn ends, with the result still on screen.
  */
  const modelStep = conversation.getByText(
    /Reading the current project model…|Project model read/,
  );
  await expect(modelStep).toBeVisible();
  await expect(conversation.getByText(/not connected yet/)).toBeVisible();
  await expect(modelStep).toBeHidden();
});

test("canvas work is reported at the canvas, not in the conversation", async ({
  page,
}) => {
  const canvas = page.getByRole("region", { name: "Living canvas" });
  await send(page, "Tenants and landlords argue about property condition.");

  await expect(
    canvas.getByText(/Preparing a canvas view|Canvas view prepared/),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Conversation" })
      .getByText(/canvas view/i),
  ).toBeHidden();
});

test("no progress percentage is shown at any point in a turn", async ({
  page,
}) => {
  await send(page, "Tenants and landlords argue about property condition.");
  await expect(page.getByText(/\d+\s?% complete/)).toHaveCount(0);
  await expect(page.locator("progress")).toHaveCount(0);
});

test("the full activity history stays retrievable after the turn", async ({
  page,
}) => {
  await send(page, "Tenants and landlords argue about property condition.");
  await expect(
    page
      .getByRole("region", { name: "Conversation" })
      .getByText(/not connected yet/),
  ).toBeVisible();

  await page.getByRole("button", { name: "Activity history" }).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByText("Project model read")).toBeVisible();
  await expect(panel.getByText("Canvas view prepared")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("a turn can be steered, and the system states what it will do", async ({
  page,
}) => {
  await send(page, "Tenants and landlords argue about property condition.");

  const direction = page.getByRole("button", { name: "Add direction" });
  await expect(direction).toBeVisible();
  await page.getByLabel("Message").fill("Focus on smaller letting agencies.");
  await direction.click();

  /*
    One of two honest outcomes, and never silence. If the turn was still
    running the system states when the direction applies and then whether it
    was picked up; if it had already finished, it says the direction was not
    recorded. Which one happens is a real property of the running turn, so the
    browser cannot assert it — the handoff itself is proved without timing in
    the route and engine tests.
  */
  await expect(
    page.getByText(
      /applied at the next step of this turn|picked up by this turn|no longer running, so the direction was not recorded/,
    ),
  ).toBeVisible();
});

test("a direction for a turn that is not running is refused, not silently dropped", async ({
  page,
}) => {
  await send(page, "Tenants and landlords argue about property condition.");
  await expect(
    page.getByRole("button", { name: "Add direction" }),
  ).toBeVisible();

  const refused = await page.evaluate(async () => {
    const response = await fetch("/api/dev/directions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        turnId: "99999999-9999-4999-8999-999999999999",
        note: "Steer a turn that does not exist.",
      }),
    });
    return response.status;
  });
  expect(refused).toBe(404);
});

test("a stopped turn keeps the message and does not present a partial answer", async ({
  page,
}) => {
  const conversation = page.getByRole("region", { name: "Conversation" });
  await send(page, "Tenants and landlords argue about property condition.");

  // Wait until text has actually started arriving, so the stop is mid-answer.
  const response = conversation.getByRole("article", { name: "Response" });
  await expect(response).toContainText("You said");
  await page.getByRole("button", { name: "Stop" }).click();

  await expect(page.getByText("You stopped this response.")).toBeVisible();
  await expect(
    conversation.getByRole("article", { name: "Your turn" }),
  ).toContainText("Tenants and landlords argue about property condition.");
  // The truncated answer is discarded rather than left looking finished.
  await expect(response).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
});

test("a recommended canvas view is offered, not applied", async ({ page }) => {
  const canvas = page.getByRole("region", { name: "Living canvas" });
  await send(page, "Tenants and landlords argue about property condition.");

  await expect(
    canvas.getByText(/Showing the problem this project is exploring/),
  ).toBeVisible();
  // Until the user takes it, the view they were reading is unchanged.
  await expect(page.getByLabel("Object in focus")).toContainText(
    "Property-condition disagreement",
  );

  await canvas.getByRole("button", { name: "Stay here" }).click();
  await expect(canvas.getByRole("button", { name: "Show it" })).toHaveCount(0);
});

test("the activity panel has no axe violations", async ({ page }) => {
  await send(page, "Tenants and landlords argue about property condition.");
  await page.getByRole("button", { name: "Activity history" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await settle(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
