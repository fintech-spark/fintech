// Merchant Brain: the read-only business tool set
//
// The allowlist, assembled in one place. `createBusinessReadOnlyTools` returns
// exactly these tools and nothing else, so the registry's allowlist and the
// documented catalogue cannot drift apart.
//
// Eleven tools, chosen to cover the question families a merchant actually asks
// without a combinatorial sprawl of near-duplicates:
//
//   business_overview     who am I looking at
//   sales_summary         is revenue up or down, and versus what
//   product_performance   which product moved it
//   transaction_search    the individual records behind a total
//   inventory_status      were we stocked out
//   customer_context      who stopped buying, who owes us
//   supplier_context      did our costs move
//   expense_summary       where is the money going
//   cash_flow_summary     will cash hold
//   profit_leak_findings  what is already known to be leaking
//   context_coverage      is there any document context at all
//
// Every one is read-only. Nothing here mutates a merchant's business.

import type { DatabaseClient } from '@/lib/database/client';
import type { AnyToolDefinition } from '@/lib/ai/tools/registry';
import { createBusinessOverviewTool } from './overview-tool';
import {
  createProductPerformanceTool,
  createSalesSummaryTool,
  createTransactionSearchTool,
} from './sales-tools';
import {
  createExpenseSummaryTool,
  createInventoryStatusTool,
} from './operations-tools';
import {
  createCustomerContextTool,
  createSupplierContextTool,
} from './counterparty-tools';
import {
  createCashFlowSummaryTool,
  createContextCoverageTool,
  createProfitLeakFindingsTool,
} from './risk-tools';

export function createBusinessReadOnlyTools(database: DatabaseClient): AnyToolDefinition[] {
  return [
    createBusinessOverviewTool(database),
    createSalesSummaryTool(database),
    createProductPerformanceTool(database),
    createTransactionSearchTool(database),
    createInventoryStatusTool(database),
    createCustomerContextTool(database),
    createSupplierContextTool(database),
    createExpenseSummaryTool(database),
    createCashFlowSummaryTool(database),
    createProfitLeakFindingsTool(database),
    createContextCoverageTool(database),
  ];
}

export {
  createBusinessOverviewTool,
  createSalesSummaryTool,
  createProductPerformanceTool,
  createTransactionSearchTool,
  createInventoryStatusTool,
  createExpenseSummaryTool,
  createCustomerContextTool,
  createSupplierContextTool,
  createCashFlowSummaryTool,
  createProfitLeakFindingsTool,
  createContextCoverageTool,
};
