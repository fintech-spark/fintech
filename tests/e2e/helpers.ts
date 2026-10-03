// Merchant Brain: E2E helpers.
//
// The scenario cookie is how a test tells the synthetic backend which world to
// answer with. It travels as a cookie because `lib/api/client.ts` already
// forwards the caller's cookies, so the mechanism under test is the production
// one — not a test-only channel bolted on the side.

import type { BrowserContext } from "@playwright/test";

import { SCENARIO_COOKIE, type Scenario } from "./fixtures/data";

export const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

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
}

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1280, height: 800 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
} as const;