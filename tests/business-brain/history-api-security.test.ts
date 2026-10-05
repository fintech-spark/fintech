import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";
import { tenantFor, BUSINESS_A } from "../helpers/fake-database";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), wire: vi.fn(), history: vi.fn() }));
vi.mock("@/lib/ai/composition", () => ({ wireBusinessBrain: mocks.wire }));
vi.mock("@/lib/http/auth-context", async (original) => ({ ...await original<typeof import("@/lib/http/auth-context")>(), resolveTenantContext: mocks.resolve }));
import { GET } from "@/app/api/businesses/[businessId]/ai/history/route";
const sessionId = "cccccccc-0000-4000-8000-00000000000c";
const route = { params: Promise.resolve({ businessId: BUSINESS_A }) };
const request = (query = `sessionId=${sessionId}`, headers: Record<string, string> = { authorization: "Bearer synthetic" }) => new Request(`http://localhost/api/history?${query}`, { headers });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({ ctx: tenantFor(BUSINESS_A) });
  mocks.wire.mockReturnValue({ brain: { getSessionHistory: mocks.history } });
  mocks.history.mockResolvedValue({ messages: [], nextCursor: 5 });
});
describe("History API security", () => {
  it("requires credentials even when demo is enabled", async () => {
    expect((await GET(request(undefined, {}), route)).status).toBe(401);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it.each([new AuthenticationError(), new AuthorizationError()])("maps identity/membership rejection without executing history", async (error) => {
    mocks.resolve.mockRejectedValue(error);
    expect((await GET(request(), route)).status).toBe(error.statusCode);
    expect(mocks.history).not.toHaveBeenCalled();
  });
  it("denies staff", async () => {
    mocks.resolve.mockResolvedValue({ ctx: { ...tenantFor(BUSINESS_A), role: "staff" } });
    expect((await GET(request(), route)).status).toBe(403);
    expect(mocks.wire).not.toHaveBeenCalled();
  });
  it.each(["sessionId=forged", `sessionId=${sessionId}&limit=101`, `sessionId=${sessionId}&before=-1`, `sessionId=${sessionId}&userId=other`])("rejects invalid query %s", async (query) => {
    expect((await GET(request(query), route)).status).toBe(400);
    expect(mocks.history).not.toHaveBeenCalled();
  });
  it("passes only scoped context and bounded pagination", async () => {
    const response = await GET(request(`sessionId=${sessionId}&limit=20&before=100`), route);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.history).toHaveBeenCalledWith(tenantFor(BUSINESS_A), sessionId, { limit: 20, before: 100 });
    expect(await response.json()).toEqual({ data: { messages: [], nextCursor: 5 } });
  });
});
