import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({
    getAll: () => [],
  })),
}));

import { runScenario } from "@/lib/api/endpoints";

describe("Simulator API Endpoint Regression Tests", () => {
  it("SimulatorClient component calls the canonical /simulator/scenarios endpoint instead of /scenarios", () => {
    const filePath = path.resolve(process.cwd(), "components/simulator/simulator-client.tsx");
    const content = fs.readFileSync(filePath, "utf-8");

    // Must NOT have the broken non-simulator endpoint:
    expect(content).not.toMatch(/\/api\/businesses\/(\$\{[^}]+\}|[^/]+)\/scenarios['"`]/);

    // Must have the canonical /simulator/scenarios endpoint:
    expect(content).toContain("/api/businesses/${encodeURIComponent(businessId)}/simulator/scenarios");
  });

  it("runScenario endpoint helper invokes POST /api/businesses/{businessId}/simulator/scenarios", async () => {
    const mockScenario = {
      id: "scen_123",
      businessId: "biz_123",
      name: "Test Scenario",
      status: "calculated",
      period: {
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-01-31T23:59:59.999Z",
      },
      currency: "INR",
      calculatedAt: "2026-02-01T00:00:00.000Z",
      baseline: {
        revenue: 100000,
        cogs: 60000,
        grossProfit: 40000,
        grossMarginBps: 4000,
        operatingExpenses: 10000,
        netProfit: 30000,
        netMarginBps: 3000,
        grossRevenue: 100000,
        discounts: 0,
        quantitySold: 10,
        saleCount: 5,
      },
      projected: {
        revenue: 105000,
        cogs: 60000,
        grossProfit: 45000,
        grossMarginBps: 4286,
        operatingExpenses: 10000,
        netProfit: 35000,
        netMarginBps: 3333,
        grossRevenue: 105000,
        discounts: 0,
        quantitySold: 10,
        saleCount: 5,
      },
      comparison: {
        revenueDelta: 5000,
        grossProfitDelta: 5000,
        profitDelta: 5000,
        marginDeltaBps: 333,
        adverse: false,
        direction: "increase",
        summary: "Revenue projected to increase by 5%",
      },
      assumptions: [],
      parameters: [
        {
          type: "price_change",
          currentValue: 0,
          newValue: 500,
          unit: "percentage",
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: mockScenario }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);
    const origBase = process.env.API_INTERNAL_BASE_URL;
    process.env.API_INTERNAL_BASE_URL = "http://localhost:3000";

    const result = await runScenario("biz_abc_123", {
      name: "Price hike",
      parameters: [
        {
          type: "price_change",
          currentValue: 0,
          newValue: 500,
          unit: "percentage",
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalled();
    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe("http://localhost:3000/api/businesses/biz_abc_123/simulator/scenarios");
    expect(result.id).toBe("scen_123");

    process.env.API_INTERNAL_BASE_URL = origBase;
    vi.unstubAllGlobals();
  });
});
