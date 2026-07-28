import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/dev/primitives");
  // The appearance provider persists on mount; its write marks hydration
  // complete, so interactions after this point reach live React handlers.
  await page.waitForFunction(
    () => localStorage.getItem("ppm.appearance") !== null,
  );
});

test("dialog traps focus, closes on Escape and restores focus", async ({
  page,
}) => {
  const trigger = page.getByRole("button", { name: "Open dialog" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Discard draft?" });
  await expect(dialog).toBeVisible();

  // Focus trap: repeated Tab stays inside the dialog.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() =>
      document
        .querySelector('[role="dialog"]')
        ?.contains(document.activeElement),
    );
    expect(inside).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("sheet closes on Escape", async ({ page }) => {
  await page.getByRole("button", { name: "Open sheet" }).click();
  const sheet = page.getByRole("dialog", { name: "Review changes" });
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("dropdown menu supports arrow-key navigation and Escape", async ({
  page,
}) => {
  const trigger = page.getByRole("button", { name: "Open menu" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  // Focus lands on the menu (or its first item) asynchronously; wait for it
  // before sending arrows, then normalise position with Home.
  await page.waitForFunction(
    () => !!document.activeElement?.closest('[role="menu"]'),
  );
  await page.keyboard.press("Home");
  await expect(page.getByRole("menuitem", { name: "Pin" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Hide" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("toggle group is keyboard operable", async ({ page }) => {
  const balanced = page.getByRole("radio", { name: "Balanced" });
  await balanced.focus();
  await page.keyboard.press("ArrowRight");
  const canvas = page.getByRole("radio", { name: "Canvas" });
  await expect(canvas).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(canvas).toHaveAttribute("aria-checked", "true");
});

test("disabled and busy buttons are neutral and distinct", async ({ page }) => {
  const primary = page.getByRole("button", { name: "Save changes" });
  const disabled = page.getByRole("button", { name: "Disabled", exact: true });
  const busy = page.getByRole("button", { name: "Saving…" });
  const [primaryBg, disabledBg, busyBg] = await Promise.all(
    [primary, disabled, busy].map((locator) =>
      locator.evaluate((el) => getComputedStyle(el).backgroundColor),
    ),
  );
  // Disabled must not be the primary green; busy must differ from both.
  expect(disabledBg).not.toBe(primaryBg);
  expect(busyBg).not.toBe(primaryBg);
  expect(busyBg).not.toBe(disabledBg);
});

test("density and text-size attributes change rendered values", async ({
  page,
}) => {
  const spacingAt = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--space-4"),
    );
  const comfortable = await spacingAt();
  await page.getByRole("radio", { name: "Compact" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  expect(await spacingAt()).not.toBe(comfortable);

  const bodySize = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  const defaultSize = await bodySize();
  await page.getByRole("radio", { name: "Large" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-text-size", "large");
  expect(parseFloat(await bodySize())).toBeGreaterThan(parseFloat(defaultSize));
  // Text resizing must not create horizontal overflow (UI acceptance §11).
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test("reduced-motion preference zeroes the motion tokens", async ({ page }) => {
  await page.getByRole("radio", { name: "Reduced" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  const duration = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--motion-standard")
      .trim(),
  );
  // Browsers normalise 0ms to 0s in computed values.
  expect(["0ms", "0s"]).toContain(duration);
});
