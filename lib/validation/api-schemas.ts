// Merchant Brain: Phase 3 request schemas
//
// Built from the `*Input` interfaces already declared in
// modules/*/application/service.ts — no new fields are introduced.
//
// Money arrives as an integer minor-unit amount plus a currency. This mirrors
// the domain rule that money is never a float (AI_RULES.md).

import { z } from 'zod';

const uuid = z.string().uuid();

export const transactionTypeSchema = z.enum(['sale', 'purchase', 'payment', 'refund']);
export const transactionStatusSchema = z.enum(['draft', 'confirmed', 'completed', 'voided']);
export const paymentMethodSchema = z.enum(['cash', 'upi', 'card', 'bank_transfer', 'credit', 'other']);
export const expenseCategorySchema = z.enum([
  'rent', 'utilities', 'salaries', 'supplies', 'marketing',
  'transportation', 'insurance', 'maintenance', 'taxes', 'fees', 'other',
]);
export const expenseStatusSchema = z.enum(['pending', 'approved', 'rejected', 'paid']);
export const movementTypeSchema = z.enum(['purchase', 'sale', 'return', 'adjustment', 'damage', 'transfer']);
export const productStatusSchema = z.enum(['active', 'discontinued', 'out_of_stock']);
export const receivableStatusSchema = z.enum(['pending', 'partial', 'paid', 'overdue', 'written_off']);
export const payableStatusSchema = z.enum(['pending', 'partial', 'paid', 'overdue']);
export const partnerStatusSchema = z.enum(['active', 'inactive']);
export const documentSourceTypeSchema = z.enum([
  'invoice', 'receipt', 'upi_screenshot', 'pdf', 'audio',
  'csv', 'excel', 'whatsapp_export', 'text', 'image', 'other',
]);
export const documentStatusSchema = z.enum([
  'uploaded', 'validating', 'queued', 'processing', 'extracted',
  'review_required', 'approved', 'rejected', 'failed',
]);
export const currencySchema = z.enum(['INR', 'USD', 'EUR', 'GBP']);

/**
 * Largest single money value accepted, in minor units.
 *
 * Postgres stores money in `bigint`, and the service adds and multiplies these
 * values in JavaScript, so the real ceiling is `Number.MAX_SAFE_INTEGER`, not
 * bigint's range. An unbounded `z.number().int()` accepts values such as 1e30,
 * which pass validation and then fail at the driver as an unhandled 500.
 */
export const MAX_MINOR_AMOUNT = 1_000_000_000_000;

const minorAmount = z
  .number()
  .int('Money must be an integer in minor units.')
  .nonnegative()
  .max(MAX_MINOR_AMOUNT, 'Amount exceeds the maximum supported value.');

/**
 * Quantity, matching `transaction_items.quantity numeric(20,3)`.
 *
 * Bounded at three decimal places because the column stores three, and capped
 * so `unitPrice * quantity` cannot exceed `Number.MAX_SAFE_INTEGER`: a value
 * Postgres would round to `0.000` fails its own `CHECK (quantity > 0)` and a
 * value that large loses integer precision before it ever reaches the ledger.
 */
const quantitySchema = z
  .number()
  .finite()
  .positive('Quantity must be greater than zero.')
  .max(1_000_000, 'Quantity exceeds the maximum supported value.')
  .refine(
    (value) => Number.isInteger(value * 1000),
    'Quantity must have at most 3 decimal places.',
  );

/** POST /api/transactions — mirrors CreateTransactionInput */
export const createTransactionSchema = z.object({
  type: transactionTypeSchema,
  counterpartyType: z.enum(['customer', 'supplier']),
  counterpartyId: z.string().min(1).max(128),
  items: z
    .array(
      z.object({
        productId: uuid,
        quantity: quantitySchema,
        unitPrice: minorAmount,
        discount: minorAmount.default(0),
        tax: minorAmount.default(0),
      }),
    )
    .min(1, 'A transaction requires at least one line item.')
    // Without an upper bound a single authenticated request could carry a
    // body of a million line items: the body is buffered, every item is summed,
    // and the whole array is then inserted in one statement.
    .max(200, 'A transaction cannot exceed 200 line items.'),
  paymentMethod: paymentMethodSchema.optional(),
  reference: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  transactionDate: z.string().datetime({ offset: true }),
  idempotencyKey: z.string().min(8).max(200).optional(),
});

/** GET /api/transactions/duplicate-check — the subset of create used for matching */
export const duplicateCheckSchema = z.object({
  type: transactionTypeSchema,
  counterpartyType: z.enum(['customer', 'supplier']),
  counterpartyId: z.string().min(1).max(128),
  total: minorAmount,
  transactionDate: z.string().datetime({ offset: true }),
});

/** PATCH /api/transactions/[id]/status */
export const updateTransactionStatusSchema = z.object({
  status: transactionStatusSchema,
});

/** POST /api/expenses — mirrors CreateExpenseInput */
export const createExpenseSchema = z.object({
  category: expenseCategorySchema,
  amount: z
    .number('Amount must be an integer in minor units.')
    .int('Amount must be an integer in minor units.')
    .positive('Amount must be greater than zero.'),
  currency: currencySchema.default('INR'),
  description: z.string().min(1).max(500),
  vendor: z.string().max(200).optional(),
  reference: z.string().max(200).optional(),
  expenseDate: z.string().datetime({ offset: true }),
  isRecurring: z.boolean().default(false),
  recurringFrequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).optional(),
  recurringNextDueDate: z.string().datetime({ offset: true }).optional(),
  idempotencyKey: z.string().min(8).max(200).optional(),
});

/** POST /api/inventory/movements — mirrors RecordMovementInput */
export const recordMovementSchema = z.object({
  productId: uuid,
  type: movementTypeSchema,
  quantity: quantitySchema,
  reference: z.string().max(200).optional(),
  referenceType: z.enum(['transaction', 'adjustment', 'return']).optional(),
  referenceId: z.string().max(200).optional(),
});

/** POST /api/documents — metadata only; binary upload is out of scope (see plan §6) */
export const createDocumentSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(150),
  fileSize: z
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024, 'File size must not exceed 50MB.'),
  sourceType: documentSourceTypeSchema,
  storagePath: z
    .string()
    .min(1)
    .max(500)
    .refine(
      (value) => !value.includes('..') && !value.startsWith('/'),
      'storagePath must be a relative path without traversal segments.',
    )
    .refine(
      (value) => !value.includes('\\'),
      'storagePath must not contain backslash separators.',
    )
    .refine(
      (value) => value.split('/').every((segment) => segment.length > 0),
      'storagePath must not contain empty path segments.',
    ),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
});

/**
 * PATCH /api/documents/[id]/status
 *
 * `rejected` requires a reason. Without this refinement the generic status
 * route could reject a document with a null reason, bypassing the rule that
 * `POST /documents/[id]/reject` exists to enforce — and leaving an irreversible
 * rejection with no explanation for whoever reviews it.
 */
export const updateDocumentStatusSchema = z
  .object({
    status: documentStatusSchema,
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((value) => value.status !== 'rejected' || value.reason !== undefined, {
    message: 'A rejection reason is required when rejecting a document.',
    path: ['reason'],
  })
  // The service writes `rejection_reason` unconditionally, so a reason supplied
  // with any other status would be persisted onto an approved document and
  // returned as `metadata.rejectionReason`. Approved and rejected are both
  // terminal, so the mistake could never be corrected afterwards.
  .refine((value) => value.status === 'rejected' || value.reason === undefined, {
    message: 'A reason may only be supplied when rejecting a document.',
    path: ['reason'],
  });

/** POST /api/documents/[id]/reject */
export const rejectDocumentSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const businessTypeSchema = z.enum([
  'retail',
  'wholesale',
  'manufacturing',
  'services',
  'food_beverage',
  'other',
]);

/** POST /api/businesses */
export const createBusinessSchema = z.object({
  name: z.string().trim().min(1, 'Business name is required').max(200),
  type: businessTypeSchema.default('retail'),
  profile: z
    .object({
      displayName: z.string().max(200).optional(),
      industry: z.string().max(120).optional(),
      address: z.string().max(500).optional(),
      phone: z.string().max(40).optional(),
      email: z.string().email().max(200).optional(),
      gstin: z.string().max(20).optional(),
      pan: z.string().max(20).optional(),
    })
    .optional()
    .default({}),
  settings: z
    .object({
      currency: currencySchema.optional().default('INR'),
      fiscalYearStart: z.number().int().min(1).max(12).optional().default(1),
      timezone: z.string().min(1).max(64).optional().default('Asia/Kolkata'),
      lowStockThreshold: z.number().int().nonnegative().optional().default(5),
      overdueThresholdDays: z.number().int().nonnegative().optional().default(30),
    })
    .default({
      currency: 'INR',
      fiscalYearStart: 1,
      timezone: 'Asia/Kolkata',
      lowStockThreshold: 5,
      overdueThresholdDays: 30,
    }),
});

/** PATCH /api/businesses/current/profile — mirrors Partial<BusinessProfile> */
export const updateBusinessProfileSchema = z
  .object({
    displayName: z.string().min(1).max(200).optional(),
    industry: z.string().max(120).optional(),
    address: z.string().max(500).optional(),
    phone: z.string().max(40).optional(),
    email: z.string().email().max(200).optional(),
    gstin: z.string().max(20).optional(),
    pan: z.string().max(20).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be provided.');

/** PATCH /api/businesses/current/settings — mirrors Partial<BusinessSettings> */
export const updateBusinessSettingsSchema = z
  .object({
    currency: currencySchema.optional(),
    fiscalYearStart: z.number().int().min(1).max(12).optional(),
    timezone: z.string().min(1).max(64).optional(),
    lowStockThreshold: z.number().int().nonnegative().optional(),
    overdueThresholdDays: z.number().int().nonnegative().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be provided.');

/** POST /api/businesses/[businessId]/simulator/scenarios */
export const runScenarioSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  parameters: z.array(z.object({
    name: z.string().min(1).optional(),
    type: z.enum([
      'revenue_change', 'expense_change', 'cost_change', 'price_change', 'volume_change', 'working_capital_delay',
      'quantity_change', 'discount_change', 'payment_timing', 'inventory_order'
    ]),
    unit: z.enum(['percentage', 'basis_points', 'minor_units', 'days', 'amount', 'quantity']),
    value: z.number().int().optional(),
    currentValue: z.number().int().optional(),
    newValue: z.number().int().optional(),
    targetId: z.string().optional(),
    targetName: z.string().optional(),
    targetCategory: z.string().optional(),
    targetProductId: z.string().uuid().optional(),
  })).min(1),
});

/** POST /api/businesses/[businessId]/actions/propose */
export const proposeActionSchema = z.object({
  type: z.enum([
    'adjust_price',
    'generate_report',
    'reorder_stock',
    'send_reminder',
    'change_supplier',
    'reduce_expense',
    'create_transaction',
    'custom',
  ]),
  title: z.string().min(1).max(200),
  description: z.string().max(2000),
  source: z.enum(['ai_recommendation', 'profit_leak', 'cash_flow_risk', 'manual']).default('manual'),
  parameters: z.record(z.string(), z.unknown()).default({}),
  relatedLeakId: z.string().uuid().optional(),
  relatedRiskId: z.string().uuid().optional(),
});

/** POST /api/businesses/[businessId]/cash-flow/forecast */
export const generateForecastSchema = z.object({
  horizonDays: z.number().int().min(7).max(365).optional().default(30),
  assumptions: z.object({
    receivableCollectionRateBasisPoints: z.number().int().min(0).max(10000).optional(),
    payablePaymentRateBasisPoints: z.number().int().min(0).max(10000).optional(),
    projectedDailyRevenueMinor: z.number().int().min(0).optional(),
    projectedDailyExpenseMinor: z.number().int().min(0).optional(),
  }).optional(),
});
