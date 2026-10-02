// Merchant Brain: the E2E stub backend.
//
// WHY A SERVER AND NOT `page.route`.
//
// Every API call in this app is made from a React Server Component, so the
// request originates in the Next.js process — not in the browser. Playwright's
// `page.route` only intercepts browser traffic and cannot see it. Rather than
// move data fetching into the client (which would put tenant data in the
// browser and weaken the architecture), the tests point the app's
// server-side fetcher at this stub instead.
//
// `API_INTERNAL_BASE_URL` already exists in `lib/api/client.ts`, where
// `assertInternalUrl` refuses to forward the merchant's session cookie to any
// origin other than that base. That check is deliberately left in place and
// exercised here: the stub is configured as the trusted base, so the tests run
// through exactly the production code path.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { SCENARIO_COOKIE, type Scenario } from "./data";
import { handleApiRequest } from "./router";

export const STUB_PORT = Number(process.env.MB_E2E_STUB_PORT ?? 4599);
export const STUB_ORIGIN = `http://127.0.0.1:${STUB_PORT}`;

function readScenario(cookieHeader: string | undefined): Scenario {
  if (!cookieHeader) return "default";
  for (const part of cookieHeader.split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === SCENARIO_COOKIE && value) return value as Scenario;
  }
  return "default";
}

/**
 * Every path the stub served, newest last. A test reads this through
 * `/__e2e__/requests` to prove which tenant the app actually asked for — the
 * browser cannot observe these requests, because they originate in the Next.js
 * process rather than in the page.
 */
const served: { method: string; path: string; query: string }[] = [];

export function startStubBackend(): Promise<Server> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", STUB_ORIGIN);

    if (url.pathname === "/__e2e__/requests") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(served));
      return;
    }
    if (url.pathname === "/__e2e__/reset") {
      served.length = 0;
      response.writeHead(204);
      response.end();
      return;
    }

    const scenario = readScenario(request.headers.cookie);
    served.push({
      method: request.method ?? "GET",
      path: url.pathname,
      query: url.search,
    });

    // The `offline` scenario hangs up without a response, which is what a real
    // network failure looks like to `fetch`. It is the only way to test the
    // "we could not confirm whether that went through" state.
    if (scenario === "offline") {
      request.destroy();
      return;
    }

    const result = handleApiRequest(request.method ?? "GET", url, scenario);
    response.writeHead(result.status, {
      "content-type": result.contentType,
      "cache-control": "no-store",
    });
    response.end(result.body);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(STUB_PORT, "127.0.0.1", () => resolve(server));
  });
}

export function stubPort(server: Server): number {
  return (server.address() as AddressInfo).port;
}