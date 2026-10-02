// Merchant Brain: typed endpoint functions.
//
// One function per APPROVED backend route. Every path below is copied from an
// actual route file on the backend branch — none is speculative, and none is
// created here (AI_CONTEXT.md §10.1 forbids inventing endpoints to make a
// feature look complete).
//
// `businessId` is a parameter, never a client-supplied value: it comes from
// `GET /api/auth/session`, which is the only source of an id the caller is
// actually allowed to use.
//
// NOTE ON ABSENT CAPABILITIES. Several intelligence capabilities this UI
// presents — analytics roll-ups, profit leaks, cash-flow forecasts, the
// simulator, Business Brain answers, actions and notifications — have NO
// approved route yet. They are deliberately NOT stubbed here. `lib/api/pending.ts`
// names them so pages can explain the gap honestly instead of faking data.

import { z } from "zod";

import {
  apiFetch,
  listQuery,
  pageFrom,
  type Page,
} from "./client";
import {
  businessMembershipSchema,
  businessSchema,
  businessSummarySchema,
  customerBalanceSchema,
  customerSchema,
  documentSchema,
  documentStatusSchema,
  expenseSchema,
  inventoryValueSchema,
  pageMetaSchema,
  payableSchema,
  payableTotalsSchema,
  productSchema,
  receivableSchema,
  receivableTotalsSchema,
  sessionSchema,
  supplierPricingSchema,
  supplierSchema,
  transactionSchema,
  type WireBusiness,
  type WireBusinessSummary,
  type WireCustomer,
  type WireCustomerBalance,
  type WireDocument,
  type WireExpense,
  type WireInventoryValue,
  type WirePayable,
  type WirePayableTotals,
  type WireProduct,
  type WireReceivable,
  type WireReceivableTotals,
  type WireSession,
  type WireSupplier,
  type WireSupplierPricing,
  type WireTransaction,
} from "./contracts";

// ── Session & business ─────────────────────────────────────────────────────

/** `GET /api/auth/session` — 401 when there is no valid session. */
export function getSession(): Promise<WireSession> {
  return apiFetch("/api/auth/session", sessionSchema, {
    capability: "Signing in",
  }).then((result) => result.data);
}

/** `GET /api/businesses` — businesses the caller is an active member of. */
export async function listBusinesses(): Promise<readonly WireBusinessSummary[]> {
  const result = await apiFetch(
    "/api/businesses",
    z.array(businessSummarySchema),
    { capability: "Your businesses" },
  );
  return result.data;
}

/** `GET /api/businesses/{businessId}` */
export function getBusiness(businessId: string): Promise<WireBusiness> {
  return apiFetch(`/api/businesses/${encodeURIComponent(businessId)}`, businessSchema, {
    capability: "Your business profile",
  }).then((result) => result.data);
}

/** `GET /api/businesses/{businessId}/members` */
export async function listMembers(
  businessId: string,
): Promise<readonly z.infer<typeof businessMembershipSchema>[]> {
  const result = await apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/members`,
    z.array(businessMembershipSchema),
    { capability: "Your team" },
  );
  return result.data;
}

// ── Inventory ──────────────────────────────────────────────────────────────

export interface ProductFilters {
  readonly page?: number;
  readonly limit?: number;
  readonly status?: "active" | "discontinued" | "out_of_stock";
  readonly category?: string;
  readonly search?: string;
}

/** `GET /api/inventory/products` */
export async function listProducts(
  businessId: string,
  filters: ProductFilters = {},
): Promise<Page<WireProduct>> {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 25;
  const result = await apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/inventory/products`,
    z.array(productSchema),
    {
      query: listQuery({
        page,
        limit,
        filters: {
          status: filters.status,
          category: filters.category,
          search: filters.search,
        },
      }),
      capability: "Your products",
    },
  );
  return pageFrom(result.data, result.meta, page, limit);
}

/** `GET /api/inventory/products/{id}` */
export function getProduct(
  businessId: string,
  productId: string,
): Promise<WireProduct> {
  return apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/inventory/products/${encodeURIComponent(productId)}`,
    productSchema,
    { capability: "This product" },
  ).then((result) => result.data);
}

/**
 * `GET /api/inventory/low-stock`
 *
 * The authoritative "needs reorder" set. The backend applies its own Phase 1
 * `needsReorder` rule here; the UI never re-derives it.
 */
export async function listLowStockProducts(
  businessId: string,
): Promise<readonly WireProduct[]> {
  const result = await apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/inventory/low-stock`,
    z.array(productSchema),
    { capability: "Low-stock products" },
  );
  return result.data;
}

/** `GET /api/inventory/value` — deterministic valuation. */
export function getInventoryValue(businessId: string): Promise<WireInventoryValue> {
  return apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/inventory/value`,
    inventoryValueSchema,
    { capability: "Inventory value" },
  ).then((result) => result.data);
}

// ── Customers ──────────────────────────────────────────────────────────────

export interface CustomerFilters {
  readonly page?: number;
  readonly limit?: number;
  readonly status?: "active" | "inactive";
  readonly search?: string;
}

/** `GET /api/customers` */
export async function listCustomers(
  businessId: string,
  filters: CustomerFilters = {},
): Promise<Page<WireCustomer>> {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 25;
  const result = await apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/customers`,
    z.array(customerSchema),
    {
      query: listQuery({
        page,
        limit,
        filters: { status: filters.status, search: filters.search },
      }),
      capability: "Your customers",
    },
  );
  return pageFrom(result.data, result.meta, page, limit);
}

/** `GET /api/customers/{id}` */
export function getCustomer(
  businessId: string,
  customerId: string,
): Promise<WireCustomer> {
  return apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/customers/${encodeURIComponent(customerId)}`,
    customerSchema,
    { capability: "This customer" },
  ).then((result) => result.data);
}

/** `GET /api/customers/{id}/balance` */
export function getCustomerBalance(
  businessId: string,
  customerId: string,
): Promise<WireCustomerBalance> {
  return apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/customers/${encodeURIComponent(customerId)}/balance`,
    customerBalanceSchema,
    { capability: "This customer's balance" },
  ).then((result) => result.data);
}

export interface ReceivableFilters {
  readonly page?: number;
  readonly limit?: number;
  readonly customerId?: string;
  readonly status?: "pending" | "partial" | "paid" | "overdue" | "written_off";
}

/** `GET /api/customers/receivables` — money owed to the merchant. */
export async function listReceivables(
  businessId: string,
  filters: ReceivableFilters = {},
): Promise<Page<WireReceivable>> {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 25;
  const result = await apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/customers/receivables`,
    z.array(receivableSchema),
    {
      query: listQuery({
        page,
        limit,
        filters: { customerId: filters.customerId, status: filters.status },
      }),
      capability: "Money owed to you",
    },
  );
  return pageFrom(result.data, result.meta, page, limit);
}

/** `GET /api/customers/receivables/totals` */
export function getReceivableTotals(
  businessId: string,
): Promise<WireReceivableTotals> {
  return apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/customers/receivables/totals`,
    receivableTotalsSchema,
    { capability: "Money owed to you" },
  ).then((result) => result.data);
}

// ── Suppliers ──────────────────────────────────────────────────────────────

export interface SupplierFilters {
  readonly page?: number;
  readonly limit?: number;
  readonly status?: "active" | "inactive";
  readonly search?: string;
}

/** `GET /api/suppliers` */
export async function listSuppliers(
  businessId: string,
  filters: SupplierFilters = {},
): Promise<Page<WireSupplier>> {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 25;
  const result = await apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/suppliers`,
    z.array(supplierSchema),
    {
      query: listQuery({
        page,
        limit,
        filters: { status: filters.status, search: filters.search },
      }),
      capability: "Your suppliers",
    },
  );
  return pageFrom(result.data, result.meta, page, limit);
}

/** `GET /api/suppliers/{id}` */
export function getSupplier(
  businessId: string,
  supplierId: string,
): Promise<WireSupplier> {
  return apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/suppliers/${encodeURIComponent(supplierId)}`,
    supplierSchema,
    { capability: "This supplier" },
  ).then((result) => result.data);
}

/**
 * `GET /api/suppliers/{id}/pricing`
 *
 * Current supplier prices per product. A single price point is NOT a cost
 * increase — proving a change needs the historical series, which the backend
 * does not expose yet. The UI therefore shows current pricing and says so
 * rather than drawing a trend line it cannot support.
 */
export async function getSupplierPricing(
  businessId: string,
  supplierId: string,
): Promise<readonly WireSupplierPricing[]> {
  const result = await apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/suppliers/${encodeURIComponent(supplierId)}/pricing`,
    z.array(supplierPricingSchema),
    { capability: "Supplier pricing history" },
  );
  return result.data;
}

/** `GET /api/suppliers/payables` — money the merchant owes. */
export async function listPayables(
  businessId: string,
  filters: {
    readonly page?: number;
    readonly limit?: number;
    readonly supplierId?: string;
    readonly status?: "pending" | "partial" | "paid" | "overdue";
  } = {},
): Promise<Page<WirePayable>> {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 25;
  const result = await apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/suppliers/payables`,
    z.array(payableSchema),
    {
      query: listQuery({
        page,
        limit,
        filters: { supplierId: filters.supplierId, status: filters.status },
      }),
      capability: "Money you owe",
    },
  );
  return pageFrom(result.data, result.meta, page, limit);
}

/** `GET /api/suppliers/payables/totals` */
export function getPayableTotals(businessId: string): Promise<WirePayableTotals> {
  return apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/suppliers/payables/totals`,
    payableTotalsSchema,
    { capability: "Money you owe" },
  ).then((result) => result.data);
}

// ── Expenses ───────────────────────────────────────────────────────────────

/**
 * `GET /api/expenses/{id}`
 *
 * There is NO approved `GET /api/expenses` list route, so the Expenses screen
 * cannot show a ledger yet. It links to a single expense by id instead, and
 * says plainly why the ledger is missing.
 */
export function getExpense(
  businessId: string,
  expenseId: string,
): Promise<WireExpense> {
  return apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/expenses/${encodeURIComponent(expenseId)}`,
    expenseSchema,
    { capability: "This expense" },
  ).then((result) => result.data);
}

/** `POST /api/expenses/{id}/approve` — a real, server-authoritative write. */
export function approveExpense(
  businessId: string,
  expenseId: string,
  idempotencyKey?: string,
): Promise<WireExpense> {
  return apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/expenses/${encodeURIComponent(expenseId)}/approve`,
    expenseSchema,
    {
      method: "POST",
      idempotencyKey,
      capability: "Approving an expense",
    },
  ).then((result) => result.data);
}

// ── Documents (ingestion & review) ─────────────────────────────────────────

export interface DocumentFilters {
  readonly page?: number;
  readonly limit?: number;
  readonly status?: z.infer<typeof documentStatusSchema>;
  readonly sourceType?: string;
  readonly search?: string;
}

/** `GET /api/documents` — the ingestion pipeline, as the merchant sees it. */
export async function listDocuments(
  businessId: string,
  filters: DocumentFilters = {},
): Promise<Page<WireDocument>> {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 25;
  const result = await apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/documents`,
    z.array(documentSchema),
    {
      query: listQuery({
        page,
        limit,
        filters: {
          status: filters.status,
          sourceType: filters.sourceType,
          search: filters.search,
        },
      }),
      capability: "Your documents",
    },
  );
  return pageFrom(result.data, result.meta, page, limit);
}

/** `GET /api/documents/{id}` */
export function getDocument(
  businessId: string,
  documentId: string,
): Promise<WireDocument> {
  return apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/documents/${encodeURIComponent(documentId)}`,
    documentSchema,
    { capability: "This document" },
  ).then((result) => result.data);
}

/**
 * `POST /api/documents/{id}/approve`
 *
 * This is the merchant's human confirmation of extracted values. The response
 * is the server's authoritative state — the UI renders whatever comes back
 * and never assumes the transition succeeded.
 */
export function approveDocument(
  businessId: string,
  documentId: string,
): Promise<WireDocument> {
  return apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/documents/${encodeURIComponent(documentId)}/approve`,
    documentSchema,
    {
      method: "POST",
      idempotencyKey: `approve-document:${documentId}`,
      capability: "Confirming a document",
    },
  ).then((result) => result.data);
}

/** `POST /api/documents/{id}/reject` — requires a reason. */
export function rejectDocument(
  businessId: string,
  documentId: string,
  reason: string,
): Promise<WireDocument> {
  return apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/documents/${encodeURIComponent(documentId)}/reject`,
    documentSchema,
    {
      method: "POST",
      body: { reason },
      idempotencyKey: `reject-document:${documentId}`,
      capability: "Rejecting a document",
    },
  ).then((result) => result.data);
}

/** `PATCH /api/documents/{id}/status` */
export function updateDocumentStatus(
  businessId: string,
  documentId: string,
  status: z.infer<typeof documentStatusSchema>,
  reason?: string,
): Promise<WireDocument> {
  return apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/documents/${encodeURIComponent(documentId)}/status`,
    documentSchema,
    {
      method: "PATCH",
      body: reason === undefined ? { status } : { status, reason },
      idempotencyKey: `document-status:${documentId}:${status}`,
      capability: "Updating a document",
    },
  ).then((result) => result.data);
}

// ── Transactions ───────────────────────────────────────────────────────────

/**
 * `GET /api/transactions/{id}`
 *
 * There is NO approved `GET /api/transactions` list route and no approved
 * analytics roll-up route, so the Sales screen cannot show a revenue series
 * yet. This exists so a transaction reached from another screen (a receipt, a
 * duplicate check) can still be opened by id.
 */
export function getTransaction(
  businessId: string,
  transactionId: string,
): Promise<WireTransaction> {
  return apiFetch(
    `/api/businesses/${encodeURIComponent(businessId)}/transactions/${encodeURIComponent(transactionId)}`,
    transactionSchema,
    { capability: "This transaction" },
  ).then((result) => result.data);
}

/** `GET /api/transactions/{id}` guard used to confirm a decode before render. */
export const pageMeta = pageMetaSchema;