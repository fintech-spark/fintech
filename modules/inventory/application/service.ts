import type { TenantContext, PaginatedResult, PaginationParams, ProductId } from '@/lib/types';
import type { Product, InventoryMovement, MovementType, ProductStatus } from '../domain/types';
export interface InventoryService {
  getProduct(ctx: TenantContext, id: ProductId): Promise<Product | null>;
  listProducts(ctx: TenantContext, filters: ProductFilters): Promise<PaginatedResult<Product>>;
  recordMovement(ctx: TenantContext, input: RecordMovementInput): Promise<InventoryMovement>;
  getLowStockProducts(ctx: TenantContext): Promise<readonly Product[]>;
  getInventoryValue(ctx: TenantContext): Promise<{ totalValue: number; productCount: number }>;
}
export interface ProductFilters extends PaginationParams { readonly status?: ProductStatus; readonly category?: string; readonly lowStockOnly?: boolean; readonly search?: string; }
export interface RecordMovementInput { readonly productId: ProductId; readonly type: MovementType; readonly quantity: number; readonly reference?: string; readonly referenceType?: 'transaction' | 'adjustment' | 'return'; readonly referenceId?: string; }
