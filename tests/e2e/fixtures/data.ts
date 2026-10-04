// Merchant Brain: synthetic records for E2E tests.
//
// PRODUCTION IMPACT: none. This file is imported only by
// `tests/e2e/fixtures/*`. There is no demo mode, no fixture fallback and no
// mock branch anywhere in `app/`, `components/` or `lib/`.
//
// Every value is synthetic and uses the reserved `11111111-…` UUID shape so it
// can never collide with a real identifier. Shapes match `lib/api/contracts.ts`.

export const SCENARIO_COOKIE = "mb_e2e_scenario";

export type Scenario =
  /** Everything present and normal. */
  | "default"
  /** Some endpoints fail, to exercise partial and error states. */
  | "partial"
  /** Every collection is empty, to exercise empty states. */
  | "empty"
  /** The session endpoint answers 401. */
  | "unauthenticated"
  /** Every endpoint answers 500. */
  | "error"
  /** The network is unreachable. */
  | "offline";

export const SCENARIO_IDS: Readonly<Record<Scenario, string>> = {
  default: "11111111-1111-4111-8111-111111111111",
  partial: "11111111-1111-4111-8111-111111111112",
  empty: "11111111-1111-4111-8111-111111111113",
  unauthenticated: "11111111-1111-4111-8111-111111111114",
  error: "11111111-1111-4111-8111-111111111115",
  offline: "11111111-1111-4111-8111-111111111116",
};

export const BUSINESS_ID = SCENARIO_IDS.default;

const ISO = "2026-03-15T04:00:00.000Z";

export const rupee = (amount: number) => ({ amount, currency: "INR" as const });

export const businessSummary = {
  id: BUSINESS_ID,
  name: "Sharma General Store",
  type: "retail",
  status: "active",
};

export const businesses = [
  businessSummary,
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Sharma Wholesale",
    type: "wholesale",
    status: "active",
  },
];

export const business = {
  id: BUSINESS_ID,
  name: "Sharma General Store",
  type: "retail",
  status: "active",
  profile: {
    displayName: "Sharma General Store",
    industry: "Grocery retail",
    address: "12 Market Road, Pune",
    phone: "+91 98765 43210",
    email: "hello@sharmastore.example",
    gstin: "27ABCDE1234F1Z5",
  },
  settings: {
    currency: "INR",
    fiscalYearStart: 4,
    timezone: "Asia/Kolkata",
    lowStockThreshold: 5,
    overdueThresholdDays: 30,
  },
  createdAt: ISO,
  updatedAt: ISO,
};

export const members = [
  {
    businessId: BUSINESS_ID,
    userId: "22222222-2222-4222-8222-222222222222",
    role: "owner",
    joinedAt: ISO,
    status: "active",
  },
];

export const products = [
  {
    id: "44444444-4444-4444-8444-444444444441",
    businessId: BUSINESS_ID,
    name: "Basmati Rice 5kg",
    sku: "RICE-5KG",
    category: "Grocery",
    unit: "kg",
    costPrice: rupee(420_00),
    sellingPrice: rupee(560_00),
    currentStock: 8,
    reorderPoint: 10,
    reorderQuantity: 50,
    status: "active",
    supplierId: "66666666-6666-4666-8666-666666666661",
    createdAt: ISO,
    updatedAt: ISO,
  },
  {
    id: "44444444-4444-4444-8444-444444444442",
    businessId: BUSINESS_ID,
    name: "Sunflower Oil 1L",
    sku: "OIL-1L",
    category: "Grocery",
    unit: "liter",
    costPrice: rupee(138_00),
    sellingPrice: rupee(155_00),
    currentStock: 64,
    reorderPoint: 12,
    reorderQuantity: 24,
    status: "active",
    createdAt: ISO,
    updatedAt: ISO,
  },
  {
    id: "44444444-4444-4444-8444-444444444443",
    businessId: BUSINESS_ID,
    name: "Whole Wheat Atta 10kg",
    sku: "ATTA-10KG",
    category: "Grocery",
    unit: "kg",
    costPrice: rupee(310_00),
    sellingPrice: rupee(365_00),
    currentStock: 0,
    reorderPoint: 8,
    reorderQuantity: 40,
    status: "out_of_stock",
    createdAt: ISO,
    updatedAt: ISO,
  },
] as const;

export const lowStockProducts = [products[0]];

export const inventoryValue = { totalValue: 482_40_000, productCount: 3 };

export const receivableTotals = { total: 184_00_000, overdue: 62_40_000 };

export const payableTotals = { total: 71_20_000, overdue: 12_00_000 };

export const customers = [
  {
    id: "55555555-5555-4555-8555-555555555551",
    businessId: BUSINESS_ID,
    name: "ABC Traders",
    phone: "+91 90000 11111",
    email: "purchase@abctraders.example",
    status: "active",
    totalPurchases: rupee(840_00_000),
    outstandingBalance: rupee(184_00_000),
    lastTransactionDate: ISO,
    createdAt: ISO,
    updatedAt: ISO,
  },
  {
    id: "55555555-5555-4555-8555-555555555552",
    businessId: BUSINESS_ID,
    name: "Gokul Provision Store",
    phone: "+91 90000 22222",
    status: "active",
    totalPurchases: rupee(215_00_000),
    outstandingBalance: rupee(0),
    lastTransactionDate: "2026-02-28T04:00:00.000Z",
    createdAt: ISO,
    updatedAt: ISO,
  },
] as const;

export const receivables = [
  {
    id: "77777777-7777-4777-8777-777777777771",
    businessId: BUSINESS_ID,
    customerId: customers[0].id,
    transactionId: "88888888-8888-4888-8888-888888888881",
    amount: rupee(184_00_000),
    dueDate: "2026-02-25T04:00:00.000Z",
    status: "overdue",
    paidAmount: rupee(0),
  },
  {
    id: "77777777-7777-4777-8777-777777777772",
    businessId: BUSINESS_ID,
    customerId: customers[1].id,
    transactionId: "88888888-8888-4888-8888-888888888882",
    amount: rupee(46_00_000),
    dueDate: "2026-04-05T04:00:00.000Z",
    status: "pending",
    paidAmount: rupee(0),
  },
] as const;

export const suppliers = [
  {
    id: "66666666-6666-4666-8666-666666666661",
    businessId: BUSINESS_ID,
    name: "Punjab Rice Traders",
    contactName: "Harpreet Singh",
    phone: "+91 90000 33333",
    status: "active",
    totalPurchases: rupee(324_00_000),
    outstandingPayable: rupee(71_20_000),
    lastTransactionDate: "2026-03-10T04:00:00.000Z",
    createdAt: ISO,
    updatedAt: ISO,
  },
] as const;

export const payables = [
  {
    id: "99999999-9999-4999-8999-999999999991",
    businessId: BUSINESS_ID,
    supplierId: suppliers[0].id,
    transactionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    amount: rupee(71_20_000),
    dueDate: "2026-03-01T04:00:00.000Z",
    status: "overdue",
    paidAmount: rupee(0),
  },
] as const;

export const supplierPricing = [
  {
    supplierId: suppliers[0].id,
    productId: products[0].id,
    unitPrice: rupee(472_00),
    minOrderQuantity: 25,
    lastUpdated: ISO,
  },
] as const;

export const documents = [
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    businessId: BUSINESS_ID,
    sourceType: "invoice",
    fileName: "invoice-2026-03-14.pdf",
    mimeType: "application/pdf",
    fileSize: 245_760,
    storagePath: "sharma/2026/03/invoice-2026-03-14.pdf",
    status: "review_required",
    metadata: { originalName: "invoice-2026-03-14.pdf", pageCount: 2 },
    uploadedAt: "2026-03-14T09:12:00.000Z",
    uploadedBy: "22222222-2222-4222-8222-222222222222",
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
    businessId: BUSINESS_ID,
    sourceType: "receipt",
    fileName: "upi-receipt-2026-03-13.png",
    mimeType: "image/png",
    fileSize: 84_231,
    storagePath: "sharma/2026/03/receipt.png",
    status: "processing",
    metadata: { originalName: "upi-receipt-2026-03-13.png" },
    uploadedAt: "2026-03-13T18:40:00.000Z",
    uploadedBy: "22222222-2222-4222-8222-222222222222",
  },
] as const;

export const pulseBenchmark = {
  period: { year: 2026, quarter: 2 },
  nationalMetrics: {
    transactionCount: 38664285691,
    transactionAmount: 45496453556876.69,
    registeredUsers: 711653262,
  },
  comparisons: {
    quarterOverQuarter: { current: 38664285691, previous: 36251699085, change: 2412586606, changePct: 6.66 },
    yearOverYear: { current: 38664285691, previous: 30000000000, change: 8664285691, changePct: 28.88 },
  },
  nationalTrend: [
    { year: 2026, quarter: 1, transactionCount: 36251699085 },
    { year: 2026, quarter: 2, transactionCount: 38664285691 },
  ],
  userGrowth: [
    { year: 2026, quarter: 2, registered: 711653262 },
  ],
  categoryBreakdown: [
    { category: "retail", transactionCount: 24691181013, sharePct: 63.86 },
    { category: "p2p", transactionCount: 11889781621, sharePct: 30.75 },
    { category: "utility", transactionCount: 2083323057, sharePct: 5.39 },
  ],
  topStates: [
    { name: "maharashtra", parent: null, rank: 1, count: 5064451991, amount: 5465176553156.58 },
    { name: "karnataka", parent: null, rank: 2, count: 4491711923, amount: 5292341222754.30 },
  ],
};