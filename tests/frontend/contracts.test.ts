// Merchant Brain: wire contract tests.
//
// The decoders in `lib/api/contracts.ts` are the only thing standing between a
// backend response and a rupee on a merchant's screen. These tests pin them to
// the shapes `app/api/**` actually returns.
//
// The rule being defended: "valid JSON is not trustworthy JSON"
// (AI_CONTEXT.md §10.4). A response missing a field, or carrying a float where
// the backend promises integer minor units, must be rejected rather than
// rendered.

import { describe, expect, it } from "vitest";

import {
  businessSchema,
  customerSchema,
  documentSchema,
  moneySchema,
  pageMetaSchema,
  productSchema,
  receivableSchema,
  sessionSchema,
  transactionSchema,
} from "@/lib/api/contracts";
import { notFoundIsMissingRoute } from "@/lib/api/errors";

const ISO = "2026-03-01T00:00:00.000Z";

const money = { amount: 125_000, currency: "INR" } as const;

describe("moneySchema", () => {
  it("accepts integer minor units", () => {
    expect(moneySchema.parse({ amount: 0, currency: "INR" })).toEqual({
      amount: 0,
      currency: "INR",
    });
  });

  it("rejects a fractional amount rather than rounding it", () => {
    // A float here means the backend violated its own Money contract. Rounding
    // it silently would hide a real data bug.
    expect(moneySchema.safeParse({ amount: 125.5, currency: "INR" }).success).toBe(
      false,
    );
  });

  it("rejects a currency the backend does not accept", () => {
    expect(
      moneySchema.safeParse({ amount: 100, currency: "JPY" }).success,
    ).toBe(false);
  });
});

describe("sessionSchema", () => {
  it("accepts the shape GET /api/auth/session returns", () => {
    const parsed = sessionSchema.parse({
      userId: "8d3f1f0e-1f1a-4a0e-9c3a-2b6a5f0c9a11",
      email: "merchant@example.com",
      businessIds: ["1a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d"],
    });
    expect(parsed.businessIds).toHaveLength(1);
  });

  it("rejects a session with no business list", () => {
    expect(sessionSchema.safeParse({ userId: "u", email: "e" }).success).toBe(false);
  });
});

describe("productSchema", () => {
  const valid = {
    id: "p1",
    businessId: "b1",
    name: "Basmati Rice 5kg",
    sku: "RICE-5",
    category: "Grocery",
    unit: "kg",
    costPrice: money,
    sellingPrice: money,
    currentStock: 24.5,
    reorderPoint: 10,
    reorderQuantity: 50,
    status: "active",
    createdAt: ISO,
    updatedAt: ISO,
  };

  it("accepts the shape GET /api/inventory/products returns", () => {
    expect(productSchema.parse(valid).currentStock).toBe(24.5);
  });

  it("treats optional fields as genuinely optional", () => {
    // sku, category and supplierId are all optional on the wire, so a product
    // that has not been categorised yet must still decode.
    const minimal = {
      id: valid.id,
      businessId: valid.businessId,
      name: valid.name,
      unit: valid.unit,
      costPrice: valid.costPrice,
      sellingPrice: valid.sellingPrice,
      currentStock: valid.currentStock,
      reorderPoint: valid.reorderPoint,
      reorderQuantity: valid.reorderQuantity,
      status: valid.status,
      createdAt: valid.createdAt,
      updatedAt: valid.updatedAt,
    };
    expect(productSchema.safeParse(minimal).success).toBe(true);
  });

  it("rejects a non-integer money amount", () => {
    expect(
      productSchema.safeParse({
        ...valid,
        costPrice: { amount: 10.5, currency: "INR" },
      }).success,
    ).toBe(false);
  });

  it("rejects a malformed timestamp instead of passing NaN downstream", () => {
    expect(
      productSchema.safeParse({ ...valid, updatedAt: "yesterday" }).success,
    ).toBe(false);
  });
});

describe("customerSchema", () => {
  const valid = {
    id: "c1",
    businessId: "b1",
    name: "ABC Traders",
    status: "active",
    totalPurchases: money,
    outstandingBalance: money,
    createdAt: ISO,
    updatedAt: ISO,
  };

  it("accepts a customer with no contact details yet", () => {
    expect(customerSchema.parse(valid).name).toBe("ABC Traders");
  });

  it("accepts an optional last transaction date", () => {
    expect(
      customerSchema.safeParse({ ...valid, lastTransactionDate: ISO }).success,
    ).toBe(true);
  });
});

describe("receivableSchema", () => {
  it("accepts the shape GET /api/customers/receivables returns", () => {
    const parsed = receivableSchema.parse({
      id: "r1",
      businessId: "b1",
      customerId: "c1",
      transactionId: "t1",
      amount: money,
      dueDate: ISO,
      status: "overdue",
      paidAmount: { amount: 0, currency: "INR" },
    });
    expect(parsed.status).toBe("overdue");
  });

  it("rejects a receivable whose status is not in the backend union", () => {
    expect(
      receivableSchema.safeParse({
        id: "r1",
        businessId: "b1",
        customerId: "c1",
        transactionId: "t1",
        amount: money,
        dueDate: ISO,
        status: "probably_fine",
        paidAmount: { amount: 0, currency: "INR" },
      }).success,
    ).toBe(false);
  });
});

describe("transactionSchema", () => {
  it("accepts a multi-line transaction", () => {
    const parsed = transactionSchema.parse({
      id: "t1",
      businessId: "b1",
      type: "sale",
      status: "completed",
      counterpartyType: "customer",
      counterpartyId: "c1",
      items: [
        {
          productId: "p1",
          productName: "Basmati Rice 5kg",
          quantity: 2,
          unitPrice: money,
          discount: { amount: 0, currency: "INR" },
          tax: { amount: 0, currency: "INR" },
          total: money,
        },
      ],
      subtotal: money,
      discount: { amount: 0, currency: "INR" },
      tax: { amount: 0, currency: "INR" },
      total: money,
      transactionDate: ISO,
      createdAt: ISO,
      updatedAt: ISO,
      createdBy: "u1",
    });
    expect(parsed.items).toHaveLength(1);
  });
});

describe("documentSchema", () => {
  const valid = {
    id: "d1",
    businessId: "b1",
    sourceType: "invoice",
    fileName: "invoice-2026-03-01.pdf",
    mimeType: "application/pdf",
    fileSize: 245_760,
    storagePath: "b1/2026/03/invoice.pdf",
    status: "review_required",
    metadata: { originalName: "invoice-2026-03-01.pdf" },
    uploadedAt: ISO,
    uploadedBy: "u1",
  };

  it("accepts a document awaiting review", () => {
    expect(documentSchema.parse(valid).status).toBe("review_required");
  });

  it("rejects a negative file size", () => {
    expect(documentSchema.safeParse({ ...valid, fileSize: -1 }).success).toBe(false);
  });
});

describe("businessSchema", () => {
  it("accepts the full profile GET /api/businesses/{id} returns", () => {
    const parsed = businessSchema.parse({
      id: "b1",
      name: "Sharma General Store",
      type: "retail",
      status: "active",
      profile: { displayName: "Sharma General Store" },
      settings: {
        currency: "INR",
        fiscalYearStart: 4,
        timezone: "Asia/Kolkata",
        lowStockThreshold: 5,
        overdueThresholdDays: 30,
      },
      createdAt: ISO,
      updatedAt: ISO,
    });
    expect(parsed.settings.currency).toBe("INR");
  });
});

describe("pageMetaSchema", () => {
  it("accepts the meta block every list route returns", () => {
    expect(
      pageMetaSchema.parse({ total: 120, page: 2, limit: 25, hasMore: true }),
    ).toEqual({ total: 120, page: 2, limit: 25, hasMore: true });
  });

  it("rejects meta without hasMore rather than guessing", () => {
    expect(
      pageMetaSchema.safeParse({ total: 1, page: 1, limit: 25 }).success,
    ).toBe(false);
  });
});

describe("notFoundIsMissingRoute", () => {
  // The distinction the whole "honest gap" story rests on: "this record is
  // gone" and "this route was never built" are different facts.
  it("treats an empty 404 body as a missing route", () => {
    expect(notFoundIsMissingRoute(404, null)).toBe(true);
    expect(notFoundIsMissingRoute(404, {})).toBe(true);
  });

  it("treats a structured 404 as a missing record", () => {
    const body = {
      error: {
        name: "NotFoundError",
        code: "NOT_FOUND",
        message: "Customer not found",
        statusCode: 404,
      },
    };
    expect(notFoundIsMissingRoute(404, body)).toBe(false);
  });

  it("never fires for another status", () => {
    expect(notFoundIsMissingRoute(500, null)).toBe(false);
    expect(notFoundIsMissingRoute(403, null)).toBe(false);
  });
});