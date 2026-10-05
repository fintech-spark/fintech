// Merchant Brain: E2E helpers.
//
// The scenario cookie is how a test tells the synthetic backend which world to
// answer with. It travels as a cookie because `lib/api/client.ts` already
// forwards the caller's cookies, so the mechanism under test is the production
// one — not a test-only channel bolted on the side.

import type { BrowserContext } from "@playwright/test";

import { SCENARIO_COOKIE, type Scenario } from "./fixtures/data";
import { STUB_ORIGIN } from './fixtures/stub-server';

export const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3001";

/** Selects the backend scenario for every request this context makes. */
export async function useScenario(
  context: BrowserContext,
  scenario: Scenario,
): Promise<void> {
  await context.addCookies([
    {
      name: SCENARIO_COOKIE,
      value: scenario,
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  await context.unroute('**/api/businesses/**');
  await context.route('**/api/businesses/**', async (route) => {
    if (scenario === 'offline') return route.abort('failed');
    const url = new URL(route.request().url());
    const response = await route.fetch({url:`${STUB_ORIGIN}${url.pathname}${url.search}`,headers:{...route.request().headers(),cookie:`${SCENARIO_COOKIE}=${scenario}`}});
    await route.fulfill({response});
  });
}

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1024, height: 768 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
} as const;
