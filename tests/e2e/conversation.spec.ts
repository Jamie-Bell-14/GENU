import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/dev/workspace");
  await page.waitForFunction(
    () => localStorage.getItem("ppm.workspace-layout") !== null,
  );
});

test("opens with the product's first question, not an empty chat", async ({
  page,
}) => {
  await expect(
    page.getByText("What problem are you trying to solve?"),
  ).toBeVisible();
  await expect(page.getByLabel("Message")).toBeVisible();
});

test("sends a message and streams an attributed response", async ({ page }) => {
  const composer = page.getByLabel("Message");
  await composer.fill("Tenants and landlords argue about property condition.");
  await page.getByRole("button", { name: /send/i }).click();

  // Scoped to the conversation: the canvas also carries "You stated" labels.
  const conversation = page.getByRole("region", { name: "Conversation" });
  await expect(conversation.getByText("You", { exact: true })).toBeVisible();
  await expect(
    conversation.getByText(
      "Tenants and landlords argue about property condition.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(/This message is saved to the project/),
  ).toBeVisible();
  // The composer clears and stays in place.
  await expect(composer).toHaveValue("");
});

test("Enter sends and Shift+Enter inserts a newline", async ({ page }) => {
  const composer = page.getByLabel("Message");
  await composer.click();
  await page.keyboard.type("first line");
  await page.keyboard.down("Shift");
  await page.keyboard.press("Enter");
  await page.keyboard.up("Shift");
  await page.keyboard.type("second line");
  await expect(composer).toHaveValue("first line\nsecond line");

  await page.keyboard.press("Enter");
  await expect(composer).toHaveValue("");
  await expect(page.getByText("first line", { exact: false })).toBeVisible();
});

test("rejects an over-length message before sending", async ({ page }) => {
  const composer = page.getByLabel("Message");
  await composer.fill("x".repeat(8005));
  // Scoped to the composer's own alert: Next's route announcer is also
  // role="alert".
  await expect(
    page.getByRole("alert").filter({ hasText: "over the limit" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /send/i })).toBeDisabled();
});

test("conversation surface has no axe violations after a turn", async ({
  page,
}) => {
  await page.getByLabel("Message").fill("A problem worth exploring");
  await page.getByRole("button", { name: /send/i }).click();
  await expect(
    page.getByText(/This message is saved to the project/),
  ).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
