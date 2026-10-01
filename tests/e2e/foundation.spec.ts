import { test, expect } from "@playwright/test";

test("development foundation route renders", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Merchant Brain/);
  await expect(
    page.getByRole("heading", { name: "Development foundation ready" }),
  ).toBeVisible();
});
