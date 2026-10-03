import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase server-client for authentication & tenant context
const BIZ_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BIZ_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACTION_ID = "11111111-1111-4111-8111-111111111111";

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

// Mock wireIntelligence
const mockAnalytics = {
  getSnapshot: vi.fn(async () => ({
    businessId: BIZ_A,
    revenueMinor: 100000,
    grossProfitMinor: 40000,
    netProfitMinor: 25000,
    currency: "INR",
  })),
};

const mockCashFlow = {
  getLatestForecast: vi.fn(async () => ({ id: "fc-1", businessId: BIZ_A })),
  forecast: vi.fn(async () => ({ id: "fc-2", businessId: BIZ_A, startingCash: { amount: 50000, currency: "INR" } })),
};

const mockProfitLeaks = {
  list: vi.fn(async () => ({ items: [], total: 0, page: 1, limit: 50, hasMore: false })),
  analyze: vi.fn(async () => ({ businessId: BIZ_A, detected: [], suppressed: [] })),
};

const mockSimulator = {
  list: vi.fn(async () => ({ items: [], total: 0, page: 1, limit: 50, hasMore: false })),
  runScenario: vi.fn(async () => ({ id: "sc-1", businessId: BIZ_A, name: "Price increase" })),
};

const mockActions = {
  list: vi.fn(async () => ({ items: [], total: 0, page: 1, limit: 50, hasMore: false })),
  propose: vi.fn(async (_ctx, input) => ({ id: ACTION_ID, businessId: BIZ_A, status: "proposed", ...input })),
  approve: vi.fn(async (_ctx, id) => ({ id, businessId: BIZ_A, status: "approved" })),
  execute: vi.fn(async (_ctx, input) => ({ action: { id: input.id, status: "completed" }, executed: true })),
};

vi.mock("@/lib/http/wiring", () => ({
  wireIntelligence: vi.fn(() => ({
    analytics: mockAnalytics,
    cashFlow: mockCashFlow,
    profitLeaks: mockProfitLeaks,
    simulator: mockSimulator,
    actions: mockActions,
  })),
}));

import { GET as getAnalyticsSnapshot } from "@/app/api/businesses/[businessId]/analytics/snapshot/route";
import { GET as getCashFlowForecast, POST as postCashFlowForecast } from "@/app/api/businesses/[businessId]/cash-flow/forecast/route";
import { GET as getProfitLeaks } from "@/app/api/businesses/[businessId]/profit-leaks/route";
import { POST as postProfitLeaksDetect } from "@/app/api/businesses/[businessId]/profit-leaks/detect/route";
import { GET as getSimulatorScenarios, POST as postSimulatorScenarios } from "@/app/api/businesses/[businessId]/simulator/scenarios/route";
import { GET as getActions } from "@/app/api/businesses/[businessId]/actions/route";
import { POST as postActionPropose } from "@/app/api/businesses/[businessId]/actions/propose/route";
import { POST as postActionApprove } from "@/app/api/businesses/[businessId]/actions/[id]/approve/route";
import { POST as postActionExecute } from "@/app/api/businesses/[businessId]/actions/[id]/execute/route";

function makeReq(url: string, options: { method?: string; token?: string | null; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers = new Headers(options.headers || {});
  const token = options.token === undefined ? "valid-token" : options.token;
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");

  return new Request(url, {
    method: options.method ?? "GET",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

function params(businessId: string | undefined, extra: Record<string, string> = {}) {
  return {
    params: Promise.resolve({
      ...(businessId === undefined ? {} : { businessId }),
      ...extra,
    }),
  };
}

describe("Intelligence API Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication & Tenant Security", () => {
    it("returns 401 when no auth header is provided", async () => {
      const res = await getAnalyticsSnapshot(
        makeReq("http://localhost/api/businesses/" + BIZ_A + "/analytics/snapshot", { token: null }),
        params(BIZ_A)
      );
      expect(res.status).toBe(401);
    });

    it("returns 403 when caller accesses foreign business", async () => {
      const res = await getAnalyticsSnapshot(
        makeReq("http://localhost/api/businesses/" + BIZ_B + "/analytics/snapshot"),
        params(BIZ_B)
      );
      expect(res.status).toBe(403);
    });
  });

  describe("Analytics Snapshot", () => {
    it("returns 200 with default 30-day period", async () => {
      const res = await getAnalyticsSnapshot(
        makeReq("http://localhost/api/businesses/" + BIZ_A + "/analytics/snapshot"),
        params(BIZ_A)
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.currency).toBe("INR");
      expect(mockAnalytics.getSnapshot).toHaveBeenCalled();
    });

    it("returns 400 when from date is after to date", async () => {
      const res = await getAnalyticsSnapshot(
        makeReq("http://localhost/api/businesses/" + BIZ_A + "/analytics/snapshot?from=2026-03-01T00:00:00Z&to=2026-01-01T00:00:00Z"),
        params(BIZ_A)
      );
      expect(res.status).toBe(400);
    });
  });

  describe("Cash Flow", () => {
    it("GET /cash-flow/forecast returns 200 with latest forecast", async () => {
      const res = await getCashFlowForecast(
        makeReq("http://localhost/api/businesses/" + BIZ_A + "/cash-flow/forecast"),
        params(BIZ_A)
      );
      expect(res.status).toBe(200);
      expect(mockCashFlow.getLatestForecast).toHaveBeenCalled();
    });

    it("POST /cash-flow/forecast returns 201 with new projection", async () => {
      const res = await postCashFlowForecast(
        makeReq("http://localhost/api/businesses/" + BIZ_A + "/cash-flow/forecast", {
          method: "POST",
          body: { horizonDays: 60 },
        }),
        params(BIZ_A)
      );
      expect(res.status).toBe(201);
      expect(mockCashFlow.forecast).toHaveBeenCalled();
    });
  });

  describe("Profit Leaks", () => {
    it("GET /profit-leaks returns 200 with leak list", async () => {
      const res = await getProfitLeaks(
        makeReq("http://localhost/api/businesses/" + BIZ_A + "/profit-leaks?severity=high"),
        params(BIZ_A)
      );
      expect(res.status).toBe(200);
      expect(mockProfitLeaks.list).toHaveBeenCalled();
    });

    it("POST /profit-leaks/detect returns 200 with detection report", async () => {
      const res = await postProfitLeaksDetect(
        makeReq("http://localhost/api/businesses/" + BIZ_A + "/profit-leaks/detect", { method: "POST" }),
        params(BIZ_A)
      );
      expect(res.status).toBe(200);
      expect(mockProfitLeaks.analyze).toHaveBeenCalled();
    });
  });

  describe("Simulator Scenarios", () => {
    it("GET /simulator/scenarios returns 200", async () => {
      const res = await getSimulatorScenarios(
        makeReq("http://localhost/api/businesses/" + BIZ_A + "/simulator/scenarios"),
        params(BIZ_A)
      );
      expect(res.status).toBe(200);
      expect(mockSimulator.list).toHaveBeenCalled();
    });

    it("POST /simulator/scenarios returns 201 with generated scenario", async () => {
      const res = await postSimulatorScenarios(
        makeReq("http://localhost/api/businesses/" + BIZ_A + "/simulator/scenarios", {
          method: "POST",
          body: {
            name: "Price hike",
            description: "5% increase on grains",
            parameters: [{
              name: "Price adjustment",
              type: "price_change",
              unit: "percentage",
              value: 5,
            }],
          },
        }),
        params(BIZ_A)
      );
      expect(res.status).toBe(201);
      expect(mockSimulator.runScenario).toHaveBeenCalled();
    });
  });

  describe("Actions Lifecycle", () => {
    it("GET /actions returns 200 with paginated actions", async () => {
      const res = await getActions(
        makeReq("http://localhost/api/businesses/" + BIZ_A + "/actions"),
        params(BIZ_A)
      );
      expect(res.status).toBe(200);
      expect(mockActions.list).toHaveBeenCalled();
    });

    it("POST /actions/propose returns 201 with proposed action", async () => {
      const res = await postActionPropose(
        makeReq("http://localhost/api/businesses/" + BIZ_A + "/actions/propose", {
          method: "POST",
          body: {
            type: "adjust_price",
            title: "Adjust grain prices",
            description: "Reflect increased procurement costs",
            source: "manual",
            parameters: { adjustmentBasisPoints: 500 },
          },
        }),
        params(BIZ_A)
      );
      expect(res.status).toBe(201);
      expect(mockActions.propose).toHaveBeenCalled();
    });

    it("POST /actions/:id/approve returns 200", async () => {
      const res = await postActionApprove(
        makeReq("http://localhost/api/businesses/" + BIZ_A + "/actions/" + ACTION_ID + "/approve", {
          method: "POST",
        }),
        params(BIZ_A, { id: ACTION_ID })
      );
      expect(res.status).toBe(200);
      expect(mockActions.approve).toHaveBeenCalledWith(expect.anything(), ACTION_ID);
    });

    it("POST /actions/:id/execute returns 200 and forwards idempotency-key", async () => {
      const res = await postActionExecute(
        makeReq("http://localhost/api/businesses/" + BIZ_A + "/actions/" + ACTION_ID + "/execute", {
          method: "POST",
          headers: { "idempotency-key": "exec-key-123" },
        }),
        params(BIZ_A, { id: ACTION_ID })
      );
      expect(res.status).toBe(200);
      expect(mockActions.execute).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: ACTION_ID, idempotencyKey: "exec-key-123" })
      );
    });
  });
});
