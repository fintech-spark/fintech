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
import { PostgrestSupplierRepository, DefaultSupplierService } from '@/modules/customers/infrastructure/customer-repository';
import { PostgrestDocumentRepository, DefaultDocumentService } from '@/modules/customers/infrastructure/customer-repository';
import { PostgrestBusinessRepository, DefaultBusinessService } from '@/modules/customers/infrastructure/customer-repository';

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
export function wireClient(client: unknown): Wired {
  const db = client as Db;

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