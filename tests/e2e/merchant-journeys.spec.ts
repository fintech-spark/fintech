// Merchant Brain: the merchant journeys.
//
// The flows from the product brief, tested against the real component tree with
// synthetic data injected at the transport layer (see `fixtures/stub-server.ts`).
// No production code knows these tests exist.
//
// Covered here:
//   FLOW 1  dashboard → metric → investigate
//   FLOW 2  dashboard → profit leak gap → evidence alternative
//   FLOW 3  dashboard → cash flow gap → the inputs a forecast would use
//   FLOW 4  inventory → search → reorder signal
//   FLOW 6  simulator gap → the promise stated, nothing fake
//   FLOW 8  approval boundary: state is server-authoritative
//
// FLOW 5 (Business Brain answers) and FLOW 7 (action approval) cannot be
// end-to-end tested yet — their backends do not exist. They are covered by the
// capability-gap assertions in navigation.spec.ts instead, and this is reported
// rather than papered over.

import { expect, test } from "@playwright/test";

import { useScenario, VIEWPORTS } from "./helpers";

test.describe("FLOW 1 — dashboard", () => {
  test("answers what matters, then lets the merchant investigate", async ({ page }) => {
    await useScenario(page.context(), "default");
    await page.goto("/overview");

    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByText("Sharma General Store").first()).toBeVisible();

    // The merchant's position, from authoritative totals.
    await expect(page.getByText("Money owed to you", { exact: true })).toBeVisible();
    await expect(page.getByText("₹1,84,000.00").first()).toBeVisible();
    await expect(page.getByText("Money you owe", { exact: true })).toBeVisible();
    await expect(page.getByText("₹71,200.00").first()).toBeVisible();
    await expect(page.getByText("Money in stock", { exact: true })).toBeVisible();
    await expect(page.getByText("₹4,82,400.00").first()).toBeVisible();

    // Needs attention, ordered by the money involved.
    const attention = page.getByRole("heading", { name: "Needs attention" });
    await expect(attention).toBeVisible();
    await expect(page.getByText("Money owed to you is overdue")).toBeVisible();
    await expect(page.getByText("You are past a due date")).toBeVisible();
    await expect(page.getByText("Products are running out")).toBeVisible();

    // Every metric that can be investigated is a link, not a dead card.
    // The same label also appears in "Needs attention", so scope to the card.
    await page
      .getByRole("link", { name: "See who owes you" })
      .first()
      .click();
    await expect(page).toHaveURL(/\/customers\/receivables/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Money owed to you" }),
    ).toBeVisible();
  });

  test("never states a verdict it cannot support", async ({ page }) => {
    await useScenario(page.context(), "default");
    await page.goto("/overview");

    // A fabricated health score is exactly what AI_CONTEXT.md forbids.
    await expect(page.getByText(/business health/i)).toHaveCount(0);
    await expect(page.getByText(/\b\d{1,3}\s*\/\s*100\b/)).toHaveCount(0);
    // Instead, the honest signal is named.
    await expect(
      page.getByRole("heading", { name: /Here is what your records show today/ }),
    ).toBeVisible();
  });
});

test.describe("partial data", () => {
  test("says what is missing instead of silently dropping it", async ({ page }) => {
    // The inventory endpoints fail in this scenario. The other four figures must
    // still render, and the gap must be stated.
    await useScenario(page.context(), "partial");
    await page.goto("/overview");

    await expect(page.getByText("Money owed to you", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Some information is missing" })).toBeVisible();
    await expect(page.getByText(/inventory value, low-stock products/i)).toBeVisible();

    // A failed figure shows an explicit dash, never a fabricated number.
    const stockCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Money in stock" });
    await expect(stockCard.getByText("—")).toBeVisible();
    await expect(stockCard.getByText("Could not be loaded just now.")).toBeVisible();
  });
});

test.describe("FLOW 4 — inventory", () => {
  test("searches, filters and shows the reorder signal", async ({ page }) => {
    await useScenario(page.context(), "default");
    await page.goto("/inventory");

    await expect(page.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible();

    // The backend's authoritative low-stock list, not a client-side guess.
    await expect(page.getByText("Basmati Rice 5kg").first()).toBeVisible();
    await expect(page.getByText("Reorder now").first()).toBeVisible();

    // Search is debounced into the URL and hits the backend.
    await page.getByLabel("Search products").fill("Sunflower");
    await expect(page).toHaveURL(/search=Sunflower/);

    // Scope to the table: the same rows also exist as mobile record cards,
    // which are correctly hidden at this viewport.
    const table = page.getByRole("table");
    await expect(table.getByText("Sunflower Oil 1L")).toBeVisible();
    await expect(table.getByText("Basmati Rice 5kg")).toHaveCount(0);

    // A no-results search explains itself and offers a way out.
    await page.getByLabel("Search products").fill("zzzz-no-such-product");
    await expect(page.getByText("No products match those filters")).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();

    // The filter state is shareable.
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).not.toHaveURL(/search=/);
  });

  test("opens a product and states what it cannot tell you", async ({ page }) => {
    await useScenario(page.context(), "default");
    await page.goto("/inventory/44444444-4444-4444-8444-444444444441");

    await expect(
      page.getByRole("heading", { level: 1, name: "Basmati Rice 5kg" }),
    ).toBeVisible();
    await expect(page.getByText("SKU RICE-5KG")).toBeVisible();
    // Authoritative values only.
    await expect(page.getByText("₹420.00")).toBeVisible();
    await expect(page.getByText("₹560.00")).toBeVisible();
    // And the limit of the screen is named.
    await expect(
      page.getByRole("heading", { name: "What this screen cannot tell you yet" }),
    ).toBeVisible();
  });
});

test.describe("FLOW 2 — profit leaks and evidence", () => {
  test("explains the gap and routes to records that do exist", async ({ page }) => {
    await useScenario(page.context(), "default");
    await page.goto("/profit-leaks");

    await expect(
      page.getByText("Profit leak detection is not available yet"),
    ).toBeVisible();

    // The promise is specific enough to hold the product to.
    await expect(page.getByText(/found by rules, explained by evidence/i)).toBeVisible();
    await expect(page.getByText(/severity in words/i)).toBeVisible();

    // And the merchant is sent somewhere useful, not a dead end.
    await page.getByRole("link", { name: "Check your product prices" }).click();
    await expect(page).toHaveURL(/\/inventory/);
  });
});

test.describe("FLOW 3 — cash flow", () => {
  test("separates recorded figures from projections in its promise", async ({ page }) => {
    await useScenario(page.context(), "default");
    await page.goto("/cash-flow");

    await expect(page.getByText("Cash-flow forecast is not available yet")).toBeVisible();
    await expect(page.getByText(/historical figures, expected figures and projections/i)).toBeVisible();

    // The inputs a forecast would read are live today.
    await page.getByRole("link", { name: "Money owed to you, and what is late" }).click();
    await expect(page).toHaveURL(/\/customers\/receivables/);
  });
});

test.describe("FLOW 6 — simulator", () => {
  test("promises a scenario changes nothing, and fakes no result", async ({ page }) => {
    await useScenario(page.context(), "default");
    await page.goto("/simulator");

    await expect(page.getByText("What-if simulator is not available yet")).toBeVisible();
    await expect(
      page.getByText(/a scenario changes nothing in your business/i),
    ).toBeVisible();
    await expect(
      page.getByText(/percentage and percentage points kept apart/i),
    ).toBeVisible();
    // No inputs that would compute a result the backend cannot verify.
    await expect(page.getByRole("spinbutton")).toHaveCount(0);
  });
});

test.describe("FLOW 8 — the approval boundary", () => {
  test("states the consequence before the merchant commits", async ({ page }) => {
    await useScenario(page.context(), "default");
    await page.goto("/documents/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1");

    await expect(
      page.getByRole("heading", { level: 1, name: "invoice-2026-03-14.pdf" }),
    ).toBeVisible();

    // The pipeline is visible and names the step that needs the merchant.
    const rail = page.getByRole("list").first();
    await expect(rail).toBeVisible();
    await expect(page.getByText("Needs review").first()).toBeVisible();

    // Confirming asks first, and says what it means.
    await page.getByRole("button", { name: "Confirm these details" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Confirm these details?")).toBeVisible();
    await expect(
      dialog.getByText(/it becomes part of your records/i),
    ).toBeVisible();
    // The cancel path is always present.
    await expect(dialog.getByRole("button", { name: "Go back" })).toBeVisible();

    // Confirming reflects the SERVER's state, not the requested one.
    await dialog.getByRole("button", { name: "Confirm details" }).click();
    await expect(page.getByText(/Saved. This document is now confirmed/i)).toBeVisible();
    await expect(page.getByText(/state recorded by the server, not an assumption/i)).toBeVisible();
  });

  test("requires a reason before rejecting, and keeps it recorded", async ({ page }) => {
    await useScenario(page.context(), "default");
    await page.goto("/documents/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1");

    await page.getByRole("button", { name: "Reject" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByLabel("Why are you rejecting it?")).toBeVisible();

    await dialog.getByRole("button", { name: "Reject document" }).click();
    // The dialog STAYS OPEN with an inline error, rather than dismissing and
    // leaving the merchant with no idea why nothing happened.
    await expect(dialog.getByText("A reason is required")).toBeVisible();
    await expect(dialog).toBeVisible();

    await dialog
      .getByLabel("Why are you rejecting it?")
      .fill("The total does not match the invoice");
    await dialog.getByRole("button", { name: "Reject document" }).click();

    await expect(page.getByText(/Saved. This document is now rejected/i)).toBeVisible();
  });

  test("reports an unconfirmable outcome instead of guessing", async ({ page }) => {
    // `offline` destroys the connection, which is exactly the state the
    // action-approval safety rule exists for.
    await useScenario(page.context(), "default");
    await page.goto("/documents/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1");

    // Swap the scenario mid-flow so the mutation cannot reach the backend.
    await useScenario(page.context(), "offline");
    await page.getByRole("button", { name: "Confirm these details" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Confirm details" })
      .click();

    // Neither "approved" nor "rejected" — the honest answer.
    await expect(
      page.getByText(/could not confirm whether your decision was recorded/i),
    ).toBeVisible();
    await expect(
      page.getByText(/may already have been recorded/i),
    ).toBeVisible();
    // And a way to check the truth rather than retry blindly.
    await expect(
      page.getByRole("button", { name: "Check the real status" }),
    ).toBeVisible();
  });
});

test.describe("empty states", () => {
  test("explain what is empty and what to do next", async ({ page }) => {
    await useScenario(page.context(), "empty");
    await page.goto("/inventory");

    await expect(page.getByText("Nothing needs reordering")).toBeVisible();
    await expect(
      page.getByText(/This list fills itself as stock falls/i),
    ).toBeVisible();
    // A reassuring "all clear" must not claim the business was analysed.
    await expect(page.getByText(/No products yet/i)).toBeVisible();
  });

  test("a no-data overview does not pretend everything is fine", async ({ page }) => {
    await useScenario(page.context(), "empty");
    await page.goto("/overview");

    await expect(page.getByText("₹0.00").first()).toBeVisible();
    await expect(
      page.getByText(/does not mean Merchant Brain has analysed your business/i),
    ).toBeVisible();
  });
});

test.describe("responsive behaviour", () => {
  const screens = ["/overview", "/inventory", "/customers/receivables", "/documents"];

  for (const screen of screens) {
    test(`${screen} does not overflow horizontally on a phone`, async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.mobile);
      await useScenario(page.context(), "default");
      await page.goto(screen);

      // A table that pushes the page sideways is the classic mobile failure.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);

      // The phone gets its own navigation, not a squeezed sidebar.
      await expect(page.getByRole("link", { name: "Overview", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "All screens" })).toBeVisible();
    });
  }

  test("stacks records as cards on a phone and as a table on a laptop", async ({
    page,
  }) => {
    await useScenario(page.context(), "default");

    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto("/inventory");
    // The record-card list is present; the table is not rendered.
    await expect(page.getByRole("link", { name: /Basmati Rice 5kg/ }).first()).toBeVisible();

    await page.setViewportSize(VIEWPORTS.laptop);
    await page.goto("/inventory");
    await expect(page.getByRole("table")).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Reorder at" }),
    ).toBeVisible();
  });
});

test.describe("keyboard access", () => {
  test("reaches the primary navigation and a screen with the keyboard alone", async ({
    page,
  }) => {
    await useScenario(page.context(), "default");
    await page.goto("/overview");

    // Tab from the top: the skip link must come first.
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();

    // Every nav destination is a real link, so Enter works.
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Inventory" })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/inventory/);
  });

  test("search focuses on / and Escape clears it", async ({ page }) => {
    await useScenario(page.context(), "default");
    await page.goto("/customers");

    const search = page.getByLabel("Search customers");
    // The shortcut lives on a hydrated client component, so wait for it to be
    // interactive before asserting keyboard behaviour.
    await expect(search).toBeVisible();
    await page.keyboard.press("/");
    await expect(search).toBeFocused();

    await search.fill("ABC");
    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");
  });
});