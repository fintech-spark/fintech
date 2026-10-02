// Merchant Brain: Database Input Validation Schemas
//
// These Zod schemas validate external input BEFORE it reaches the database.
// They reject:
//   - Client-provided IDs (server generates UUIDs)
//   - Client-provided business_id (derived from TenantContext)
//   - Client-provided financial totals (computed server-side)
//   - Negative or non-integer monetary amounts
//   - Invalid enum values
//
// Usage: parse at API/service boundaries, then use the validated output
// to construct domain objects or repository calls.

import { z } from 'zod';
import { currencyCodeSchema, paginationParamsSchema, dateRangeSchema } from '@/lib/validators';

// ============================================================================
// Shared building blocks
// ============================================================================

const positiveInt = z.number().int().positive();
const nonNegInt = z.number().int().min(0);
const positiveNumber = z.number().positive();
const uuidString = z.string().uuid();

// Money input — integer minor units + currency
export const moneyInput = z.object({
  amount: nonNegInt,
  currency: currencyCodeSchema.default('INR'),
});

// Idempotency key — optional, non-empty string
const idempotencyKey = z.string().min(1).max(255).optional();

// ============================================================================
// Business inputs
// ============================================================================

export const createBusinessSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['retail', 'wholesale', 'manufacturing', 'services', 'food_beverage', 'other']),
  displayName: z.string().max(255).optional(),
  industry: z.string().max(255).optional(),
  address: z.string().max(1000).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().email().max(255).optional(),
  gstin: z.string().max(20).optional(),
  pan: z.string().max(20).optional(),
  currency: currencyCodeSchema.default('INR'),
  fiscalYearStart: z.number().int().min(1).max(12).default(1),
  timezone: z.string().max(100).default('Asia/Kolkata'),
  lowStockThreshold: nonNegInt.default(5),
  overdueThresholdDays: nonNegInt.default(30),
});

export const updateBusinessProfileSchema = z.object({
  displayName: z.string().max(255).optional(),
  industry: z.string().max(255).optional(),
  address: z.string().max(1000).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().email().max(255).optional(),
  gstin: z.string().max(20).optional(),
  pan: z.string().max(20).optional(),
});

export const updateBusinessSettingsSchema = z.object({
  currency: currencyCodeSchema.optional(),
  fiscalYearStart: z.number().int().min(1).max(12).optional(),
  timezone: z.string().max(100).optional(),
  lowStockThreshold: nonNegInt.optional(),
  overdueThresholdDays: nonNegInt.optional(),
});

// ============================================================================
// Transaction inputs
// ============================================================================

export const createTransactionItemSchema = z.object({
  productId: z.string().min(1),
  quantity: positiveNumber,
  unitPrice: nonNegInt,
  discount: nonNegInt.default(0),
  tax: nonNegInt.default(0),
});

export const createTransactionSchema = z.object({
  type: z.enum(['sale', 'purchase', 'payment', 'refund']),
  counterpartyType: z.enum(['customer', 'supplier']),
  counterpartyId: z.string().min(1),
  items: z.array(createTransactionItemSchema).min(1),
  paymentMethod: z.enum(['cash', 'upi', 'card', 'bank_transfer', 'credit', 'other']).optional(),
  reference: z.string().max(255).optional(),
  notes: z.string().max(5000).optional(),
  transactionDate: z.coerce.date(),
  idempotencyKey: idempotencyKey,
});

export const transactionFiltersSchema = z.object({
  type: z.enum(['sale', 'purchase', 'payment', 'refund']).optional(),
  status: z.enum(['draft', 'confirmed', 'completed', 'voided']).optional(),
  counterpartyId: z.string().min(1).optional(),
  dateRange: dateRangeSchema.optional(),
}).merge(paginationParamsSchema);

export const updateTransactionStatusSchema = z.object({
  status: z.enum(['draft', 'confirmed', 'completed', 'voided']),
});

// ============================================================================
// Expense inputs
// ============================================================================

export const createExpenseSchema = z.object({
  category: z.enum(['rent', 'utilities', 'salaries', 'supplies', 'marketing', 'transportation', 'insurance', 'maintenance', 'taxes', 'fees', 'other']),
  amount: positiveInt,
  currency: currencyCodeSchema.default('INR'),
  description: z.string().min(1).max(5000),
  vendor: z.string().max(255).optional(),
  reference: z.string().max(255).optional(),
  expenseDate: z.coerce.date(),
  isRecurring: z.boolean().default(false),
  recurringFrequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).optional(),
  recurringNextDueDate: z.coerce.date().optional(),
  recurringEndDate: z.coerce.date().optional(),
  idempotencyKey: idempotencyKey,
}).refine(
  (data) => !data.isRecurring || (data.recurringFrequency && data.recurringNextDueDate),
  { message: 'Recurring expenses require frequency and next due date', path: ['recurringFrequency'] },
);

export const expenseFiltersSchema = z.object({
  category: z.enum(['rent', 'utilities', 'salaries', 'supplies', 'marketing', 'transportation', 'insurance', 'maintenance', 'taxes', 'fees', 'other']).optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'paid']).optional(),
  dateRange: dateRangeSchema.optional(),
}).merge(paginationParamsSchema);

// ============================================================================
// Product inputs
// ============================================================================

export const createProductSchema = z.object({
  name: z.string().min(1).max(255),
  sku: z.string().max(100).optional(),
  category: z.string().max(255).optional(),
  unit: z.enum(['piece', 'kg', 'gram', 'liter', 'ml', 'meter', 'dozen', 'box', 'other']),
  costPrice: nonNegInt,
  sellingPrice: nonNegInt,
  currency: currencyCodeSchema.default('INR'),
  currentStock: z.number().min(0).default(0),
  reorderPoint: z.number().min(0).default(0),
  reorderQuantity: z.number().min(0).default(0),
  supplierId: uuidString.optional(),
});

export const productFiltersSchema = z.object({
  status: z.enum(['active', 'discontinued', 'out_of_stock']).optional(),
  category: z.string().max(255).optional(),
  lowStockOnly: z.boolean().optional(),
  search: z.string().max(255).optional(),
}).merge(paginationParamsSchema);

// ============================================================================
// Customer inputs
// ============================================================================

export const createCustomerSchema = z.object({
  name: z.string().min(1).max(255),
  phone: z.string().max(50).optional(),
  email: z.string().email().max(255).optional(),
  address: z.string().max(1000).optional(),
  gstin: z.string().max(20).optional(),
});

export const customerFiltersSchema = z.object({
  search: z.string().max(255).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  hasOutstanding: z.boolean().optional(),
}).merge(paginationParamsSchema);

// ============================================================================
// Supplier inputs
// ============================================================================

export const createSupplierSchema = z.object({
  name: z.string().min(1).max(255),
  contactName: z.string().max(255).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().email().max(255).optional(),
  address: z.string().max(1000).optional(),
  gstin: z.string().max(20).optional(),
});

export const supplierFiltersSchema = z.object({
  search: z.string().max(255).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  hasOutstanding: z.boolean().optional(),
}).merge(paginationParamsSchema);

// ============================================================================
// Document inputs
// ============================================================================

export const uploadDocumentSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  fileSize: z.number().int().positive().max(50 * 1024 * 1024),
  sourceType: z.enum(['invoice', 'receipt', 'upi_screenshot', 'pdf', 'audio', 'csv', 'excel', 'whatsapp_export', 'text', 'image', 'other']),
  tags: z.array(z.string().max(100)).max(20).optional(),
});

export const documentFiltersSchema = z.object({
  status: z.enum(['uploaded', 'validating', 'queued', 'processing', 'extracted', 'review_required', 'approved', 'rejected', 'failed']).optional(),
  sourceType: z.enum(['invoice', 'receipt', 'upi_screenshot', 'pdf', 'audio', 'csv', 'excel', 'whatsapp_export', 'text', 'image', 'other']).optional(),
  dateRange: dateRangeSchema.optional(),
  search: z.string().max(255).optional(),
}).merge(paginationParamsSchema);

// ============================================================================
// Inventory movement inputs
// ============================================================================

export const recordMovementSchema = z.object({
  productId: z.string().min(1),
  type: z.enum(['purchase', 'sale', 'return', 'adjustment', 'damage', 'transfer']),
  quantity: positiveNumber,
  reference: z.string().max(255).optional(),
  referenceType: z.enum(['transaction', 'adjustment', 'return']).optional(),
  referenceId: z.string().max(255).optional(),
});

// ============================================================================
// Action inputs
// ============================================================================

export const proposeActionSchema = z.object({
  type: z.enum(['adjust_price', 'reorder_stock', 'send_reminder', 'change_supplier', 'reduce_expense', 'create_transaction', 'custom']),
  title: z.string().min(1).max(255),
  description: z.string().min(1).max(5000),
  source: z.enum(['ai_recommendation', 'profit_leak', 'cash_flow_risk', 'manual']),
  parameters: z.record(z.string(), z.unknown()),
  idempotencyKey: idempotencyKey,
});

export const actionFiltersSchema = z.object({
  type: z.enum(['adjust_price', 'reorder_stock', 'send_reminder', 'change_supplier', 'reduce_expense', 'create_transaction', 'custom']).optional(),
  status: z.enum(['proposed', 'drafted', 'awaiting_approval', 'approved', 'executing', 'completed', 'failed', 'cancelled']).optional(),
  source: z.enum(['ai_recommendation', 'profit_leak', 'cash_flow_risk', 'manual']).optional(),
}).merge(paginationParamsSchema);

// ============================================================================
// Notification inputs
// ============================================================================

export const sendNotificationSchema = z.object({
  userId: z.string().min(1),
  type: z.enum(['profit_leak_detected', 'cash_flow_risk', 'action_proposed', 'action_completed', 'document_processed', 'low_stock_alert', 'overdue_payment', 'review_required', 'system']),
  title: z.string().min(1).max(255),
  message: z.string().min(1).max(5000),
  severity: z.enum(['critical', 'warning', 'info', 'success']),
  actionUrl: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ============================================================================
// Audit inputs
// ============================================================================

export const logAuditSchema = z.object({
  action: z.enum(['create', 'update', 'delete', 'approve', 'reject', 'execute', 'upload', 'extract', 'login', 'view']),
  resourceType: z.enum(['transaction', 'expense', 'product', 'customer', 'supplier', 'document', 'action', 'scenario', 'business_setting', 'user', 'brain_query']),
  resourceId: z.string().min(1).max(255),
  before: z.record(z.string(), z.unknown()).optional(),
  after: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ============================================================================
// Receivable / Payable filters
// ============================================================================

export const receivableFiltersSchema = z.object({
  customerId: z.string().min(1).optional(),
  status: z.enum(['pending', 'partial', 'paid', 'overdue', 'written_off']).optional(),
  dateRange: dateRangeSchema.optional(),
}).merge(paginationParamsSchema);

export const payableFiltersSchema = z.object({
  supplierId: z.string().min(1).optional(),
  status: z.enum(['pending', 'partial', 'paid', 'overdue']).optional(),
  dateRange: dateRangeSchema.optional(),
}).merge(paginationParamsSchema);

// ============================================================================
// Profit leak filters
// ============================================================================

export const leakFiltersSchema = z.object({
  category: z.enum(['supplier_cost_increase', 'margin_compression', 'excessive_discounting', 'dead_inventory', 'high_payment_fees', 'abnormal_expenses', 'overdue_receivables', 'low_margin_products']).optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  status: z.enum(['active', 'acknowledged', 'resolved', 'dismissed']).optional(),
}).merge(paginationParamsSchema);

// ============================================================================
// Scenario inputs
// ============================================================================

export const scenarioParameterSchema = z.object({
  type: z.enum(['price_change', 'quantity_change', 'discount_change', 'cost_change', 'expense_change', 'payment_timing', 'inventory_order']),
  targetId: z.string().optional(),
  targetName: z.string().optional(),
  currentValue: z.number(),
  newValue: z.number(),
  unit: z.enum(['amount', 'percentage', 'quantity', 'days']),
});

export const runScenarioSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  parameters: z.array(scenarioParameterSchema).min(1),
});

export const scenarioFiltersSchema = z.object({
  status: z.enum(['draft', 'calculated', 'expired']).optional(),
}).merge(paginationParamsSchema);
