import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/dev/workspace");
  await page.waitForFunction(
    () => localStorage.getItem("ppm.workspace-layout") !== null,
  );
});

test("canvas opens on the visual relationship map with an explicit switch", async ({
  page,
}) => {
  await expect(
    page.getByRole("region", { name: "Living canvas" }),
  ).toBeVisible();
  await expect(page.getByRole("radio", { name: "Visual view" })).toBeChecked();
  await expect(page.getByLabel("Object in focus")).toContainText(
    "Property-condition disagreement",
  );
});

test("relationships appear as labelled branches, not uniform cards", async ({
  page,
}) => {
  await expect(
    page.getByRole("region", { name: "Possible causes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Consequences" }),
  ).toBeVisible();
});

test("origin remains visible in the visual view", async ({ page }) => {
  await expect(
    page.getByLabel("Object in focus").getByText("You stated"),
  ).toBeVisible();
  const causes = page.getByRole("region", { name: "Possible causes" });
  await expect(causes.getByText("Inferred").first()).toBeVisible();
});

test("structured view shows the same objects and can hand one back to the map", async ({
  page,
}) => {
  await page.getByRole("radio", { name: "Structured view" }).click();
  await expect(
    page.getByRole("region", { name: "Current subject" }),
  ).toBeVisible();

  await page
    .getByLabel("Show Missing check-in evidence in the relationship map")
    .click();
  await expect(page.getByRole("radio", { name: "Visual view" })).toBeChecked();
  await expect(page.getByLabel("Object in focus")).toContainText(
    "Missing check-in evidence",
  );
});

test("focus and return-to-previous work from the keyboard", async ({
  page,
}) => {
  const focusButton = page.getByLabel("Focus on Missing check-in evidence");
  await focusButton.focus();
  await expect(focusButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Object in focus")).toContainText(
    "Missing check-in evidence",
  );

  const back = page.getByRole("button", { name: "Return to previous" });
  await back.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Object in focus")).toContainText(
    "Property-condition disagreement",
  );
});

test("branch collapse and hide are keyboard operable", async ({ page }) => {
  const causes = page.getByRole("region", { name: "Possible causes" });
  await causes.getByRole("button", { name: "Collapse" }).click();
  await expect(causes.getByText("Missing check-in evidence")).toBeHidden();
  await causes.getByRole("button", { name: "Expand" }).click();

  await causes.getByLabel("Hide Missing check-in evidence").click();
  await expect(causes.getByText(/1 hidden/)).toBeVisible();
});

test("reduced motion leaves the map usable", async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem(
      "ppm.appearance",
      JSON.stringify({ theme: "dark", motion: "reduced" }),
    );
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await expect(page.getByLabel("Object in focus")).toContainText(
    "Property-condition disagreement",
  );
  await page.getByLabel("Focus on Missing check-in evidence").click();
  await expect(page.getByLabel("Object in focus")).toContainText(
    "Missing check-in evidence",
  );
});

for (const theme of ["dark", "light"] as const) {
  for (const view of ["Visual view", "Structured view"] as const) {
    test(`${view} has no axe violations (${theme})`, async ({ page }) => {
      await page.evaluate((t) => {
        localStorage.setItem("ppm.appearance", JSON.stringify({ theme: t }));
      }, theme);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.waitForFunction(
        () => localStorage.getItem("ppm.appearance") !== null,
      );
      if (view === "Structured view") {
        await page.getByRole("radio", { name: view }).click();
      }
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  }
}

test("the user can edit their own meaning from the structured inspector", async ({
  page,
}) => {
  await page.getByRole("radio", { name: "Structured view" }).click();
  const subject = page.getByRole("region", { name: "Current subject" });

  await subject.getByLabel("Edit Property-condition disagreement").click();
  const field = subject.getByLabel("Edit Property-condition disagreement");
  await field.fill("Disagreements about wear and tear when a tenancy ends.");
  await subject.getByRole("button", { name: "Save" }).click();

  await expect(
    subject.getByText("Disagreements about wear and tear when a tenancy ends."),
  ).toBeVisible();
});

test("editing inferred text warns that it becomes the user's wording", async ({
  page,
}) => {
  await page.getByRole("radio", { name: "Structured view" }).click();
  const assumptions = page.getByRole("region", { name: "Assumptions" });
  await assumptions
    .getByLabel("Edit Disagreements usually become deposit disputes")
    .click();
  await expect(
    assumptions.getByText(
      /marks this as your own wording rather than inferred/i,
    ),
  ).toBeVisible();

  // Escape closes without saving and hands focus back to the trigger.
  await page.keyboard.press("Escape");
  await expect(
    assumptions.getByText(/marks this as your own wording/i),
  ).toBeHidden();
  await expect(
    assumptions.getByLabel(
      "Edit Disagreements usually become deposit disputes",
    ),
  ).toBeFocused();
});

test("assumption alternatives and recommended validation are shown", async ({
  page,
}) => {
  await page.getByRole("radio", { name: "Structured view" }).click();
  const assumptions = page.getByRole("region", { name: "Assumptions" });
  await expect(assumptions.getByText("Possible alternatives")).toBeVisible();
  await expect(assumptions.getByText("Recommended validation")).toBeVisible();
  await expect(assumptions.getByText(/Ask five letting agents/)).toBeVisible();
});
