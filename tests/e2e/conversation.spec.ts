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

  /*
    Scoped to the turn the user wrote. The assistant reflects the same words
    back, so "the message you sent" has to be addressed as a region, not as
    text that happens to appear once — which is also how a screen-reader user
    tells them apart.
  */
  const conversation = page.getByRole("region", { name: "Conversation" });
  const yourMessage = conversation.getByRole("article", {
    name: "Your turn",
  });
  await expect(yourMessage).toContainText(
    "Tenants and landlords argue about property condition.",
  );
  await expect(yourMessage.getByText("You", { exact: true })).toBeVisible();
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
  await expect(page.getByRole("article", { name: "Your turn" })).toContainText(
    "first line",
  );
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

  await settle(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
