import type { Product, MovementType } from './types';
export function needsReorder(product: Product): boolean { return product.currentStock <= product.reorderPoint && product.status === 'active'; }
export function hasSufficientStock(currentStock: number, requestedQuantity: number): boolean { return currentStock >= requestedQuantity; }
export function calculateNewStock(currentStock: number, quantity: number, type: MovementType): number {
  switch (type) {
    case 'purchase': case 'return': return currentStock + quantity;
    case 'sale': case 'damage': case 'transfer': return currentStock - quantity;
    case 'adjustment': return quantity;
  }
}
export function calculateInventoryValue(products: readonly Pick<Product, 'currentStock' | 'costPrice'>[]): number {
  return products.reduce((total, p) => total + p.currentStock * p.costPrice.amount, 0);
}
export function calculateMarginBps(costPrice: number, sellingPrice: number): number {
  if (sellingPrice === 0) return 0;
  return Math.round(((sellingPrice - costPrice) / sellingPrice) * 10_000);
}
