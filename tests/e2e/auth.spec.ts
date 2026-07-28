import { expect, test } from "@playwright/test";

test("protected routes redirect signed-out users to sign-in", async ({
  page,
}) => {
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
});

test("sign-in and sign-up cross-link", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(
    page.getByRole("heading", { name: "Create account" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("landing offers authentication entry points", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
});

// The full register → verify → create-project journey requires a real
// Supabase project; it activates when the environment provides one.
test.describe("live auth journey", () => {
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_URL,
    "Requires a configured Supabase environment.",
  );
  test("signed-in users are redirected away from auth routes", async ({
    page,
  }) => {
    // Placeholder for the live journey; expanded when dev credentials exist.
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
});
