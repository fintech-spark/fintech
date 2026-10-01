export type { Product, ProductUnit, ProductStatus, InventoryMovement, MovementType } from './domain/types';
export { needsReorder, hasSufficientStock, calculateNewStock, calculateInventoryValue, calculateMarginBps } from './domain/rules';
export type { InventoryService, ProductFilters, RecordMovementInput } from './application/service';
export type { InventoryRepository } from './infrastructure/repository';
