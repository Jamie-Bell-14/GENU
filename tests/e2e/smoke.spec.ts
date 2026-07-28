import { expect, test } from "@playwright/test";

test("home page renders the product heading", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Intelligent Product Lab" }),
  ).toBeVisible();
});
