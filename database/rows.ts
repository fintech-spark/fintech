// Merchant Brain: Database Row Type Definitions
//
// These interfaces represent the *physical shape* of database rows as returned
// by the PostgreSQL driver (pg). They use primitive types — UUIDs are strings,
// minor-unit money is number, timestamps are Date, JSONB is unknown.
//
// Repository implementations map between these row types and the rich domain
// types in modules/*/domain/types.ts (which use branded IDs, Money, etc.).

// ============================================================================
// Core tables
// ============================================================================

export interface BusinessRow {
  id: string;
  name: string;
  type: string;
  status: string;
  display_name: string | null;
  industry: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  pan: string | null;
  currency: string;
  fiscal_year_start: number;
  timezone: string;
  low_stock_threshold: number;
  overdue_threshold_days: number;
  created_at: Date;
  updated_at: Date;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

export interface BusinessMemberRow {
  id: string;
  business_id: string;
  user_id: string;
  role: string;
  status: string;
  joined_at: Date;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// Partner tables
// ============================================================================

export interface SupplierRow {
  id: string;
  business_id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  status: string;
  total_purchases_minor: number;
  outstanding_payable_minor: number;
  currency: string;
  last_transaction_date: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface CustomerRow {
  id: string;
  business_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  status: string;
  total_purchases_minor: number;
  outstanding_balance_minor: number;
  currency: string;
  last_transaction_date: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface ReceivableRow {
  id: string;
  business_id: string;
  customer_id: string;
  transaction_id: string;
  amount_minor: number;
  paid_amount_minor: number;
  currency: string;
  due_date: Date;
  status: string;
  paid_date: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface PayableRow {
  id: string;
  business_id: string;
  supplier_id: string;
  transaction_id: string;
  amount_minor: number;
  paid_amount_minor: number;
  currency: string;
  due_date: Date;
  status: string;
  paid_date: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface SupplierPricingRow {
  id: string;
  business_id: string;
  supplier_id: string;
  product_id: string;
  unit_price_minor: number;
  currency: string;
  min_order_quantity: number | null;
  last_updated: Date;
}

// ============================================================================
// Inventory tables
// ============================================================================

export interface ProductRow {
  id: string;
  business_id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  cost_price_minor: number;
  selling_price_minor: number;
  currency: string;
  current_stock: number;
  reorder_point: number;
  reorder_quantity: number;
  status: string;
  supplier_id: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface InventoryMovementRow {
  id: string;
  business_id: string;
  product_id: string;
  type: string;
  quantity: number;
  previous_stock: number;
  new_stock: number;
  reference: string | null;
  reference_type: string | null;
  reference_id: string | null;
  created_by: string;
  created_at: Date;
}

// ============================================================================
// Transaction tables
// ============================================================================

export interface TransactionRow {
  id: string;
  business_id: string;
  type: string;
  status: string;
  counterparty_type: string;
  counterparty_id: string;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  currency: string;
  payment_method: string | null;
  reference: string | null;
  notes: string | null;
  idempotency_key: string | null;
  transaction_date: Date;
  created_by: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface TransactionItemRow {
  id: string;
  transaction_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  created_at: Date;
}

// ============================================================================
// Expense table
// ============================================================================

export interface ExpenseRow {
  id: string;
  business_id: string;
  category: string;
  amount_minor: number;
  currency: string;
  description: string;
  vendor: string | null;
  reference: string | null;
  status: string;
  expense_date: Date;
  is_recurring: boolean;
  recurring_frequency: string | null;
  recurring_next_due_date: Date | null;
  recurring_end_date: Date | null;
  idempotency_key: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// Document tables
// ============================================================================

export interface DocumentRow {
  id: string;
  business_id: string;
  source_type: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  storage_path: string;
  status: string;
  original_name: string | null;
  content_hash: string | null;
  page_count: number | null;
  language: string | null;
  extraction_id: string | null;
  rejection_reason: string | null;
  tags: string[];
  uploaded_by: string;
  uploaded_at: Date;
  processed_at: Date | null;
  updated_at: Date;
}

export interface IngestionJobRow {
  id: string;
  business_id: string;
  document_id: string;
  state: string;
  source_type: string;
  steps: unknown;
  result: unknown;
  error: string | null;
  started_at: Date;
  completed_at: Date | null;
  created_by: string;
}

export interface DocumentExtractionRow {
  id: string;
  business_id: string;
  document_id: string;
  status: string;
  fields: unknown;
  overall_confidence: string | null;
  model_used: string;
  raw_output: string | null;
  extracted_at: Date;
  validated_at: Date | null;
}

export interface DocumentEmbeddingRow {
  id: string;
  business_id: string;
  document_id: string;
  content: string;
  metadata: unknown;
  embedding: number[] | string | null;
  created_at: Date;
}

// ============================================================================
// Analytics tables
// ============================================================================

export interface ProfitLeakRow {
  id: string;
  business_id: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  impact_minor: number;
  currency: string;
  impact_period: string;
  evidence: unknown;
  status: string;
  detected_at: Date;
  resolved_at: Date | null;
  updated_at: Date;
}

export interface CashFlowForecastRow {
  id: string;
  business_id: string;
  period_start: Date;
  period_end: Date;
  periods: unknown;
  starting_cash_minor: number;
  ending_cash_minor: number;
  currency: string;
  risks: unknown;
  calculated_at: Date;
}

export interface ScenarioRow {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  parameters: unknown;
  baseline: unknown;
  projected: unknown;
  comparison: unknown;
  status: string;
  created_at: Date;
}

// ============================================================================
// Action tables
// ============================================================================

export interface ActionRow {
  id: string;
  business_id: string;
  type: string;
  title: string;
  description: string;
  status: string;
  source: string;
  parameters: unknown;
  result: unknown;
  idempotency_key: string | null;
  created_by: string;
  approved_by: string | null;
  approved_at: Date | null;
  executed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ActionLogRow {
  id: string;
  action_id: string;
  status: string;
  message: string | null;
  metadata: unknown;
  created_at: Date;
}

// ============================================================================
// Communication tables
// ============================================================================

export interface ChatSessionRow {
  id: string;
  business_id: string;
  user_id: string;
  started_at: Date;
  last_activity_at: Date;
}

export interface ChatMessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  tools_used: unknown;
  evidence: unknown;
  metadata: unknown;
  created_at: Date;
}

export interface NotificationRow {
  id: string;
  business_id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  severity: string;
  status: string;
  action_url: string | null;
  metadata: unknown;
  created_at: Date;
  read_at: Date | null;
  updated_at: Date;
}

export interface AuditLogRow {
  id: string;
  business_id: string;
  user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  before: unknown;
  after: unknown;
  metadata: unknown;
  ip: string | null;
  user_agent: string | null;
  timestamp: Date;
}

// ============================================================================
// Row type union (for generic utilities)
// ============================================================================

export type TableRow =
  | BusinessRow
  | UserRow
  | BusinessMemberRow
  | SupplierRow
  | CustomerRow
  | ReceivableRow
  | PayableRow
  | SupplierPricingRow
  | ProductRow
  | InventoryMovementRow
  | TransactionRow
  | TransactionItemRow
  | ExpenseRow
  | DocumentRow
  | IngestionJobRow
  | DocumentExtractionRow
  | DocumentEmbeddingRow
  | ProfitLeakRow
  | CashFlowForecastRow
  | ScenarioRow
  | ActionRow
  | ActionLogRow
  | ChatSessionRow
  | ChatMessageRow
  | NotificationRow
  | AuditLogRow;
