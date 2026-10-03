// Merchant Brain: status vocabulary.
//
// One place decides what a status is CALLED and what it MEANS. Colours come
// from the token scale, but a status is always rendered with its label and an
// accessible description — colour is the third signal, never the only one
// (DESIGN_SYSTEM.md "Status meanings must remain stable ... and must not rely
// on colour alone").
//
// Every union here is copied from the backend domain types. Adding a status
// means adding it here too; `tests/frontend/status.test.ts` fails if a backend
// status has no merchant-facing label.

/** Semantic tone. Maps to the `--*-subtle` / `--*-foreground` token pairs. */
export type Tone = "positive" | "caution" | "negative" | "pending" | "info" | "neutral";

export interface StatusDescriptor {
  /** Merchant-facing label. Always rendered. */
  readonly label: string;
  /** What the status actually means, in plain language. */
  readonly description: string;
  readonly tone: Tone;
}

/** Classes for a tinted status surface. Tokens only — no raw colours. */
export function toneSurfaceClasses(tone: Tone): string {
  switch (tone) {
    case "positive":
      return "bg-positive-subtle text-positive-foreground border-positive-border";
    case "caution":
      return "bg-caution-subtle text-caution-foreground border-caution-border";
    case "negative":
      return "bg-negative-subtle text-negative-foreground border-negative-border";
    case "pending":
      return "bg-pending-subtle text-pending-foreground border-pending-border";
    case "info":
      return "bg-info-subtle text-info-foreground border-info-border";
    case "neutral":
      return "bg-muted text-muted-foreground border-border";
  }
}

/** Classes for status text and icons on an ordinary card surface. */
export function toneTextClasses(tone: Tone): string {
  switch (tone) {
    case "positive":
      return "text-positive-foreground";
    case "caution":
      return "text-caution-foreground";
    case "negative":
      return "text-negative-foreground";
    case "pending":
      return "text-pending-foreground";
    case "info":
      return "text-info-foreground";
    case "neutral":
      return "text-muted-foreground";
  }
}

const NEUTRAL: StatusDescriptor = {
  label: "Unknown",
  description: "This status is not recognised. Treat the record as unverified.",
  tone: "neutral",
};

function table(
  entries: Readonly<Record<string, StatusDescriptor>>,
): Readonly<Record<string, StatusDescriptor>> {
  return entries;
}

export type TransactionStatus =
  | "draft"
  | "confirmed"
  | "completed"
  | "voided";

export type TransactionType = "sale" | "purchase" | "payment" | "refund";

export type PaymentMethod =
  | "cash"
  | "upi"
  | "card"
  | "bank_transfer"
  | "credit"
  | "other";

export type ExpenseStatus = "pending" | "approved" | "rejected" | "paid";

export type ExpenseCategory =
  | "rent"
  | "utilities"
  | "salaries"
  | "supplies"
  | "marketing"
  | "transportation"
  | "insurance"
  | "maintenance"
  | "taxes"
  | "fees"
  | "other";

export type ProductStatus = "active" | "discontinued" | "out_of_stock";

export type ProductUnit =
  | "piece"
  | "kg"
  | "gram"
  | "liter"
  | "ml"
  | "meter"
  | "dozen"
  | "box"
  | "other";

export type MovementType =
  | "purchase"
  | "sale"
  | "return"
  | "adjustment"
  | "damage"
  | "transfer";

export type ReceivableStatus =
  | "pending"
  | "partial"
  | "paid"
  | "overdue"
  | "written_off";

export type PayableStatus = "pending" | "partial" | "paid" | "overdue";

export type PartnerStatus = "active" | "inactive";

export type DocumentStatus =
  | "uploaded"
  | "validating"
  | "queued"
  | "processing"
  | "extracted"
  | "review_required"
  | "approved"
  | "rejected"
  | "failed";

export type DocumentSourceType =
  | "invoice"
  | "receipt"
  | "upi_screenshot"
  | "pdf"
  | "audio"
  | "csv"
  | "excel"
  | "whatsapp_export"
  | "text"
  | "image"
  | "other";

export type BusinessStatus = "active" | "suspended" | "closed";

export type UserRole = "owner" | "admin" | "manager" | "accountant" | "staff";

export const TRANSACTION_STATUS: Readonly<Record<TransactionStatus, StatusDescriptor>> =
  table({
    draft: {
      label: "Draft",
      description: "Recorded but not yet finalised. It does not affect your books.",
      tone: "neutral",
    },
    confirmed: {
      label: "Confirmed",
      description: "Agreed with the other party and counted in your records.",
      tone: "info",
    },
    completed: {
      label: "Completed",
      description: "Finished and settled.",
      tone: "positive",
    },
    voided: {
      label: "Voided",
      description: "Cancelled. Kept for your records but excluded from totals.",
      tone: "negative",
    },
  });

export const TRANSACTION_TYPE: Readonly<Record<TransactionType, StatusDescriptor>> =
  table({
    sale: { label: "Sale", description: "Money coming in from a customer.", tone: "positive" },
    purchase: { label: "Purchase", description: "Money going out to a supplier.", tone: "caution" },
    payment: { label: "Payment received", description: "A payment against money you were owed.", tone: "info" },
    refund: { label: "Refund", description: "Money returned to a customer.", tone: "negative" },
  });

export const PAYMENT_METHOD: Readonly<Record<PaymentMethod, StatusDescriptor>> = table({
  cash: { label: "Cash", description: "Paid in cash.", tone: "neutral" },
  upi: { label: "UPI", description: "Paid by UPI.", tone: "neutral" },
  card: { label: "Card", description: "Paid by card.", tone: "neutral" },
  bank_transfer: { label: "Bank transfer", description: "Paid by bank transfer.", tone: "neutral" },
  credit: { label: "On credit", description: "Not paid yet. This becomes money you are owed.", tone: "caution" },
  other: { label: "Other", description: "Another payment method.", tone: "neutral" },
});

export const EXPENSE_STATUS: Readonly<Record<ExpenseStatus, StatusDescriptor>> = table({
  pending: { label: "Needs review", description: "Waiting for you to check and approve it.", tone: "pending" },
  approved: { label: "Approved", description: "Checked and accepted as a real cost.", tone: "positive" },
  rejected: { label: "Rejected", description: "Not accepted as a cost. Excluded from totals.", tone: "negative" },
  paid: { label: "Paid", description: "Already paid out.", tone: "positive" },
});

export const EXPENSE_CATEGORY: Readonly<Record<ExpenseCategory, StatusDescriptor>> =
  table({
    rent: { label: "Rent", description: "Cost of the place you trade from.", tone: "neutral" },
    utilities: { label: "Utilities", description: "Electricity, water, gas and internet.", tone: "neutral" },
    salaries: { label: "Salaries", description: "Pay for staff.", tone: "neutral" },
    supplies: { label: "Supplies", description: "Materials and consumables for trading.", tone: "neutral" },
    marketing: { label: "Marketing", description: "Advertising and promotion.", tone: "neutral" },
    transportation: { label: "Transport", description: "Delivery, freight and travel.", tone: "neutral" },
    insurance: { label: "Insurance", description: "Cover you buy against risk.", tone: "neutral" },
    maintenance: { label: "Maintenance", description: "Repairs and upkeep.", tone: "neutral" },
    taxes: { label: "Taxes", description: "Government charges.", tone: "neutral" },
    fees: { label: "Fees", description: "Bank, platform and processing charges.", tone: "neutral" },
    other: { label: "Other", description: "A cost that does not fit another category.", tone: "neutral" },
  });

export const PRODUCT_STATUS: Readonly<Record<ProductStatus, StatusDescriptor>> = table({
  active: { label: "Active", description: "On sale and counted in your stock.", tone: "positive" },
  discontinued: { label: "Discontinued", description: "No longer traded. Kept for your records.", tone: "neutral" },
  out_of_stock: { label: "Out of stock", description: "Active product with nothing left in stock.", tone: "negative" },
});

export const MOVEMENT_TYPE: Readonly<Record<MovementType, StatusDescriptor>> = table({
  purchase: { label: "Stock added", description: "Goods received from a supplier.", tone: "positive" },
  sale: { label: "Stock sold", description: "Goods left the shelf as a sale.", tone: "info" },
  return: { label: "Returned", description: "Goods came back into stock.", tone: "info" },
  adjustment: { label: "Adjusted", description: "A correction to the recorded quantity.", tone: "caution" },
  damage: { label: "Damaged", description: "Stock removed because it was damaged.", tone: "negative" },
  transfer: { label: "Transferred", description: "Moved between locations.", tone: "neutral" },
});

export const RECEIVABLE_STATUS: Readonly<Record<ReceivableStatus, StatusDescriptor>> =
  table({
    pending: { label: "Not due yet", description: "Money owed to you, not yet due.", tone: "neutral" },
    partial: { label: "Part paid", description: "Some money received, some still owed.", tone: "caution" },
    paid: { label: "Paid", description: "Fully settled. Nothing outstanding.", tone: "positive" },
    overdue: { label: "Overdue", description: "Past its due date and still unpaid.", tone: "negative" },
    written_off: { label: "Written off", description: "Given up on. No longer counted as collectable.", tone: "neutral" },
  });

export const PAYABLE_STATUS: Readonly<Record<PayableStatus, StatusDescriptor>> = table({
  pending: { label: "Not due yet", description: "Money you owe, not yet due.", tone: "neutral" },
  partial: { label: "Part paid", description: "Some money paid, some still owed.", tone: "caution" },
  paid: { label: "Paid", description: "Fully settled.", tone: "positive" },
  overdue: { label: "Overdue", description: "Past its due date and still unpaid. It needs attention.", tone: "negative" },
});

export const PARTNER_STATUS: Readonly<Record<PartnerStatus, StatusDescriptor>> = table({
  active: { label: "Active", description: "Currently trading with them.", tone: "positive" },
  inactive: { label: "Inactive", description: "No longer trading with them.", tone: "neutral" },
});

/**
 * Document processing states, written as the merchant experiences them:
 * a document moves through a visible pipeline rather than appearing as data.
 */
export const DOCUMENT_STATUS: Readonly<Record<DocumentStatus, StatusDescriptor>> = table({
  uploaded: { label: "Uploaded", description: "Received. Not read yet.", tone: "neutral" },
  validating: { label: "Checking", description: "Being checked before reading.", tone: "pending" },
  queued: { label: "Queued", description: "Waiting to be read.", tone: "pending" },
  processing: { label: "Reading", description: "Reading the details out of this document.", tone: "pending" },
  extracted: { label: "Read", description: "Details extracted. Not yet confirmed.", tone: "info" },
  review_required: { label: "Needs review", description: "Waiting for you to confirm the extracted details.", tone: "caution" },
  approved: { label: "Confirmed", description: "You confirmed these details. They are now part of your records.", tone: "positive" },
  rejected: { label: "Rejected", description: "Not accepted. It will not affect your numbers.", tone: "negative" },
  failed: { label: "Failed", description: "Could not be read. You can send it again.", tone: "negative" },
});

/** Ordering of document states for the ingestion progress rail. */
export const DOCUMENT_PIPELINE: readonly DocumentStatus[] = [
  "uploaded",
  "validating",
  "queued",
  "processing",
  "extracted",
  "review_required",
  "approved",
];

export const DOCUMENT_SOURCE_TYPE: Readonly<Record<DocumentSourceType, StatusDescriptor>> =
  table({
    invoice: { label: "Invoice", description: "A bill you sent or received.", tone: "neutral" },
    receipt: { label: "Receipt", description: "Proof of payment.", tone: "neutral" },
    upi_screenshot: { label: "UPI screenshot", description: "A screenshot of a UPI payment.", tone: "neutral" },
    pdf: { label: "PDF", description: "A PDF document.", tone: "neutral" },
    audio: { label: "Voice note", description: "A recorded voice note.", tone: "neutral" },
    csv: { label: "CSV file", description: "A spreadsheet export.", tone: "neutral" },
    excel: { label: "Excel file", description: "A spreadsheet export.", tone: "neutral" },
    whatsapp_export: { label: "WhatsApp export", description: "An exported chat.", tone: "neutral" },
    text: { label: "Text", description: "Typed or pasted text.", tone: "neutral" },
    image: { label: "Image", description: "A photo of a document.", tone: "neutral" },
    other: { label: "Other", description: "Another kind of document.", tone: "neutral" },
  });

export const BUSINESS_STATUS: Readonly<Record<BusinessStatus, StatusDescriptor>> = table({
  active: { label: "Active", description: "This business is trading.", tone: "positive" },
  suspended: { label: "Suspended", description: "Paused. Records are kept but nothing new is accepted.", tone: "caution" },
  closed: { label: "Closed", description: "No longer trading.", tone: "neutral" },
});

export const USER_ROLE: Readonly<Record<UserRole, StatusDescriptor>> = table({
  owner: { label: "Owner", description: "Full control, including billing and settings.", tone: "info" },
  admin: { label: "Admin", description: "Can manage the business and its team.", tone: "info" },
  manager: { label: "Manager", description: "Can run day-to-day operations.", tone: "neutral" },
  accountant: { label: "Accountant", description: "Can work with money and records.", tone: "neutral" },
  staff: { label: "Staff", description: "Limited access to day-to-day work.", tone: "neutral" },
});

/**
 * Presentation bucket for a stock level, derived only from fields the backend
 * already returned (`status`, `currentStock`, `reorderPoint`).
 *
 * This is a LABEL, not a business rule. The authoritative "needs reorder"
 * set is `GET /api/inventory/low-stock`, which applies the backend's own
 * Phase 1 rule. A row is only given the `reorder` bucket when the backend
 * has actually listed it as low stock.
 */
export type StockLevel = "out_of_stock" | "reorder" | "low" | "healthy" | "inactive";

export const STOCK_LEVEL: Readonly<Record<StockLevel, StatusDescriptor>> = table({
  out_of_stock: {
    label: "Out of stock",
    description: "Nothing left. You cannot sell this until you restock.",
    tone: "negative",
  },
  reorder: {
    label: "Reorder now",
    description: "At or below the reorder point. Order more before you run out.",
    tone: "negative",
  },
  low: {
    label: "Running low",
    description: "Below the reorder point. Watch this one.",
    tone: "caution",
  },
  healthy: {
    label: "Healthy",
    description: "Stock level is comfortable.",
    tone: "positive",
  },
  inactive: {
    label: "Not traded",
    description: "Discontinued. Kept for your records only.",
    tone: "neutral",
  },
});

export function stockLevel(
  product: {
    readonly status: ProductStatus;
    readonly currentStock: number;
    readonly reorderPoint: number;
  },
  options: { readonly backendFlaggedLowStock?: boolean } = {},
): StockLevel {
  if (product.status === "discontinued") return "inactive";
  if (product.status === "out_of_stock" || product.currentStock <= 0) {
    return "out_of_stock";
  }
  if (options.backendFlaggedLowStock) return "reorder";
  if (product.reorderPoint > 0 && product.currentStock <= product.reorderPoint) {
    return "low";
  }
  return "healthy";
}

/**
 * Resolves a descriptor from a union table, falling back to a neutral
 * "Unknown" so an unrecognised backend value renders as unverified rather
 * than crashing a page.
 */
export function describeStatus(
  table_: Readonly<Record<string, StatusDescriptor>>,
  value: string | null | undefined,
): StatusDescriptor {
  if (!value) return NEUTRAL;
  return table_[value] ?? NEUTRAL;
}
/** Merchant-facing unit names. `piece` alone is not a word a merchant uses. */
export const PRODUCT_UNIT_LABEL: Readonly<Record<ProductUnit, string>> = {
  piece: "pieces",
  kg: "kg",
  gram: "g",
  liter: "litre",
  ml: "ml",
  meter: "metre",
  dozen: "dozen",
  box: "box",
  other: "units",
};
