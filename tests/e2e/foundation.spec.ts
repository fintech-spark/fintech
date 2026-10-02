// Merchant Brain: the public entry point.
//
// This replaces the original "development foundation route renders" check, which
// asserted the placeholder heading `Development foundation ready`. That route
// was a toolchain smoke test; it is now the real marketing entry point, so the
// assertion that actually protects the product is the one below.

import { expect, test } from "@playwright/test";

test("the public entry point renders", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBeLessThan(400);

  await expect(page).toHaveTitle(/Merchant Brain/);
  await expect(page.getByRole("main")).toBeVisible();
  // A skip link must exist and target the main landmark.
  await expect(page.getByRole("link", { name: "Skip to main content" })).toHaveAttribute(
    "href",
    "#main-content",
  );
});

test("an unknown URL inside the app explains itself", async ({ page }) => {
  const response = await page.goto("/this-screen-does-not-exist");
  // Either Next's own 404 or the app's, but never a raw crash.
  expect(response?.status()).toBeLessThan(500);
  await expect(page.getByRole("main")).toBeVisible();
});