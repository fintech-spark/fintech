// Merchant Brain: E2E global setup.
//
// Starts the synthetic backend before the Next.js dev server and keeps it alive
// for the whole run. Playwright runs `globalSetup` in the main process, which
// stays alive for the duration of the suite, so one server serves every
// parallel worker.

import { STUB_ORIGIN, startStubBackend } from "./fixtures/stub-server";

export default async function globalSetup() {
  const server = await startStubBackend();
  // Surfaced so a failing test can be reproduced by hand.
  console.log(`[e2e] synthetic backend listening on ${STUB_ORIGIN}`);

  return async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
}
