import type { BusinessId, CustomerId, PaginatedResult } from '@/lib/types';
import type { Customer, Receivable } from '../domain/types';
import type { CustomerFilters, ReceivableFilters } from '../application/service';
export interface CustomerRepository {
  findById(businessId: BusinessId, id: CustomerId): Promise<Customer | null>;
  save(customer: Customer): Promise<Customer>;
  list(businessId: BusinessId, filters: CustomerFilters): Promise<PaginatedResult<Customer>>;
  findReceivables(businessId: BusinessId, filters: ReceivableFilters): Promise<PaginatedResult<Receivable>>;
  saveReceivable(receivable: Receivable): Promise<Receivable>;
}
