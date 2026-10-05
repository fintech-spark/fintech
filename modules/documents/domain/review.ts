import { z } from 'zod';

const money = z.number().int().min(0).max(1_000_000_000_000);
const currency = z.enum(['INR','USD','EUR','GBP']);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}, 'A valid calendar date is required.');
const text = z.string().trim().min(1).max(500);
export const reviewedLineSchema = z.object({
  description: text, quantity: z.number().int().positive().max(1_000_000),
  unitPriceMinor: money, discountMinor: money, taxMinor: money, totalMinor: money,
}).strict().refine((line) => {
  const subtotal = BigInt(line.unitPriceMinor) * BigInt(line.quantity);
  return subtotal <= BigInt(1_000_000_000_000) && BigInt(line.discountMinor) <= subtotal &&
    subtotal - BigInt(line.discountMinor) + BigInt(line.taxMinor) === BigInt(line.totalMinor);
}, 'Line total must equal quantity × unit price − discount + tax, within supported limits.');

export const documentReviewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('expense'), reviewed: z.literal(true), extractionId: z.string().uuid(),
    date, reference: text, currency, category: z.enum(['rent','utilities','salaries','supplies','marketing',
      'transportation','insurance','maintenance','taxes','fees','other']), description: text, vendor: text,
    amountMinor: money.positive(),
  }).strict(),
  z.object({ kind: z.literal('invoice'), reviewed: z.literal(true), extractionId: z.string().uuid(),
    date, reference: text, currency, direction: z.enum(['sale','purchase']), counterpartyId: z.string().uuid(),
    items: z.array(reviewedLineSchema).min(1).max(200), totalMinor: money.positive(),
  }).strict(),
]).superRefine((review, ctx) => {
  if (review.kind !== 'invoice') return;
  const total = review.items.reduce((sum, line) => sum + BigInt(line.totalMinor), BigInt(0));
  const subtotal = review.items.reduce((sum, line) => sum + BigInt(line.unitPriceMinor) * BigInt(line.quantity), BigInt(0));
  const discount = review.items.reduce((sum, line) => sum + BigInt(line.discountMinor), BigInt(0));
  const tax = review.items.reduce((sum, line) => sum + BigInt(line.taxMinor), BigInt(0));
  if (total !== BigInt(review.totalMinor) || [subtotal, discount, tax, total].some((n) => n > BigInt(1_000_000_000_000))) {
    ctx.addIssue({ code: 'custom', path: ['totalMinor'], message: 'Invoice total must match the reviewed lines and supported limits.' });
  }
});
export type DocumentReviewInput = z.infer<typeof documentReviewSchema>;
