// Merchant Brain: wire types for the approved backend contracts.
//
// These are the shapes `app/api/**` on the backend actually returns. They are
// derived from the module domain types in `modules/*/domain/types.ts` and the
// response envelope in `lib/http/handler.ts` — NOT invented here.
//
// Three deliberate differences from the domain types, all of them transport
// concerns:
//
//   1. Dates arrive as ISO strings. `JSON.stringify(new Date())` produces a
//      string; pretending otherwise is how hydration bugs start.
//   2. Branded IDs (`BusinessId`, `ProductId`, …) are plain strings on the
//      wire. Branding is re-applied at the boundary, never trusted from JSON.
//   3. Money is `{ amount: number; currency: string }` with integer minor
//      units, exactly as `lib/types.ts` defines it.

import { z } from "zod";

// ── Primitives ─────────────────────────────────────────────────────────────

export const currencyCodeSchema = z.enum(["INR", "USD", "EUR", "GBP"]);

/** Integer minor units. A float here would be a backend bug, not a rounding choice. */
export const moneySchema = z.object({
  amount: z.number().int(),
  currency: currencyCodeSchema,
});

export type WireMoney = z.infer<typeof moneySchema>;

/** An ISO-8601 instant. Parsed to `Date` by the decoder, never assumed. */
const isoDateSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Expected an ISO-8601 instant");

// ── Business ───────────────────────────────────────────────────────────────

export const businessTypeSchema = z.enum([
  "retail",
  "wholesale",
  "manufacturing",
  "services",
  "food_beverage",
  "other",
]);

export const businessStatusSchema = z.enum(["active", "suspended", "closed"]);

export const businessSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: businessTypeSchema,
  status: businessStatusSchema,
  profile: z.object({
    displayName: z.string(),
    industry: z.string().optional(),
    address: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    gstin: z.string().optional(),
    pan: z.string().optional(),
  }),
  settings: z.object({
    currency: currencyCodeSchema,
    fiscalYearStart: z.number().int(),
    timezone: z.string(),
    lowStockThreshold: z.number().int(),
    overdueThresholdDays: z.number().int(),
  }),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type WireBusiness = z.infer<typeof businessSchema>;

/** `GET /api/businesses` — the switcher list, deliberately minimal. */
export const businessSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: businessTypeSchema,
  status: businessStatusSchema,
});

export type WireBusinessSummary = z.infer<typeof businessSummarySchema>;

export const userRoleSchema = z.enum([
  "owner",
  "admin",
  "manager",
  "accountant",
  "staff",
]);

export const businessMembershipSchema = z.object({
  businessId: z.string(),
  userId: z.string(),
  role: userRoleSchema,
  joinedAt: isoDateSchema,
  status: z.enum(["active", "invited", "removed"]),
});

/** `GET /api/auth/session` — the ONLY source of a valid `businessId`. */
export const sessionSchema = z.object({
  userId: z.string(),
  email: z.string(),
  businessIds: z.array(z.string()),
});

export type WireSession = z.infer<typeof sessionSchema>;

// ── Inventory ──────────────────────────────────────────────────────────────

export const productUnitSchema = z.enum([
  "piece",
  "kg",
  "gram",
  "liter",
  "ml",
  "meter",
  "dozen",
  "box",
  "other",
]);

export const productStatusSchema = z.enum(["active", "discontinued", "out_of_stock"]);

export const productSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  name: z.string(),
  sku: z.string().optional(),
  category: z.string().optional(),
  unit: productUnitSchema,
  costPrice: moneySchema,
  sellingPrice: moneySchema,
  currentStock: z.number(),
  reorderPoint: z.number(),
  reorderQuantity: z.number(),
  status: productStatusSchema,
  supplierId: z.string().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type WireProduct = z.infer<typeof productSchema>;

/** `GET /api/inventory/value` — deterministic valuation from domain rules. */
export const inventoryValueSchema = z.object({
  totalValue: z.number(),
  productCount: z.number(),
});

export type WireInventoryValue = z.infer<typeof inventoryValueSchema>;

// ── Customers ──────────────────────────────────────────────────────────────

export const customerStatusSchema = z.enum(["active", "inactive"]);

export const customerSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  name: z.string(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  gstin: z.string().optional(),
  status: customerStatusSchema,
  totalPurchases: moneySchema,
  outstandingBalance: moneySchema,
  lastTransactionDate: isoDateSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type WireCustomer = z.infer<typeof customerSchema>;

export const receivableStatusSchema = z.enum([
  "pending",
  "partial",
  "paid",
  "overdue",
  "written_off",
]);

export const receivableSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  customerId: z.string(),
  transactionId: z.string(),
  amount: moneySchema,
  dueDate: isoDateSchema,
  status: receivableStatusSchema,
  paidAmount: moneySchema,
  paidDate: isoDateSchema.optional(),
});

export type WireReceivable = z.infer<typeof receivableSchema>;

/** `GET /api/customers/{id}/balance` */
export const customerBalanceSchema = z.object({
  outstanding: z.number(),
  overdue: z.number(),
});

export type WireCustomerBalance = z.infer<typeof customerBalanceSchema>;

/** `GET /api/customers/receivables/totals` */
export const receivableTotalsSchema = z.object({
  total: z.number(),
  overdue: z.number(),
});

export type WireReceivableTotals = z.infer<typeof receivableTotalsSchema>;

// ── Suppliers ──────────────────────────────────────────────────────────────

export const supplierStatusSchema = z.enum(["active", "inactive"]);

export const supplierSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  name: z.string(),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  gstin: z.string().optional(),
  status: supplierStatusSchema,
  totalPurchases: moneySchema,
  outstandingPayable: moneySchema,
  lastTransactionDate: isoDateSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type WireSupplier = z.infer<typeof supplierSchema>;

export const payableStatusSchema = z.enum(["pending", "partial", "paid", "overdue"]);

export const payableSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  supplierId: z.string(),
  transactionId: z.string(),
  amount: moneySchema,
  dueDate: isoDateSchema,
  status: payableStatusSchema,
  paidAmount: moneySchema,
  paidDate: isoDateSchema.optional(),
});

export type WirePayable = z.infer<typeof payableSchema>;

/** `GET /api/suppliers/payables/totals` */
export const payableTotalsSchema = z.object({
  total: z.number(),
  overdue: z.number(),
});

export type WirePayableTotals = z.infer<typeof payableTotalsSchema>;

export const supplierPricingSchema = z.object({
  supplierId: z.string(),
  productId: z.string(),
  unitPrice: moneySchema,
  minOrderQuantity: z.number().optional(),
  lastUpdated: isoDateSchema,
});

export type WireSupplierPricing = z.infer<typeof supplierPricingSchema>;

// ── Expenses ───────────────────────────────────────────────────────────────

export const expenseCategorySchema = z.enum([
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
]);

export const expenseStatusSchema = z.enum(["pending", "approved", "rejected", "paid"]);

export const expenseSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  category: expenseCategorySchema,
  amount: moneySchema,
  description: z.string(),
  vendor: z.string().optional(),
  reference: z.string().optional(),
  status: expenseStatusSchema,
  expenseDate: isoDateSchema,
  isRecurring: z.boolean(),
  recurringConfig: z
    .object({
      frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]),
      nextDueDate: isoDateSchema,
      endDate: isoDateSchema.optional(),
    })
    .optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  createdBy: z.string(),
});

export type WireExpense = z.infer<typeof expenseSchema>;

// ── Transactions ───────────────────────────────────────────────────────────

export const transactionTypeSchema = z.enum(["sale", "purchase", "payment", "refund"]);

export const transactionStatusSchema = z.enum([
  "draft",
  "confirmed",
  "completed",
  "voided",
]);

export const paymentMethodSchema = z.enum([
  "cash",
  "upi",
  "card",
  "bank_transfer",
  "credit",
  "other",
]);

export const transactionItemSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  quantity: z.number(),
  unitPrice: moneySchema,
  discount: moneySchema,
  tax: moneySchema,
  total: moneySchema,
});

export const transactionSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  type: transactionTypeSchema,
  status: transactionStatusSchema,
  counterpartyType: z.enum(["customer", "supplier"]),
  counterpartyId: z.string(),
  items: z.array(transactionItemSchema),
  subtotal: moneySchema,
  discount: moneySchema,
  tax: moneySchema,
  total: moneySchema,
  paymentMethod: paymentMethodSchema.optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
  transactionDate: isoDateSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  createdBy: z.string(),
});

export type WireTransaction = z.infer<typeof transactionSchema>;

// ── Documents ──────────────────────────────────────────────────────────────

export const documentSourceTypeSchema = z.enum([
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
]);

export const documentStatusSchema = z.enum([
  "uploaded",
  "validating",
  "queued",
  "processing",
  "extracted",
  "review_required",
  "approved",
  "rejected",
  "failed",
]);

export const documentSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  sourceType: documentSourceTypeSchema,
  fileName: z.string(),
  mimeType: z.string(),
  // Bounded to match `createDocumentSchema` on the backend (integer, positive,
  // at most 50MB). Decoding a negative or absurd size would render a file size
  // the backend could never have stored.
  fileSize: z.number().int().nonnegative().max(50 * 1024 * 1024),
  storagePath: z.string(),
  status: documentStatusSchema,
  metadata: z.object({
    originalName: z.string(),
    contentHash: z.string().optional(),
    pageCount: z.number().optional(),
    language: z.string().optional(),
    extractionId: z.string().optional(),
    ragIndexingStatus: z.enum(['pending','indexed','insufficient_evidence','failed']).optional(),
    ragChunkCount: z.number().int().nonnegative().optional(),
    ragIndexingError: z.string().optional(),
    rejectionReason: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
  uploadedAt: isoDateSchema,
  processedAt: isoDateSchema.optional(),
  uploadedBy: z.string(),
});

export type WireDocument = z.infer<typeof documentSchema>;

// ── Pagination ─────────────────────────────────────────────────────────────

/**
 * `meta` returned alongside every list endpoint. Verified against
 * `lib/http/handler.ts`, which passes `meta` straight through.
 */
export const pageMetaSchema = z.object({
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  hasMore: z.boolean(),
});

export type PageMeta = z.infer<typeof pageMetaSchema>;
// ── Inventory Movement ─────────────────────────────────────────────────────

export const inventoryMovementSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  productId: z.string(),
  type: z.enum(["received", "sold", "adjusted", "returned"]),
  quantity: z.number().int(),
  reference: z.string().optional(),
  referenceType: z.string().optional(),
  referenceId: z.string().optional(),
  createdAt: isoDateSchema,
});

export type WireInventoryMovement = z.infer<typeof inventoryMovementSchema>;

// ── Intelligence Schemas ───────────────────────────────────────────────────

export const analyticsSnapshotSchema = z.object({
  businessId: z.string(),
  period: z.object({
    from: isoDateSchema,
    to: isoDateSchema,
  }),
  currency: z.string(),
  revenueMinor: z.number().int(),
  grossProfitMinor: z.number().int(),
  operatingExpensesMinor: z.number().int(),
  netProfitMinor: z.number().int(),
  grossMarginBasisPoints: z.number().int(),
  netMarginBasisPoints: z.number().int(),
  quality: z.enum(["complete", "partial", "insufficient_data"]),
});

export type WireAnalyticsSnapshot = z.infer<typeof analyticsSnapshotSchema>;

export const cashFlowForecastSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  startingCash: z.object({ amount: z.number(), currency: z.string() }),
  endingCash: z.object({ amount: z.number(), currency: z.string() }),
  risks: z.array(z.any()),
  calculatedAt: isoDateSchema,
});

export type WireCashFlowForecast = z.infer<typeof cashFlowForecastSchema>;

export const actionWireSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  type: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  source: z.string(),
  result: z.object({
    success: z.boolean(),
    output: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
    executorId: z.string().optional(),
  }).passthrough().optional(),
});

export type WireAction = z.infer<typeof actionWireSchema>;

export const aiChatResponseSchema = z.object({
  message: z.string(),
  toolsUsed: z.array(z.any()),
  evidence: z.array(z.any()),
  confidence: z.enum(["high", "medium", "low"]),
  metadata: z.object({
    totalLatencyMs: z.number(),
    modelUsed: z.string(),
    tokensUsed: z.number(),
    ragContextUsed: z.boolean(),
    sessionId: z.string().optional(),
    degradedReason: z.string().optional(),
  }),
});

export type WireAiChatResponse = z.infer<typeof aiChatResponseSchema>;

// ── Profit Leak Schemas ───────────────────────────────────────────────────

export const profitLeakWireSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  category: z.string(),
  severity: z.enum(["critical", "high", "medium", "low"]),
  title: z.string(),
  description: z.string(),
  impact: moneySchema,
  impactPeriod: z.string(),
  evidence: z.array(
    z.object({
      type: z.string(),
      resourceId: z.string(),
      description: z.string(),
      value: z.number().optional(),
    }),
  ),
  status: z.enum(["active", "acknowledged", "resolved", "dismissed"]),
  detectedAt: isoDateSchema,
  resolvedAt: isoDateSchema.optional(),
  currency: z.string(),
  calculation: z.any().optional(),
  suggestedInvestigation: z.string().optional(),
  relatedRecordIds: z.array(z.string()).optional(),
});

export type WireProfitLeak = z.infer<typeof profitLeakWireSchema>;

// ── Simulator Schemas ─────────────────────────────────────────────────────

export const scenarioWireSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  status: z.enum(["draft", "calculated", "expired"]),
  period: z.object({
    from: isoDateSchema,
    to: isoDateSchema,
  }),
  parameters: z.array(
    z.object({
      type: z.string(),
      targetId: z.string().optional(),
      targetName: z.string().optional(),
      currentValue: z.number(),
      newValue: z.number(),
      unit: z.enum(["amount", "percentage", "quantity", "days"]),
    }),
  ),
  baseline: z.object({
    revenue: z.number(),
    cogs: z.number(),
    grossProfit: z.number(),
    grossMarginBps: z.number(),
    operatingExpenses: z.number(),
    netProfit: z.number(),
    netMarginBps: z.number(),
    grossRevenue: z.number(),
    discounts: z.number(),
    quantitySold: z.number(),
    saleCount: z.number(),
  }),
  projected: z.object({
    revenue: z.number(),
    cogs: z.number(),
    grossProfit: z.number(),
    grossMarginBps: z.number(),
    operatingExpenses: z.number(),
    netProfit: z.number(),
    netMarginBps: z.number(),
    grossRevenue: z.number(),
    discounts: z.number(),
    quantitySold: z.number(),
    saleCount: z.number(),
  }),
  comparison: z.object({
    revenueDelta: z.number(),
    grossProfitDelta: z.number(),
    profitDelta: z.number(),
    marginDeltaBps: z.number(),
    adverse: z.boolean(),
    direction: z.enum(["increase", "decrease", "no_change", "unavailable"]),
    summary: z.string(),
  }),
  assumptions: z.array(
    z.object({
      id: z.string(),
      statement: z.string(),
      limitation: z.string(),
      material: z.boolean(),
    }),
  ),
  rejections: z.array(z.any()).optional(),
  currency: z.string(),
  calculatedAt: isoDateSchema,
});

export type WireScenario = z.infer<typeof scenarioWireSchema>;

// ── Notifications Schemas ─────────────────────────────────────────────────

export const notificationWireSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  userId: z.string(),
  type: z.string(),
  title: z.string(),
  message: z.string(),
  severity: z.enum(["critical", "warning", "info", "success"]),
  status: z.enum(["unread", "read", "dismissed"]),
  actionUrl: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: isoDateSchema,
  readAt: isoDateSchema.optional(),
});

export type WireNotification = z.infer<typeof notificationWireSchema>;

// ── PhonePe Pulse Market Benchmarks ───────────────────────────────────────

export const pulsePeriodSchema = z.object({
  year: z.number().int(),
  quarter: z.number().int(),
});

export const comparisonSchema = z.object({
  current: z.number(),
  previous: z.number(),
  change: z.number(),
  changePct: z.number().nullable(),
});

export const trendPointSchema = z.object({
  year: z.number().int(),
  quarter: z.number().int(),
  transactionCount: z.number(),
});

export const growthPointSchema = z.object({
  year: z.number().int(),
  quarter: z.number().int(),
  registered: z.number(),
});

export const geoMetricSchema = z.object({
  name: z.string(),
  parent: z.string().nullable(),
  rank: z.number().nullable(),
  count: z.number(),
  amount: z.number().nullable(),
});

export const categoryBreakdownSchema = z.object({
  category: z.string(),
  transactionCount: z.number(),
  sharePct: z.number(),
});

export const pulseBenchmarkSchema = z.object({
  period: pulsePeriodSchema,
  nationalMetrics: z.object({
    transactionCount: z.number(),
    transactionAmount: z.number().nullable(),
    registeredUsers: z.number().nullable(),
  }),
  comparisons: z.object({
    quarterOverQuarter: comparisonSchema.nullable(),
    yearOverYear: comparisonSchema.nullable(),
  }),
  nationalTrend: z.array(trendPointSchema),
  userGrowth: z.array(growthPointSchema),
  categoryBreakdown: z.array(categoryBreakdownSchema),
  topStates: z.array(geoMetricSchema),
});

export type WirePulseBenchmark = z.infer<typeof pulseBenchmarkSchema>;
