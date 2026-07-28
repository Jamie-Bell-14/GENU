import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/dev/workspace");
  await page.waitForFunction(
    () => localStorage.getItem("ppm.workspace-layout") !== null,
  );
});

test("shell exposes landmarks and skip links", async ({ page }) => {
  await expect(
    page.getByRole("navigation", { name: "Planning" }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Conversation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Living canvas" }),
  ).toBeVisible();

  // First Tab lands on the skip link; activating it moves focus target.
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to conversation" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#conversation-pane/);
});

test("planning navigation collapses and the choice persists", async ({
  page,
}) => {
  const nav = page.getByRole("navigation", { name: "Planning" });
  await expect(nav).toBeVisible();
  await page.getByRole("button", { name: "Hide planning navigation" }).click();
  await expect(nav).toBeHidden();

  await page.reload();
  await expect(nav).toBeHidden();
  await page.getByRole("button", { name: "Show planning navigation" }).click();
  await expect(nav).toBeVisible();
});

test("divider is a keyboard-resizable separator and the split persists", async ({
  page,
}) => {
  const separator = page.getByRole("separator").first();
  await expect(separator).toBeVisible();

  const widthOf = () =>
    page
      .getByRole("region", { name: "Conversation" })
      .evaluate((el) => el.getBoundingClientRect().width);

  const before = await widthOf();
  await separator.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  const after = await widthOf();
  expect(after).toBeGreaterThan(before);

  // The split persists across reload (150ms debounce first). Panels report
  // zero width until the client remounts with the stored layout, so poll.
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForFunction(
    () => localStorage.getItem("ppm.workspace-layout") !== null,
  );
  await expect.poll(widthOf, { timeout: 5000 }).toBeGreaterThan(after - 20);
});

test("focus modes show one surface and restore balanced", async ({ page }) => {
  await page.getByRole("radio", { name: "Conversation" }).click();
  await expect(
    page.getByRole("region", { name: "Conversation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Living canvas" }),
  ).toBeHidden();

  await page.getByRole("radio", { name: "Canvas" }).click();
  await expect(
    page.getByRole("region", { name: "Living canvas" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Conversation" })).toBeHidden();

  // Mode persists.
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Living canvas" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Conversation" })).toBeHidden();

  await page.getByRole("radio", { name: "Balanced" }).click();
  await expect(
    page.getByRole("region", { name: "Conversation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Living canvas" }),
  ).toBeVisible();
});

test("settings menu changes the theme from the shell", async ({ page }) => {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

for (const theme of ["dark", "light"] as const) {
  test(`workspace shell has no axe violations (${theme})`, async ({ page }) => {
    await page.evaluate((t) => {
      localStorage.setItem("ppm.appearance", JSON.stringify({ theme: t }));
    }, theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.waitForFunction(
      () => localStorage.getItem("ppm.appearance") !== null,
    );
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}
