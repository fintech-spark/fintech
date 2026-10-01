import type { BusinessId, TransactionId, PaginatedResult } from '@/lib/types';
import type { Transaction } from '../domain/types';
import type { TransactionFilters } from '../application/service';
export interface TransactionRepository {
  findById(businessId: BusinessId, id: TransactionId): Promise<Transaction | null>;
  save(transaction: Transaction): Promise<Transaction>;
  update(transaction: Transaction): Promise<Transaction>;
  list(businessId: BusinessId, filters: TransactionFilters): Promise<PaginatedResult<Transaction>>;
  findByCounterparty(businessId: BusinessId, counterpartyId: string, limit?: number): Promise<readonly Transaction[]>;
}
