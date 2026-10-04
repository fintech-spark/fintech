// Merchant Brain: server-side API origin resolution.
//
// The rule being defended: the server-side fetcher must always produce a real,
// absolute origin. `fetch` cannot parse a relative URL at all — and for a while
// that was the production failure, where every page reported the data service
// as unreachable while the API answered normally one path away.
//
// The origin must also come only from server-side configuration, so a forged
// `Host` can never redirect the session cookie.

import { describe, expect, it } from "vitest";

import { allowedApiOrigins, resolveApiOrigin } from "@/lib/api/client";

const DEPLOYMENT = { VERCEL_URL: "fintech-abc123.vercel.app" };
const PRODUCTION = "https://fintech-ten-xi.vercel.app";
const STUB = { API_INTERNAL_BASE_URL: "http://127.0.0.1:4599" };

describe("resolveApiOrigin", () => {
  it("prefers a configured base that can be this deployment's own origin", () => {
    expect(
      resolveApiOrigin({
        ...DEPLOYMENT,
        API_INTERNAL_BASE_URL: PRODUCTION,
      }),
    ).toBe(PRODUCTION);
  });

  it("uses the injected deployment URL when no base is configured", () => {
    expect(resolveApiOrigin(DEPLOYMENT)).toBe(
      "https://fintech-abc123.vercel.app",
    );
  });

  it("ignores a loopback base wherever a deployment URL exists", () => {
    expect(
      resolveApiOrigin({
        ...DEPLOYMENT,
        API_INTERNAL_BASE_URL: "http://localhost:3000",
      }),
    ).toBe("https://fintech-abc123.vercel.app");
    expect(
      resolveApiOrigin({ ...DEPLOYMENT, API_INTERNAL_BASE_URL: "" }),
    ).toBe("https://fintech-abc123.vercel.app");
  });

  it("keeps a loopback base when there is no deployment URL", () => {
    // The E2E stub and local dev both run outside a deployment.
    expect(resolveApiOrigin(STUB)).toBe("http://127.0.0.1:4599");
    expect(
      resolveApiOrigin({ API_INTERNAL_BASE_URL: "http://localhost:3000" }),
    ).toBe("http://localhost:3000");
  });

  it("returns no origin rather than a relative one when nothing is set", () => {
    expect(resolveApiOrigin({})).toBeUndefined();
  });

  it("always returns an origin it is allowed to call", () => {
    const env = { ...DEPLOYMENT, ...STUB };
    const origin = resolveApiOrigin(env);
    expect(origin).toBeDefined();
    expect(allowedApiOrigins(env)).toContain(origin);
  });
});

describe("allowedApiOrigins", () => {
  it("admits only origins named by server-side configuration", () => {
    const origins = allowedApiOrigins({
      ...DEPLOYMENT,
      ...STUB,
      API_INTERNAL_BASE_URL: PRODUCTION,
    });
    expect(origins).toContain(PRODUCTION);
    expect(origins).toContain("https://fintech-abc123.vercel.app");
    expect(origins).not.toContain("https://evil.example");
  });

  it("adds the scheme to a bare host and drops what is not a URL", () => {
    expect(
      allowedApiOrigins({ VERCEL_URL: "api.example.test" }),
    ).toEqual(["https://api.example.test"]);
    expect(allowedApiOrigins({ API_INTERNAL_BASE_URL: "not a url" })).toEqual(
      [],
    );
  });
});
