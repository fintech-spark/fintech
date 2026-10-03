// Merchant Brain: the request router for the E2E stub backend.
//
// A pure function: `(method, url, scenario) → { status, body }`. Keeping it
// pure means the routing rules can be unit-tested and are trivially stateless,
// so Playwright workers running in parallel cannot interfere with each other.
//
// The scenario travels in a cookie rather than in shared mutable state, so a
// test that needs the empty state cannot leak into a test that needs the happy
// path.

import {
  BUSINESS_ID,
  business,
  businesses,
  customers,
  documents,
  inventoryValue,
  lowStockProducts,
  members,
  payableTotals,
  payables,
  products,
  receivableTotals,
  receivables,
  supplierPricing,
  suppliers,
  type Scenario,
} from "./data";

export interface StubResponse {
  readonly status: number;
  readonly body: string;
  readonly contentType: string;
}

const JSON_TYPE = "application/json";

/** Endpoints the `partial` scenario fails, to exercise honest partial states. */
const PARTIAL_FAILURES = new Set([
  `/api/businesses/${BUSINESS_ID}/inventory/value`,
  `/api/businesses/${BUSINESS_ID}/inventory/low-stock`,
]);

function ok(data: unknown, meta?: Record<string, unknown>): StubResponse {
  return {
    status: 200,
    contentType: JSON_TYPE,
    body: JSON.stringify({ data, ...(meta ? { meta } : {}) }),
  };
}

function list(
  rows: readonly unknown[],
  url: URL,
  empty: boolean,
): StubResponse {
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const requested = Number(url.searchParams.get("limit") ?? "25") || 25;
  // The backend clamps `limit` to 100; the client must never ask for more.
  const limit = Math.min(Math.max(requested, 1), 100);
  const status = url.searchParams.get("status");
  const sourceType = url.searchParams.get("sourceType");
  const search = url.searchParams.get("search")?.toLowerCase();

  const source = empty ? [] : rows;
  const filtered = source.filter((row) => {
    const record = row as Record<string, unknown>;
    if (status && record.status !== status) return false;
    if (sourceType && record.sourceType !== sourceType) return false;
    if (search) {
      // Documents are searched by their original file name, everything else by
      // its display name.
      const metadata = record.metadata as { originalName?: string } | undefined;
      const name = String(record.name ?? metadata?.originalName ?? "").toLowerCase();
      if (!name.includes(search)) return false;
    }
    return true;
  });

  const start = (page - 1) * limit;
  return {
    status: 200,
    contentType: JSON_TYPE,
    body: JSON.stringify({
      data: filtered.slice(start, start + limit),
      meta: {
        total: filtered.length,
        page,
        limit,
        hasMore: start + limit < filtered.length,
      },
    }),
  };
}

function fail(status: number, name: string, code: string, message: string): StubResponse {
  return {
    status,
    contentType: JSON_TYPE,
    body: JSON.stringify({
      error: { name, code, message, statusCode: status },
    }),
  };
}

/**
 * The single source of truth for what this stub backend answers.
 *
 * If the app adds an API call, a test fails until a route exists here — which
 * is the same discipline AI_CONTEXT.md §10.1 imposes on the frontend itself.
 */
export function handleApiRequest(
  method: string,
  url: URL,
  scenario: Scenario,
): StubResponse {
  if (scenario === "unauthenticated") {
    return fail(401, "AuthenticationError", "UNAUTHENTICATED", "No active session");
  }
  if (scenario === "error") {
    return fail(
      503,
      "DatabaseError",
      "DATABASE_UNAVAILABLE",
      "Service temporarily unavailable",
    );
  }

  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/api/health") {
    return ok({ status: "ok" });
  }

  if (path === "/api/auth/session") {
    return ok({
      userId: "22222222-2222-4222-8222-222222222222",
      email: "merchant@example.com",
      businessIds: businesses.map((entry) => entry.id),
    });
  }

  if (path === "/api/businesses") {
    return ok(businesses);
  }

  // Only the `partial` scenario fails a subset; every other scenario is whole.
  if (scenario === "partial" && PARTIAL_FAILURES.has(path)) {
    return fail(
      503,
      "DatabaseError",
      "DATABASE_UNAVAILABLE",
      "Service temporarily unavailable",
    );
  }

  // `/api/businesses/{id}/resource/{resourceId}/{action}` splits into a leading
  // empty segment, so the route names start at index 2.
  const segments = path.split("/").filter(Boolean); // ["api", "businesses", ...]

  if (segments[1] === "businesses" && segments[2] !== undefined) {
    const resource = segments[3];
    const resourceId = segments[4];

    switch (resource) {
      case undefined:
        return ok(business);
      case "members":
        return ok(members);
      case "profile":
      case "settings":
        return method === "PATCH" ? ok(business) : fail(405, "ValidationError", "METHOD", "Not allowed");
      case "customers": {
        if (resourceId === undefined) return list(customers, url, scenario === "empty");
        if (resourceId === "receivables") {
          if (segments[5] === "totals") {
            return scenario === "empty" ? ok({ total: 0, overdue: 0 }) : ok(receivableTotals);
          }
          return list(receivables, url, scenario === "empty");
        }
        if (segments[5] === "balance") {
          return ok({ outstanding: 184_00_000, overdue: 184_00_000 });
        }
        return ok(customers[0]);
      }
      case "suppliers": {
        if (resourceId === undefined) return list(suppliers, url, scenario === "empty");
        if (resourceId === "payables") {
          if (segments[5] === "totals") {
            return scenario === "empty" ? ok({ total: 0, overdue: 0 }) : ok(payableTotals);
          }
          return list(payables, url, scenario === "empty");
        }
        if (segments[5] === "pricing") return ok(supplierPricing);
        return ok(suppliers[0]);
      }
      case "inventory": {
        if (resourceId === "value") {
          return scenario === "empty"
            ? ok({ totalValue: 0, productCount: 0 })
            : ok(inventoryValue);
        }
        if (resourceId === "low-stock") {
          return ok(scenario === "empty" ? [] : lowStockProducts);
        }
        if (resourceId === "products") {
          if (segments[5] === undefined) return list(products, url, scenario === "empty");
          const found = products.find((product) => product.id === segments[5]);
          return found
            ? ok(found)
            : fail(404, "NotFoundError", "NOT_FOUND", "Product not found");
        }
        return list(products, url, scenario === "empty");
      }
      case "documents": {
        if (resourceId === undefined) return list(documents, url, scenario === "empty");
        const found = documents.find((doc) => doc.id === resourceId);
        if (segments[5] === "approve") {
          return found
            ? ok({ ...found, status: "approved" })
            : fail(404, "NotFoundError", "NOT_FOUND", "Document not found");
        }
        if (segments[5] === "reject") {
          return found
            ? ok({
                ...found,
                status: "rejected",
                metadata: { ...found.metadata, rejectionReason: "Could not be read" },
              })
            : fail(404, "NotFoundError", "NOT_FOUND", "Document not found");
        }
        if (segments[5] === "status") return ok(found);
        return found
          ? ok(found)
          : fail(404, "NotFoundError", "NOT_FOUND", "Document not found");
      }
      default:
        return fail(404, "NotFoundError", "NOT_FOUND", "No such route");
    }
  }

  return fail(404, "NotFoundError", "NOT_FOUND", "No such route");
}
