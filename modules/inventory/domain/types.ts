import type { BusinessId, ProductId, SupplierId, UserId, Money } from '@/lib/types';
export interface Product {
  readonly id: ProductId; readonly businessId: BusinessId; readonly name: string; readonly sku?: string; readonly category?: string;
  readonly unit: ProductUnit; readonly costPrice: Money; readonly sellingPrice: Money; readonly currentStock: number;
  readonly reorderPoint: number; readonly reorderQuantity: number; readonly status: ProductStatus; readonly supplierId?: SupplierId;
  readonly createdAt: Date; readonly updatedAt: Date;
}
export type ProductUnit = 'piece' | 'kg' | 'gram' | 'liter' | 'ml' | 'meter' | 'dozen' | 'box' | 'other';
export type ProductStatus = 'active' | 'discontinued' | 'out_of_stock';
export interface InventoryMovement {
  readonly id: string; readonly businessId: BusinessId; readonly productId: ProductId; readonly type: MovementType;
  readonly quantity: number; readonly previousStock: number; readonly newStock: number; readonly reference?: string;
  readonly referenceType?: 'transaction' | 'adjustment' | 'return'; readonly referenceId?: string;
  readonly createdAt: Date; readonly createdBy: UserId;
}
export type MovementType = 'purchase' | 'sale' | 'return' | 'adjustment' | 'damage' | 'transfer';
