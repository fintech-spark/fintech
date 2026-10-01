import type { BusinessId, TransactionId, CustomerId, SupplierId, ProductId, UserId, Money } from '@/lib/types';
export interface Transaction {
  readonly id: TransactionId; readonly businessId: BusinessId; readonly type: TransactionType; readonly status: TransactionStatus;
  readonly counterpartyType: 'customer' | 'supplier'; readonly counterpartyId: CustomerId | SupplierId;
  readonly items: readonly TransactionItem[]; readonly subtotal: Money; readonly discount: Money; readonly tax: Money; readonly total: Money;
  readonly paymentMethod?: PaymentMethod; readonly reference?: string; readonly notes?: string; readonly transactionDate: Date;
  readonly createdAt: Date; readonly updatedAt: Date; readonly createdBy: UserId;
}
export type TransactionType = 'sale' | 'purchase' | 'payment' | 'refund';
export type TransactionStatus = 'draft' | 'confirmed' | 'completed' | 'voided';
export interface TransactionItem { readonly productId: ProductId; readonly productName: string; readonly quantity: number; readonly unitPrice: Money; readonly discount: Money; readonly tax: Money; readonly total: Money; }
export type PaymentMethod = 'cash' | 'upi' | 'card' | 'bank_transfer' | 'credit' | 'other';
