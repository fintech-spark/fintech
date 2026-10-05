import { defineConfig, devices } from "@playwright/test";

// The E2E suite exercises Server Components, whose API calls leave the Next.js
// process rather than the browser. `tests/e2e/global-setup.ts` starts a
// synthetic backend on this port and the dev server is pointed at it, so the
// tests run through the real `lib/api/client.ts` code path — session
// forwarding, envelope decoding and the same-origin guard included.
const STUB_ORIGIN = `http://127.0.0.1:${process.env.MB_E2E_STUB_PORT ?? 4599}`;
const PORT = 3001;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // A PRODUCTION build, not `next dev`. Two reasons: the dev server's
    // on-demand compilation makes E2E slow and non-deterministic, and only the
    // production bundle exercises the real client/server boundary — so a broken
    // client-side navigation cannot hide behind Fast Refresh.
    command: `npm run build && npm run start -- --hostname 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      // Additive: with no backend branch merged, the app's own `/api/*` routes
      // do not exist, so server-side reads must be pointed somewhere real.
      API_INTERNAL_BASE_URL: STUB_ORIGIN,
      NEXT_BUILD_DIR: '.next-production',
      DEMO_MODE: 'false',
      NODE_ENV: 'production',
    },
  },
});
