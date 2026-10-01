import { describe, it, expect } from 'vitest';
import { detectCircularDependencies, isAllowedImport, MODULE_DEPENDENCIES } from '@/lib/boundaries';
import { createEventBus, type TransactionCreatedEvent } from '@/lib/events';
import { calculateGrossProfit, calculateNetProfit, calculateMarginBps } from '@/modules/analytics';
import { calculateNewStock, needsReorder } from '@/modules/inventory';
import { asBusinessId, asTransactionId, asProductId, createMoney } from '@/lib/types';

describe('Modular Monolith Architecture Invariants', () => {
  it('has zero circular dependencies in the module graph', () => {
    const cycle = detectCircularDependencies();
    expect(cycle).toBeNull();
  });

  it('enforces that all modules can import from the shared kernel (lib)', () => {
    for (const mod of Object.keys(MODULE_DEPENDENCIES)) {
      expect(isAllowedImport(mod, 'lib')).toBe(true);
    }
  });

  it('enforces that modules cannot import from unauthorized sibling modules', () => {
    expect(isAllowedImport('auth', 'transactions')).toBe(false);
    expect(isAllowedImport('businesses', 'transactions')).toBe(false);
    expect(isAllowedImport('transactions', 'analytics')).toBe(false);
    expect(isAllowedImport('analytics', 'transactions')).toBe(true);
    expect(isAllowedImport('analytics', 'inventory')).toBe(true);
  });

  it('publishes and receives events through the in-process typed event bus', async () => {
    const bus = createEventBus();
    const received: TransactionCreatedEvent[] = [];

    const unsubscribe = bus.subscribe('transaction.created', (event) => {
      received.push(event);
    });

    const event: TransactionCreatedEvent = {
      id: 'evt-1',
      type: 'transaction.created',
      businessId: asBusinessId('biz-123'),
      timestamp: new Date(),
      correlationId: 'corr-1',
      payload: {
        transactionId: asTransactionId('tx-1'),
        type: 'sale',
        totalMinorUnits: 50000,
        currency: 'INR',
      },
    };

    await bus.publish(event);
    expect(received).toHaveLength(1);
    expect(received[0].payload.totalMinorUnits).toBe(50000);

    unsubscribe();
    await bus.publish(event);
    expect(received).toHaveLength(1);
  });

  it('performs pure deterministic financial calculations in the domain layer', () => {
    const grossProfit = calculateGrossProfit(1_000_000, 600_000);
    expect(grossProfit).toBe(400_000);

    const netProfit = calculateNetProfit(grossProfit, 150_000);
    expect(netProfit).toBe(250_000);

    const marginBps = calculateMarginBps(grossProfit, 1_000_000);
    expect(marginBps).toBe(4000);
  });

  it('calculates inventory state and reorder status deterministically', () => {
    const currentStock = 20;
    const newStock = calculateNewStock(currentStock, 5, 'sale');
    expect(newStock).toBe(15);

    const reordered = needsReorder({
      id: asProductId('prod-1'),
      businessId: asBusinessId('biz-1'),
      name: 'Product 1',
      unit: 'piece',
      costPrice: createMoney(100),
      sellingPrice: createMoney(150),
      currentStock: 5,
      reorderPoint: 10,
      reorderQuantity: 20,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(reordered).toBe(true);
  });
});
