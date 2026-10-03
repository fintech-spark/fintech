import { describe, it, expect, vi, beforeEach } from "vitest";

const BIZ_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BIZ_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

vi.mock("@/lib/supabase/server-client", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: USER_ID, email: "owner@example.test" } },
        error: null,
      })),
    },
    rpc: vi.fn(async (fn: string) => {
      if (fn === "auth_user_businesses") {
        return { data: [BIZ_A], error: null };
      }
      return { data: null, error: null };
    }),
    from: vi.fn((table: string) => {
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "insert", "update", "delete"]) {
        builder[m] = vi.fn(() => builder);
      }
      for (const m of ["eq", "neq", "in", "order", "range", "limit"]) {
        builder[m] = vi.fn(() => builder);
      }
      builder.single = vi.fn(async () => ({
        data: table === "business_members"
          ? { business_id: BIZ_A, user_id: USER_ID, role: "owner", status: "active" }
          : null,
        error: null,
      }));
      builder.maybeSingle = vi.fn(async () => ({
        data: table === "business_members"
          ? { business_id: BIZ_A, user_id: USER_ID, role: "owner", status: "active" }
          : null,
        error: null,
      }));
      builder.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data: table === "business_members"
            ? [{ business_id: BIZ_A, user_id: USER_ID, role: "owner", status: "active" }]
            : [],
          error: null,
        }).then(resolve);
      return builder;
    }),
  })),
}));

const mockBrain = {
  query: vi.fn(async () => ({
    message: "Your revenue last month was INR 50,000.",
    toolsUsed: [{ toolName: "sales_summary", input: {}, output: null, latencyMs: 12 }],
    evidence: [{
      type: "calculation",
      resourceId: "metric-sales",
      description: "Sales total from ledger",
      value: "5000000",
    }],
    confidence: "high" as const,
    metadata: {
      totalLatencyMs: 45,
      modelUsed: "deterministic-grounding",
      tokensUsed: 120,
      ragContextUsed: false,
    },
  })),
};

vi.mock("@/lib/ai/composition", () => ({
  wireBusinessBrain: vi.fn(() => ({
    brain: mockBrain,
  })),
}));

import { POST as postAiChat } from "@/app/api/businesses/[businessId]/ai/chat/route";

function makeReq(url: string, options: { method?: string; token?: string | null; body?: unknown } = {}) {
  const headers = new Headers();
  const token = options.token === undefined ? "valid-token" : options.token;
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");

  return new Request(url, {
    method: options.method ?? "POST",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

function params(businessId: string) {
  return {
    params: Promise.resolve({ businessId }),
  };
}

describe("POST /api/businesses/[businessId]/ai/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no auth token is provided", async () => {
    const res = await postAiChat(
      makeReq("http://localhost/api/businesses/" + BIZ_A + "/ai/chat", { token: null, body: { message: "Hello" } }),
      params(BIZ_A)
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when user belongs to BIZ_A but requests BIZ_B", async () => {
    const res = await postAiChat(
      makeReq("http://localhost/api/businesses/" + BIZ_B + "/ai/chat", { body: { message: "Hello" } }),
      params(BIZ_B)
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when message is empty", async () => {
    const res = await postAiChat(
      makeReq("http://localhost/api/businesses/" + BIZ_A + "/ai/chat", { body: { message: "" } }),
      params(BIZ_A)
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when message exceeds max length", async () => {
    const res = await postAiChat(
      makeReq("http://localhost/api/businesses/" + BIZ_A + "/ai/chat", { body: { message: "a".repeat(4001) } }),
      params(BIZ_A)
    );
    expect(res.status).toBe(400);
  });

  it("returns 200 with grounded BrainResponse for valid question", async () => {
    const res = await postAiChat(
      makeReq("http://localhost/api/businesses/" + BIZ_A + "/ai/chat", {
        body: { message: "Why did my sales drop last month?" },
      }),
      params(BIZ_A)
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.confidence).toBe("high");
    expect(json.data.evidence.length).toBeGreaterThan(0);
    expect(json.data.message).toContain("INR 50,000");
    expect(mockBrain.query).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: BIZ_A }),
      expect.objectContaining({
        businessId: BIZ_A,
        message: "Why did my sales drop last month?",
      })
    );
  });
});
