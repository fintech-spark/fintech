import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";
import { asBusinessId, asUserId } from "@/lib/types";

const mocks = vi.hoisted(() => ({ token: "synthetic-token", resolve: vi.fn(), wire: vi.fn(), query: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => mocks.token ? { value: mocks.token } : undefined }) }));
vi.mock("@/lib/ai/composition", () => ({ wireBusinessBrain: mocks.wire }));
vi.mock("@/lib/http/auth-context", async (original) => ({ ...await original<typeof import("@/lib/http/auth-context")>(), resolveTenantContext: mocks.resolve }));
import { askBusinessBrain } from "@/app/(dashboard)/business-brain/actions";

const businessId = "aaaaaaaa-0000-4000-8000-00000000000a";
const ctx = { businessId: asBusinessId(businessId), userId: asUserId("bbbbbbbb-0000-4000-8000-00000000000b"), role: "accountant" as const, correlationId: "test" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.token = "synthetic-token";
  mocks.resolve.mockResolvedValue({ ctx });
  mocks.wire.mockReturnValue({ brain: { query: mocks.query } });
  mocks.query.mockResolvedValue({ message: "grounded", toolsUsed: [], evidence: [], confidence: "low", metadata: {} });
});

describe("Business Brain server action authorization", () => {
  it.each([new AuthenticationError("expired"), new AuthorizationError("No active membership")])("denies rejected identity or membership before composition", async (error) => {
    mocks.resolve.mockRejectedValue(error);
    expect((await askBusinessBrain(businessId, "question")).outcome).toBe("error");
    expect(mocks.wire).not.toHaveBeenCalled();
  });
  it("denies a missing cookie even in demo mode", async () => {
    mocks.token = "";
    expect((await askBusinessBrain(businessId, "question")).outcome).toBe("error");
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("denies staff analytics access", async () => {
    mocks.resolve.mockResolvedValue({ ctx: { ...ctx, role: "staff" } });
    expect((await askBusinessBrain(businessId, "question")).outcome).toBe("error");
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("uses verified identity and the actual membership role", async () => {
    expect((await askBusinessBrain(businessId, "question")).outcome).toBe("success");
    expect(mocks.query.mock.calls[0][0]).toEqual(ctx);
    const request = mocks.resolve.mock.calls[0][0] as Request;
    expect(request.headers.get("authorization")).toBe("Bearer synthetic-token");
  });
  it("rejects empty or oversized input before invoking brain", async () => {
    await askBusinessBrain(businessId, " ");
    await askBusinessBrain(businessId, "x".repeat(4001));
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
