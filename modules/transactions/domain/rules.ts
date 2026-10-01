import type { Transaction, TransactionStatus, TransactionItem } from './types';
import type { Money } from '@/lib/types';
const VALID_TRANSITIONS: Record<TransactionStatus, readonly TransactionStatus[]> = {
  draft: ['confirmed', 'voided'], confirmed: ['completed', 'voided'], completed: [], voided: [],
};
export function canTransitionTo(current: TransactionStatus, next: TransactionStatus): boolean { return VALID_TRANSITIONS[current].includes(next); }
export function isModifiable(status: TransactionStatus): boolean { return status === 'draft' || status === 'confirmed'; }
export function calculateItemTotal(item: Pick<TransactionItem, 'unitPrice' | 'quantity' | 'discount' | 'tax'>): number {
  return item.unitPrice.amount * item.quantity - item.discount.amount + item.tax.amount;
}
export function validateTransactionTotal(items: readonly TransactionItem[], expectedTotal: Money): boolean {
  const computed = items.reduce((sum, item) => sum + item.total.amount, 0);
  return computed === expectedTotal.amount;
}
export function isDuplicateCandidate(a: Transaction, b: Transaction): boolean {
  return a.counterpartyId === b.counterpartyId && a.total.amount === b.total.amount && a.total.currency === b.total.currency && a.transactionDate.toDateString() === b.transactionDate.toDateString() && a.type === b.type;
}
