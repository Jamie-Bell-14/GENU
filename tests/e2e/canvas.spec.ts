import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/dev/workspace");
  await page.waitForFunction(
    () => localStorage.getItem("ppm.workspace-layout") !== null,
  );
});

test("canvas presents zones as ordered, labelled regions", async ({ page }) => {
  const canvas = page.getByRole("region", { name: "Living canvas" });
  await expect(canvas).toBeVisible();
  for (const zone of ["Current subject", "Related concepts", "Assumptions"]) {
    await expect(page.getByRole("region", { name: zone })).toBeVisible();
  }
  // Reading order: subject first, then supporting context.
  const order = await page
    .getByRole("region")
    .filter({ hasText: "Current subject" })
    .first()
    .evaluate((el) => el.textContent?.includes("Property-condition"));
  expect(order).toBe(true);
});

test("origin is always visible on canvas objects", async ({ page }) => {
  await expect(page.getByText("You stated").first()).toBeVisible();
  await expect(page.getByText("Inferred").first()).toBeVisible();
});

test("view operations work from the keyboard and can be undone", async ({
  page,
}) => {
  const related = page.getByRole("region", { name: "Related concepts" });
  const hide = related.getByLabel("Hide Missing check-in evidence");
  await hide.focus();
  await expect(hide).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(related.getByText("Missing check-in evidence")).toBeHidden();
  await expect(related.getByText(/1 hidden/)).toBeVisible();

  await page.getByRole("button", { name: "Undo view changes" }).click();
  await expect(related.getByText("Missing check-in evidence")).toBeVisible();
});

test("re-centring promotes an object into the subject zone", async ({
  page,
}) => {
  await page.getByLabel("Re-centre on Missing check-in evidence").click();
  await expect(
    page
      .getByRole("region", { name: "Current subject" })
      .getByText("Missing check-in evidence"),
  ).toBeVisible();
});

for (const theme of ["dark", "light"] as const) {
  test(`canvas has no axe violations (${theme})`, async ({ page }) => {
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
