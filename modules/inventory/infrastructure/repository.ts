import type { BusinessId, ProductId, PaginatedResult } from '@/lib/types';
import type { Product, InventoryMovement } from '../domain/types';
import type { ProductFilters } from '../application/service';
export interface InventoryRepository {
  findProductById(businessId: BusinessId, id: ProductId): Promise<Product | null>;
  saveProduct(product: Product): Promise<Product>;
  updateProduct(product: Product): Promise<Product>;
  listProducts(businessId: BusinessId, filters: ProductFilters): Promise<PaginatedResult<Product>>;
  findLowStockProducts(businessId: BusinessId): Promise<readonly Product[]>;
  saveMovement(movement: InventoryMovement): Promise<InventoryMovement>;
}
