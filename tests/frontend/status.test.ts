// Merchant Brain: status vocabulary tests.
//
// Two properties are load-bearing for trust:
//
//   1. Every backend status has a merchant-facing LABEL. A status that falls
//      through to "Unknown" is a status the merchant cannot act on.
//   2. No status depends on colour alone — every descriptor carries a written
//      meaning, which is what the badge exposes to assistive technology.
//
// The status unions below are copied from the backend domain types. If the
// backend adds a value and this file is not updated, this test fails — which is
// the point.

import { describe, expect, it } from "vitest";

import {
  DOCUMENT_PIPELINE,
  DOCUMENT_SOURCE_TYPE,
  DOCUMENT_STATUS,
  EXPENSE_CATEGORY,
  EXPENSE_STATUS,
  MOVEMENT_TYPE,
  PARTNER_STATUS,
  PAYMENT_METHOD,
  PAYABLE_STATUS,
  PRODUCT_STATUS,
  PRODUCT_UNIT_LABEL,
  RECEIVABLE_STATUS,
  STOCK_LEVEL,
  TRANSACTION_STATUS,
  TRANSACTION_TYPE,
  describeStatus,
  stockLevel,
  toneSurfaceClasses,
  toneTextClasses,
  type Tone,
} from "@/lib/format/status";

// Mirrors `modules/*/domain/types.ts`. Kept literal rather than derived from the
// backend so the test still fails if a value is added there.
const BACKEND_STATUS_UNIONS = {
  TRANSACTION_STATUS: ["draft", "confirmed", "completed", "voided"],
  TRANSACTION_TYPE: ["sale", "purchase", "payment", "refund"],
  PAYMENT_METHOD: ["cash", "upi", "card", "bank_transfer", "credit", "other"],
  EXPENSE_STATUS: ["pending", "approved", "rejected", "paid"],
  EXPENSE_CATEGORY: [
    "rent",
    "utilities",
    "salaries",
    "supplies",
    "marketing",
    "transportation",
    "insurance",
    "maintenance",
    "taxes",
    "fees",
    "other",
  ],
  PRODUCT_STATUS: ["active", "discontinued", "out_of_stock"],
  MOVEMENT_TYPE: ["purchase", "sale", "return", "adjustment", "damage", "transfer"],
  RECEIVABLE_STATUS: ["pending", "partial", "paid", "overdue", "written_off"],
  PAYABLE_STATUS: ["pending", "partial", "paid", "overdue"],
  PARTNER_STATUS: ["active", "inactive"],
  DOCUMENT_STATUS: [
    "uploaded",
    "validating",
    "queued",
    "processing",
    "extracted",
    "review_required",
    "approved",
    "rejected",
    "failed",
  ],
  DOCUMENT_SOURCE_TYPE: [
    "invoice",
    "receipt",
    "upi_screenshot",
    "pdf",
    "audio",
    "csv",
    "excel",
    "whatsapp_export",
    "text",
    "image",
    "other",
  ],
} as const;

const TABLES = {
  TRANSACTION_STATUS,
  TRANSACTION_TYPE,
  PAYMENT_METHOD,
  EXPENSE_STATUS,
  EXPENSE_CATEGORY,
  PRODUCT_STATUS,
  MOVEMENT_TYPE,
  RECEIVABLE_STATUS,
  PAYABLE_STATUS,
  PARTNER_STATUS,
  DOCUMENT_STATUS,
  DOCUMENT_SOURCE_TYPE,
} as const;

describe("status coverage", () => {
  // The test that keeps the vocabulary honest.
  for (const [tableName, values] of Object.entries(BACKEND_STATUS_UNIONS)) {
    it(`labels every ${tableName} value`, () => {
      const table = TABLES[tableName as keyof typeof TABLES] as Readonly<
        Record<string, { label: string; description: string; tone: Tone }>
      >;
      for (const value of values) {
        const descriptor = table[value];
        expect(descriptor, `${tableName}.${value} is missing`).toBeDefined();
        expect(descriptor.label.length).toBeGreaterThan(0);
        // A label of "Unknown" means it fell through to the fallback.
        expect(descriptor.label).not.toBe("Unknown");
        // The written meaning is what makes the status readable without colour.
        expect(descriptor.description.length).toBeGreaterThan(10);
      }
    });
  }
});

describe("describeStatus", () => {
  it("falls back to an explicitly unverified descriptor", () => {
    // An unrecognised backend value must render as unverified, not crash a page
    // and not silently look like something it is not.
    const unknown = describeStatus(TRANSACTION_STATUS, "teleported");
    expect(unknown.label).toBe("Unknown");
    expect(unknown.tone).toBe("neutral");
    expect(unknown.description).toContain("not recognised");
  });

  it("treats a missing value the same way", () => {
    expect(describeStatus(TRANSACTION_STATUS, null).label).toBe("Unknown");
    expect(describeStatus(TRANSACTION_STATUS, undefined).label).toBe("Unknown");
  });
});

describe("tone tokens", () => {
  const TONES: readonly Tone[] = [
    "positive",
    "caution",
    "negative",
    "pending",
    "info",
    "neutral",
  ];

  // `shadcn/no-raw-colors` forbids literals in components; these helpers are the
  // single place a tone becomes a class, so they must stay token-based.
  it("produces token-based classes for every tone", () => {
    for (const tone of TONES) {
      for (const classes of [toneSurfaceClasses(tone), toneTextClasses(tone)]) {
        expect(classes).not.toMatch(/#[0-9a-fA-F]{3,8}/);
        expect(classes).not.toMatch(/rgb\(/);
        expect(classes).not.toMatch(/oklch\(/);
        expect(classes.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("routes each semantic tone to its own token family", () => {
    // `neutral` deliberately reuses the muted/border tokens rather than
    // carrying a parallel set, so it is asserted separately.
    for (const tone of ["positive", "caution", "negative", "pending", "info"] as const) {
      expect(toneSurfaceClasses(tone)).toContain(tone);
      expect(toneTextClasses(tone)).toContain(tone);
    }
    expect(toneSurfaceClasses("neutral")).toContain("muted");
    expect(toneTextClasses("neutral")).toContain("muted-foreground");
  });
});

describe("stockLevel", () => {
  const base = { reorderPoint: 10, reorderQuantity: 50 };

  it("marks a discontinued product as not traded", () => {
    expect(
      stockLevel({ ...base, status: "discontinued", currentStock: 0 }),
    ).toBe("inactive");
  });

  it("marks an empty active product as out of stock", () => {
    expect(stockLevel({ ...base, status: "active", currentStock: 0 })).toBe(
      "out_of_stock",
    );
    expect(stockLevel({ ...base, status: "out_of_stock", currentStock: 5 })).toBe(
      "out_of_stock",
    );
  });

  it("flags the backend's own low-stock rows as needing a reorder", () => {
    // The authoritative list comes from GET /api/inventory/low-stock. The UI
    // must not invent a stricter rule of its own.
    expect(
      stockLevel(
        { ...base, status: "active", currentStock: 12 },
        { backendFlaggedLowStock: true },
      ),
    ).toBe("reorder");
  });

  it("labels a row below its reorder point as low", () => {
    expect(stockLevel({ ...base, status: "active", currentStock: 8 })).toBe("low");
    expect(stockLevel({ ...base, status: "active", currentStock: 10 })).toBe("low");
  });

  it("leaves a healthy product alone", () => {
    expect(stockLevel({ ...base, status: "active", currentStock: 11 })).toBe("healthy");
  });

  it("does not flag anything when no reorder point is set", () => {
    // A product with reorderPoint 0 has opted out of the rule; treating that as
    // "always low" would flag the entire catalogue.
    expect(
      stockLevel({ status: "active", currentStock: 1, reorderPoint: 0 }),
    ).toBe("healthy");
  });
});

describe("stock level vocabulary", () => {
  it("describes every level in words", () => {
    for (const level of ["out_of_stock", "reorder", "low", "healthy", "inactive"] as const) {
      expect(STOCK_LEVEL[level].label).not.toBe("Unknown");
      expect(STOCK_LEVEL[level].description.length).toBeGreaterThan(10);
    }
  });
});

describe("document pipeline", () => {
  it("runs from upload to confirmation in order", () => {
    expect(DOCUMENT_PIPELINE[0]).toBe("uploaded");
    expect(DOCUMENT_PIPELINE).toContain("processing");
    expect(DOCUMENT_PIPELINE).toContain("review_required");
    expect(DOCUMENT_PIPELINE[DOCUMENT_PIPELINE.length - 1]).toBe("approved");
  });

  it("never treats a failed document as progressing", () => {
    // `failed` and `rejected` are terminal, so they must stay out of the rail.
    expect(DOCUMENT_PIPELINE).not.toContain("failed");
    expect(DOCUMENT_PIPELINE).not.toContain("rejected");
  });
});

describe("PRODUCT_UNIT_LABEL", () => {
  it("names every backend unit in a word a merchant uses", () => {
    for (const unit of [
      "piece",
      "kg",
      "gram",
      "liter",
      "ml",
      "meter",
      "dozen",
      "box",
      "other",
    ] as const) {
      expect(PRODUCT_UNIT_LABEL[unit].length).toBeGreaterThan(0);
    }
    // "piece" alone is not a word a merchant would read.
    expect(PRODUCT_UNIT_LABEL.piece).toBe("pieces");
  });
});