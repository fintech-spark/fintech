import type { BusinessId } from '@/lib/types';
import { getDatabaseClient } from '@/lib/database';
import { PostgresAnalyticsService } from '@/modules/analytics/application/postgres-analytics-service';
import { PostgresAnalyticsRepository } from '@/modules/analytics/infrastructure/postgres-analytics-repository';
import { PostgresCashFlowService } from '@/modules/cash-flow/application/postgres-cash-flow-service';
import { PostgresCashFlowRepository } from '@/modules/cash-flow/infrastructure/postgres-cash-flow-repository';
import { PostgresCashFlowForecastStore } from '@/modules/cash-flow/infrastructure/postgres-cash-flow-store';
import { PostgresProfitLeakService } from '@/modules/profit-leaks/application/postgres-profit-leak-service';
import { PostgresProfitLeakRepository } from '@/modules/profit-leaks/infrastructure/postgres-profit-leak-repository';
import { PostgresSimulatorService } from '@/modules/simulator/application/postgres-simulator-service';
import { PostgresScenarioRepository } from '@/modules/simulator/infrastructure/postgres-scenario-repository';
import { PostgresActionService } from '@/modules/actions/application/postgres-action-service';
import { PostgresActionRepository } from '@/modules/actions/infrastructure/postgres-action-repository';
import { ActionExecutorRegistry } from '@/modules/actions/domain/executors';
import { systemClock } from '@/lib/clock';
import { eventBus } from '@/lib/events';

// Merchant Brain: API route wiring
//
// One place that knows how to build the Supabase client and the module services.
// Route files stay thin: validate, delegate, return.

import 'server-only';

import { createServerClient } from '@/lib/supabase/server-client';
import type { Db } from '@/lib/database/query-helpers';
import { PostgrestTransactionRepository, DefaultTransactionService } from '@/modules/transactions/infrastructure/transaction-repository';
import { PostgrestExpenseRepository, DefaultExpenseService } from '@/modules/expenses/infrastructure/expense-repository';
import { PostgrestInventoryRepository, DefaultInventoryService } from '@/modules/inventory/infrastructure/inventory-repository';
import { PostgrestCustomerRepository, DefaultCustomerService } from '@/modules/customers/infrastructure/customer-repository';
import { PostgrestSupplierRepository, DefaultSupplierService } from '@/modules/suppliers/infrastructure/supplier-repository';
import { PostgrestDocumentRepository, DefaultDocumentService } from '@/modules/documents/infrastructure/document-repository';
import { PostgrestBusinessRepository, DefaultBusinessService } from '@/modules/businesses/infrastructure/business-repository';

export interface Wired {
  readonly db: Db;
  readonly transactions: DefaultTransactionService;
  readonly expenses: DefaultExpenseService;
  readonly inventory: DefaultInventoryService;
  readonly customers: DefaultCustomerService;
  readonly suppliers: DefaultSupplierService;
  readonly documents: DefaultDocumentService;
  readonly businesses: DefaultBusinessService;
}

/**
 * Builds the service graph over an RLS-enforced client.
 *
 * The client carries the caller's JWT, so every query below runs as that user
 * and migration 0004's policies apply. No repository can read another tenant
 * even if application code were wrong.
 */
export function wire(accessToken: string): Wired {
  return wireClient(createServerClient({ accessToken }) as Db);
}

/**
 * Builds the service graph over an already-resolved, RLS-enforced client.
 *
 * Route handlers use this with the client from `resolveTenantContext`, so the
 * tenant is resolved and authorised before any repository is constructed.
 */
export function wireClient(db: Db): Wired {
  return {
    db,
    transactions: new DefaultTransactionService(new PostgrestTransactionRepository(db)),
    expenses: new DefaultExpenseService(new PostgrestExpenseRepository(db)),
    inventory: new DefaultInventoryService(new PostgrestInventoryRepository(db)),
    customers: new DefaultCustomerService(new PostgrestCustomerRepository(db)),
    suppliers: new DefaultSupplierService(new PostgrestSupplierRepository(db)),
    documents: new DefaultDocumentService(new PostgrestDocumentRepository(db)),
    businesses: new DefaultBusinessService(new PostgrestBusinessRepository(db)),
  };
}

export type { Db };

export interface WiredIntelligence {
  readonly analytics: PostgresAnalyticsService;
  readonly cashFlow: PostgresCashFlowService;
  readonly profitLeaks: PostgresProfitLeakService;
  readonly simulator: PostgresSimulatorService;
  readonly actions: PostgresActionService;
}

/**
 * Builds the intelligence services graph for a verified tenant.
 *
 * Scoped directly through the TenantDatabaseClient so no statement
 * can escape business_id.
 */
export function wireIntelligence(businessId: BusinessId): WiredIntelligence {
  const rootDb = getDatabaseClient();
  const tenantDb = rootDb.forTenant(businessId);
  const analyticsRepo = new PostgresAnalyticsRepository(tenantDb);
  const analytics = new PostgresAnalyticsService(analyticsRepo, systemClock);
  const cashFlow = new PostgresCashFlowService(
    new PostgresCashFlowRepository(tenantDb),
    new PostgresCashFlowForecastStore(tenantDb),
    systemClock,
  );
  const profitLeaks = new PostgresProfitLeakService(
    new PostgresProfitLeakRepository(tenantDb),
    analytics,
    systemClock,
    eventBus,
  );
  const simulator = new PostgresSimulatorService(
    new PostgresScenarioRepository(tenantDb),
    analytics,
    systemClock,
  );
  const registry = new ActionExecutorRegistry();
  const actions = new PostgresActionService(
    new PostgresActionRepository(tenantDb),
    registry,
    systemClock,
    eventBus,
  );

  return {
    analytics,
    cashFlow,
    profitLeaks,
    simulator,
    actions,
  };
}
