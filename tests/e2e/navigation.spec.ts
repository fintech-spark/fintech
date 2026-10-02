// Merchant Brain: public entry point and the honest-gap states.
//
// Flow coverage:
//   - a first-time visitor lands on something that explains the product
//   - a merchant with no session is told exactly where they are
//   - a merchant whose API is not connected is told that, not shown empty data

import { expect, test } from "@playwright/test";

import { BUSINESS_ID } from "./fixtures/data";
import { useScenario } from "./helpers";
import { STUB_ORIGIN } from "./fixtures/stub-server";

test.describe("public entry point", () => {
  test("explains the product and offers a way in", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/Merchant Brain/);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /Your business records already exist/i,
      }),
    ).toBeVisible();

    // The loop is the product; it must be legible without reading the source.
    await expect(
      page.getByRole("heading", { name: "One loop, not thirty screens" }),
    ).toBeVisible();
    for (const step of ["See", "Understand", "Verify", "Simulate", "Approve", "Act"]) {
      await expect(page.getByRole("heading", { name: step, exact: true })).toBeVisible();
    }
  });

  test("states that parts of the product are not connected yet", async ({ page }) => {
    await page.goto("/");
    // Honesty about build state is part of the product, and a judge should see
    // it without having to read the README.
    await expect(
      page.getByText(/not connected yet, and the app says so/i),
    ).toBeVisible();
  });
});

test.describe("no session", () => {
  test("explains the sign-in boundary instead of faking a login form", async ({
    page,
  }) => {
    await useScenario(page.context(), "unauthenticated");

    await page.goto("/overview");

    await expect(
      page.getByRole("heading", { name: "You are not signed in" }),
    ).toBeVisible();
    await expect(page.getByText(/verified who you are/i)).toBeVisible();
    // A password field would be a control that submits to nothing.
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });
});

test.describe("backend unavailable", () => {
  test("names the gap instead of rendering an empty dashboard", async ({ page }) => {
    await useScenario(page.context(), "error");

    await page.goto("/overview");

    await expect(page.getByText(/data service is not connected/i)).toBeVisible();
    // Not a single fabricated rupee.
    await expect(page.getByText("Money owed to you")).toHaveCount(0);
  });
});

test.describe("capability gaps", () => {
  // Each intelligence screen must state what it is for, why it is empty, and
  // offer something real to do instead.
  const screens = [
    { path: "/sales", title: "Sales", capability: "Sales and transaction history" },
    { path: "/expenses", title: "Expenses", capability: "Expense ledger" },
    { path: "/cash-flow", title: "Cash flow", capability: "Cash-flow forecast" },
    { path: "/profit-leaks", title: "Profit leaks", capability: "Profit leak detection" },
    { path: "/simulator", title: "Simulator", capability: "What-if simulator" },
    {
      path: "/business-brain",
      title: "Ask Merchant Brain",
      capability: "Business Brain answers",
    },
    { path: "/actions", title: "Action Center", capability: "Action Center" },
    { path: "/notifications", title: "Notifications", capability: "Notifications" },
  ];

  for (const screen of screens) {
    test(`${screen.path} explains what it cannot do yet`, async ({ page }) => {
      await useScenario(page.context(), "default");
      await page.goto(screen.path);

      await expect(
        page.getByRole("heading", { level: 1, name: screen.title }),
      ).toBeVisible();
      await expect(
        page.getByText(`${screen.capability} is not available yet`),
      ).toBeVisible();
      await expect(
        page.getByText(/what this screen will do/i),
      ).toBeVisible();
      // The workstream that owns the gap is named, so the limit is traceable.
      await expect(page.getByText(/Planned in Phase/i).first()).toBeVisible();
    });
  }
});

test.describe("navigation", () => {
  test("reaches every screen from the sidebar", async ({ page }) => {
    await useScenario(page.context(), "default");
    await page.goto("/overview");

    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav).toBeVisible();
    for (const label of [
      "Overview",
      "Sales",
      "Inventory",
      "Customers",
      "Suppliers",
      "Expenses",
      "Documents",
      "Cash flow",
      "Profit leaks",
      "Simulator",
      "Ask Merchant Brain",
      "Action Center",
      "Business settings",
    ]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("marks the current screen for assistive technology", async ({ page }) => {
    await useScenario(page.context(), "default");
    await page.goto("/inventory");

    const current = page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Inventory" });
    await expect(current).toHaveAttribute("aria-current", "page");
  });

  test("opens the command palette with the keyboard and navigates", async ({ page }) => {
    await useScenario(page.context(), "default");
    await page.goto("/overview");

    // Ctrl+K and ⌘K are handled by the same listener; Ctrl+K is what a
    // headless Chromium reports.
    await page.keyboard.press("Control+K");
    const dialog = page.getByRole("dialog", { name: "Go to a screen" });
    await expect(dialog).toBeVisible();

    await dialog.getByPlaceholder("Search screens…").fill("suppliers");
    await dialog.getByRole("option", { name: /Suppliers/ }).click();

    await expect(page).toHaveURL(/\/suppliers$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Suppliers" }),
    ).toBeVisible();
  });

  test("keeps business identity visible on every screen", async ({ page }) => {
    await useScenario(page.context(), "default");
    await page.goto(`/inventory`);

    await expect(page.getByText("Sharma General Store").first()).toBeVisible();
    // And it is a real control, not a label pretending to be one.
    await expect(
      page.getByRole("button", { name: /Sharma General Store/ }),
    ).toBeVisible();
  });

  test("scopes every request to the session business, never the URL", async ({
    page,
    request,
  }) => {
    // Reset the stub's request log, then prove what the server actually asked
    // for. The browser cannot observe this: these calls originate in the Next.js
    // process, which is exactly the property being tested.
    await request.get(`${STUB_ORIGIN}/__e2e__/reset`);

    const forged = "99999999-9999-4999-8999-999999999999";
    await useScenario(page.context(), "default");
    await page.goto(`/inventory?businessId=${forged}`);

    await expect(
      page.getByRole("heading", { level: 1, name: "Inventory" }),
    ).toBeVisible();
    // The page rendered from the session's business, not the URL's.
    await expect(page.getByText("Sharma General Store").first()).toBeVisible();

    const served = (await (await request.get(`${STUB_ORIGIN}/__e2e__/requests`)).json()) as {
      path: string;
      query: string;
    }[];

    const businessCalls = served.filter((entry) =>
      entry.path.startsWith("/api/businesses/"),
    );
    expect(businessCalls.length).toBeGreaterThan(0);
    for (const call of businessCalls) {
      expect(call.path).toContain(BUSINESS_ID);
      expect(call.path).not.toContain(forged);
      // A client-supplied tenant id must never reach the query string either.
      expect(call.query).not.toContain(forged);
    }
  });
});
