import type { BusinessId, SupplierId, PaginatedResult } from '@/lib/types';
import type { Supplier, Payable, SupplierPricing } from '../domain/types';
import type { SupplierFilters, PayableFilters } from '../application/service';
export interface SupplierRepository {
  findById(businessId: BusinessId, id: SupplierId): Promise<Supplier | null>;
  save(supplier: Supplier): Promise<Supplier>;
  list(businessId: BusinessId, filters: SupplierFilters): Promise<PaginatedResult<Supplier>>;
  findPayables(businessId: BusinessId, filters: PayableFilters): Promise<PaginatedResult<Payable>>;
  savePayable(payable: Payable): Promise<Payable>;
  findPricingBySupplierId(businessId: BusinessId, supplierId: SupplierId): Promise<readonly SupplierPricing[]>;
}
