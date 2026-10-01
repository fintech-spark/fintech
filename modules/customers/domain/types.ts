import type { BusinessId, CustomerId, Money } from '@/lib/types';
export interface Customer {
  readonly id: CustomerId; readonly businessId: BusinessId; readonly name: string; readonly phone?: string;
  readonly email?: string; readonly address?: string; readonly gstin?: string; readonly status: CustomerStatus;
  readonly totalPurchases: Money; readonly outstandingBalance: Money; readonly lastTransactionDate?: Date;
  readonly createdAt: Date; readonly updatedAt: Date;
}
export type CustomerStatus = 'active' | 'inactive';
export interface Receivable {
  readonly id: string; readonly businessId: BusinessId; readonly customerId: CustomerId; readonly transactionId: string;
  readonly amount: Money; readonly dueDate: Date; readonly status: ReceivableStatus; readonly paidAmount: Money; readonly paidDate?: Date;
}
export type ReceivableStatus = 'pending' | 'partial' | 'paid' | 'overdue' | 'written_off';
