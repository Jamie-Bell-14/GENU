import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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

  const line = conversation.getByText("Reading the current project model…");
  await expect(line).toBeVisible();
  // The result remains after the temporary line has gone.
  await expect(conversation.getByText(/not connected yet/)).toBeVisible();
  await expect(line).toBeHidden();
});

test("canvas work is reported at the canvas, not in the conversation", async ({
  page,
}) => {
  const canvas = page.getByRole("region", { name: "Living canvas" });
  await send(page, "Tenants and landlords argue about property condition.");

  await expect(
    canvas.getByText("Preparing a canvas view of the current problem…"),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Conversation" })
      .getByText("Preparing a canvas view"),
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
  await expect(panel.getByText("Recording your message…")).toBeVisible();
  await expect(
    panel.getByText("Preparing a canvas view of the current problem…"),
  ).toBeVisible();

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

  // The promise is specific about when it applies…
  await expect(
    page.getByText(/applied at the next step of this turn/),
  ).toBeVisible();
  // …and the turn then reports that it actually picked it up.
  await expect(
    page.getByText("Your direction was picked up by this turn."),
  ).toBeVisible();
  await expect(
    page.getByText("Focus on smaller letting agencies."),
  ).toBeVisible();
});

test("a turn can be stopped and says so without losing the message", async ({
  page,
}) => {
  await send(page, "Tenants and landlords argue about property condition.");
  await page.getByRole("button", { name: "Stop" }).click();

  const conversation = page.getByRole("region", { name: "Conversation" });
  await expect(
    conversation.getByText(
      "Tenants and landlords argue about property condition.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
});

test("a recommended canvas view is offered, not applied", async ({ page }) => {
  const canvas = page.getByRole("region", { name: "Living canvas" });
  await send(page, "Tenants and landlords argue about property condition.");

  await expect(
    canvas.getByText(/Showing the problem currently in focus/),
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

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
