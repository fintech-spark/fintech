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

const minorAmount = z.number().int('Money must be an integer in minor units.').nonnegative();

/** POST /api/transactions — mirrors CreateTransactionInput */
export const createTransactionSchema = z.object({
  type: transactionTypeSchema,
  counterpartyType: z.enum(['customer', 'supplier']),
  counterpartyId: z.string().min(1).max(128),
  items: z
    .array(
      z.object({
        productId: uuid,
        // Quantity is numeric(20,3) in Postgres; non-negative, finite only.
        quantity: z.number().finite().positive('Quantity must be greater than zero.'),
        unitPrice: minorAmount,
        discount: minorAmount.default(0),
        tax: minorAmount.default(0),
      }),
    )
    .min(1, 'A transaction requires at least one line item.'),
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
  quantity: z.number().finite().positive('Quantity must be greater than zero.'),
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
    ),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
});

/** PATCH /api/documents/[id]/status */
export const updateDocumentStatusSchema = z.object({
  status: documentStatusSchema,
  reason: z.string().max(500).optional(),
});

/** POST /api/documents/[id]/reject */
export const rejectDocumentSchema = z.object({
  reason: z.string().min(1).max(500),
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