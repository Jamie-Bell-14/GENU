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
    // Scan only after hydration: axe on a half-hydrated page reports ARIA
    // state that React has not attached yet. The appearance provider's
    // storage write on mount is the hydration signal.
    await page.waitForFunction(
      () => localStorage.getItem("ppm.appearance") !== null,
    );

    await settle(page);
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
