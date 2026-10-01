import type { BusinessId, SupplierId, Money } from '@/lib/types';
export interface Supplier {
  readonly id: SupplierId; readonly businessId: BusinessId; readonly name: string; readonly contactName?: string;
  readonly phone?: string; readonly email?: string; readonly address?: string; readonly gstin?: string;
  readonly status: SupplierStatus; readonly totalPurchases: Money; readonly outstandingPayable: Money;
  readonly lastTransactionDate?: Date; readonly createdAt: Date; readonly updatedAt: Date;
}
export type SupplierStatus = 'active' | 'inactive';
export interface Payable {
  readonly id: string; readonly businessId: BusinessId; readonly supplierId: SupplierId; readonly transactionId: string;
  readonly amount: Money; readonly dueDate: Date; readonly status: PayableStatus; readonly paidAmount: Money; readonly paidDate?: Date;
}
export type PayableStatus = 'pending' | 'partial' | 'paid' | 'overdue';
export interface SupplierPricing { readonly supplierId: SupplierId; readonly productId: string; readonly unitPrice: Money; readonly minOrderQuantity?: number; readonly lastUpdated: Date; }
