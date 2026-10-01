import { z } from 'zod';
import {
  asBusinessId,
  asUserId,
  asTransactionId,
  asProductId,
  asCustomerId,
  asSupplierId,
  asDocumentId,
  asActionId,
  asExpenseId,
} from './types';

export const businessIdSchema = z.string().min(1).transform(asBusinessId);
export const userIdSchema = z.string().min(1).transform(asUserId);
export const transactionIdSchema = z.string().min(1).transform(asTransactionId);
export const productIdSchema = z.string().min(1).transform(asProductId);
export const customerIdSchema = z.string().min(1).transform(asCustomerId);
export const supplierIdSchema = z.string().min(1).transform(asSupplierId);
export const documentIdSchema = z.string().min(1).transform(asDocumentId);
export const actionIdSchema = z.string().min(1).transform(asActionId);
export const expenseIdSchema = z.string().min(1).transform(asExpenseId);

export const currencyCodeSchema = z.enum(['INR', 'USD', 'EUR', 'GBP']);

export const moneySchema = z.object({
  amount: z.number().int(),
  currency: currencyCodeSchema.default('INR'),
});

export const paginationParamsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().optional(),
});

export const dateRangeSchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .refine((data) => data.from <= data.to, {
    message: '"from" date must be earlier than or equal to "to" date',
    path: ['from'],
  });
