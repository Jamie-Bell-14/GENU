import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Dev-only review page: exists in `next dev` (the e2e web server), not in
// production builds.
for (const theme of ["dark", "light"] as const) {
  test(`primitives review page has no axe violations (${theme})`, async ({
    page,
  }) => {
    await page.goto("/dev/primitives");
    await page.evaluate((t) => {
      localStorage.setItem("ppm.appearance", JSON.stringify({ theme: t }));
    }, theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(
      page.getByRole("heading", { name: "Primitives review" }),
    ).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("primitive focus ring uses the brand focus token", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/dev/primitives");
  const button = page.getByRole("button", { name: "Save changes" });
  await button.focus();
  const ringColor = await button.evaluate((el) => {
    // The base styles set --tw-ring-color from the ring token on focus.
    return getComputedStyle(el).getPropertyValue("--tw-ring-color").trim();
  });
  // --ring → --border-focus → #00bf63 in the dark theme.
  expect(ringColor).toContain("#00bf63");
});
