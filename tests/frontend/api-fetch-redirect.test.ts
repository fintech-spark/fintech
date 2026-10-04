// Merchant Brain: regression guard for the /overview "data service is not
// connected" false positive.
//
// The production failure: the session resolver internally `fetch`es
// `/api/auth/session`. Vercel Deployment Protection / SSO intercepts a
// same-origin server-side fetch and responds with a 302 redirect. Treating
// that as a generic backend error surfaced "data service is not connected"
// to unauthenticated visitors — a silent auth-boundary failure.
//
// The contract being defended: a redirect on `/api/auth/session` is always
// classified as unauthenticated (401), never as a backend outage, and the
// treatment is scoped to the session endpoint only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";

import { z } from "zod";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => undefined,
    has: () => false,
    getAll: () => [],
  })),
  headers: vi.fn(async () => new Headers()),
}));

const originalVercelUrl = process.env.VERCEL_URL;

function redirectResponse(
  status: 301 | 302 | 303 | 307 | 308 = 302,
): Response {
  return new Response(null, { status });
}

describe("apiFetch redirect handling", () => {
  beforeEach(() => {
    process.env.VERCEL_URL = "test.vercel.app";
  });

  afterEach(() => {
    process.env.VERCEL_URL = originalVercelUrl;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("treats a Vercel Deployment Protection redirect on /api/auth/session as unauthenticated (401), not a backend outage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => redirectResponse(302)));

    const failure = await apiFetch("/api/auth/session", z.any()).catch(
      (e) => e,
    );

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.statusCode).toBe(401);
    expect(failure.isUnauthenticated).toBe(true);
    expect(failure.code).toBe("UNAUTHENTICATED");
  });

  it("does not treat a redirect on a data endpoint as unauthenticated — the session-only rule must not bleed out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => redirectResponse(302)));

    const failure = await apiFetch("/api/businesses", z.array(z.any())).catch(
      (e) => e,
    );

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.isUnauthenticated).toBe(false);
    expect(failure.statusCode).not.toBe(401);
  });
});
