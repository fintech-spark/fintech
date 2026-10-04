// Merchant Brain: tenant context resolution tests.
//
// Defends the rule that an unauthenticated caller must always resolve cleanly to
// `{ status: "unauthenticated" }` without throwing, without making an unnecessary
// network request, and without misclassifying unauthenticated visitors as a
// broken backend outage.

import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { getSession, listBusinesses } from "@/lib/api/endpoints";
import { ApiError, CapabilityUnavailableError } from "@/lib/api/errors";

describe("resolveMerchantContext", () => {
  beforeEach(() => {
    mockCookieStore.clear();
    vi.clearAllMocks();
  });

  it("returns unauthenticated immediately when no access token or scenario cookie exists", async () => {
    const context = await resolveMerchantContext();
    expect(context).toEqual({ status: "unauthenticated" });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("attempts session resolution when sb-access-token cookie is present", async () => {
    mockCookieStore.set("sb-access-token", "valid-token");
    vi.mocked(getSession).mockResolvedValueOnce({
      userId: "user-1",
      email: "merchant@example.com",
      businessIds: ["biz-1"],
    });
    vi.mocked(listBusinesses).mockResolvedValueOnce([
      { id: "biz-1", name: "Spice Store", type: "retail", status: "active" },
    ]);

    const context = await resolveMerchantContext();
    expect(context.status).toBe("authenticated");
    if (context.status === "authenticated") {
      expect(context.activeBusinessId).toBe("biz-1");
      expect(context.activeBusiness.name).toBe("Spice Store");
    }
    expect(getSession).toHaveBeenCalledOnce();
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

  it("returns backend_unavailable only when the backend route itself is unavailable", async () => {
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
