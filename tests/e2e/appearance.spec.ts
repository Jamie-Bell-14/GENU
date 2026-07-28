import { expect, test } from "@playwright/test";

test("stored theme preference is applied before first paint and drives token colours", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const darkBackground = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );

  await page.evaluate(() => {
    localStorage.setItem("ppm.appearance", JSON.stringify({ theme: "light" }));
  });
  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const lightBackground = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  expect(lightBackground).not.toBe(darkBackground);
  // Light surface-canvas token (#f3f6f4).
  expect(lightBackground).toBe("rgb(243, 246, 244)");
});

test("system preference tracks the OS colour scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
