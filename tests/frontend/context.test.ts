// Merchant Brain: tenant context resolution tests.
//
// Defends the rule that an unauthenticated caller must always resolve cleanly to
// `{ status: "unauthenticated" }` without throwing, without making an unnecessary
// network request, and without misclassifying unauthenticated visitors as a
// broken backend outage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCookieStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      mockCookieStore.has(name) ? { value: mockCookieStore.get(name)! } : undefined,
    has: (name: string) => mockCookieStore.has(name),
    getAll: () =>
      Array.from(mockCookieStore.entries()).map(([name, value]) => ({ name, value })),
  })),
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/api/endpoints", () => ({
  getSession: vi.fn(),
  listBusinesses: vi.fn(),
  listMembers: vi.fn(),
}));

import { resolveMerchantContext } from "@/lib/api/context";
import { DEMO_BUSINESS_ID, DEMO_BUSINESS_NAME } from "@/lib/demo";
import { getSession, listBusinesses } from "@/lib/api/endpoints";
import { ApiError, CapabilityUnavailableError } from "@/lib/api/errors";

describe("resolveMerchantContext", () => {
  const originalDemoMode = process.env.DEMO_MODE;

  beforeEach(() => {
    mockCookieStore.clear();
    vi.clearAllMocks();
    process.env.DEMO_MODE = originalDemoMode;
  });

  afterEach(() => {
    process.env.DEMO_MODE = originalDemoMode;
  });

  describe("when DEMO_MODE is enabled", () => {
    beforeEach(() => {
      process.env.DEMO_MODE = "true";
    });

    it("resolves to the controlled demo tenant when unauthenticated", async () => {
      const context = await resolveMerchantContext();
      expect(context.status).toBe("authenticated");
      if (context.status === "authenticated") {
        expect(context.activeBusinessId).toBe(DEMO_BUSINESS_ID);
        expect(context.activeBusiness.name).toBe(DEMO_BUSINESS_NAME);
      }
      expect(getSession).not.toHaveBeenCalled();
    });

    it("resolves to the controlled demo tenant when access token cookie is empty", async () => {
      mockCookieStore.set("sb-access-token", "");
      const context = await resolveMerchantContext();
      expect(context.status).toBe("authenticated");
      if (context.status === "authenticated") {
        expect(context.activeBusinessId).toBe(DEMO_BUSINESS_ID);
        expect(context.activeBusiness.name).toBe(DEMO_BUSINESS_NAME);
      }
      expect(getSession).not.toHaveBeenCalled();
    });

    it("preserves authenticated user's session and does not overwrite with demo tenant", async () => {
      mockCookieStore.set("sb-access-token", "valid-user-token");
      vi.mocked(getSession).mockResolvedValueOnce({
        userId: "real-user-123",
        email: "realmerchant@example.com",
        businessIds: ["real-biz-456"],
      });
      vi.mocked(listBusinesses).mockResolvedValueOnce([
        { id: "real-biz-456", name: "Real Merchant Store", type: "retail", status: "active" },
      ]);

      const context = await resolveMerchantContext();
      expect(context.status).toBe("authenticated");
      if (context.status === "authenticated") {
        expect(context.activeBusinessId).toBe("real-biz-456");
        expect(context.activeBusiness.name).toBe("Real Merchant Store");
        expect(context.session.email).toBe("realmerchant@example.com");
      }
    });
  });

  describe("when DEMO_MODE is disabled", () => {
    beforeEach(() => {
      process.env.DEMO_MODE = "false";
    });

    it("returns unauthenticated immediately when no access token or scenario cookie exists", async () => {
      const context = await resolveMerchantContext();
      expect(context).toEqual({ status: "unauthenticated" });
      expect(getSession).not.toHaveBeenCalled();
    });

    it("treats an empty access-token cookie as unauthenticated without a network request", async () => {
      mockCookieStore.set("sb-access-token", "");

      const context = await resolveMerchantContext();

      expect(context).toEqual({ status: "unauthenticated" });
      expect(getSession).not.toHaveBeenCalled();
    });

    it("returns unauthenticated when getSession throws a 401 ApiError", async () => {
      mockCookieStore.set("sb-access-token", "expired-token");
      vi.mocked(getSession).mockRejectedValueOnce(
        new ApiError({
          name: "AuthenticationError",
          code: "UNAUTHENTICATED",
          statusCode: 401,
          userMessage: "Sign in required",
          recovery: "Please sign in again",
        }),
      );

      const context = await resolveMerchantContext();
      expect(context).toEqual({ status: "unauthenticated" });
    });
  });

  it("returns backend_unavailable only when the backend route itself is unavailable", async () => {
    process.env.DEMO_MODE = "false";
    mockCookieStore.set("sb-access-token", "token");
    vi.mocked(getSession).mockRejectedValueOnce(
      new CapabilityUnavailableError("Signing in"),
    );

    const context = await resolveMerchantContext();
    expect(context).toEqual({
      status: "backend_unavailable",
      capability: "Signing in",
    });
  });
});
