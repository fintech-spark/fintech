import type { AuthService } from '@/modules/auth';
import type { BusinessService } from '@/modules/businesses';
import type { TransactionService } from '@/modules/transactions';
import type { ExpenseService } from '@/modules/expenses';
import type { InventoryService } from '@/modules/inventory';
import type { CustomerService } from '@/modules/customers';
import type { SupplierService } from '@/modules/suppliers';
import type { DocumentService } from '@/modules/documents';
import type { IngestionService } from '@/modules/ingestion';
import type { ExtractionService } from '@/modules/extraction';
import type { AnalyticsService } from '@/modules/analytics';
import type { ProfitLeakService } from '@/modules/profit-leaks';
import type { CashFlowService } from '@/modules/cash-flow';
import type { SimulatorService } from '@/modules/simulator';
import type { BusinessBrainService } from '@/modules/business-brain';
import type { RAGService } from '@/modules/rag';
import type { ActionService } from '@/modules/actions';
import type { NotificationService } from '@/modules/notifications';
import type { AuditService } from '@/modules/audit';

export interface ModuleRegistry {
  auth: AuthService;
  businesses: BusinessService;
  transactions: TransactionService;
  expenses: ExpenseService;
  inventory: InventoryService;
  customers: CustomerService;
  suppliers: SupplierService;
  documents: DocumentService;
  ingestion: IngestionService;
  extraction: ExtractionService;
  analytics: AnalyticsService;
  profitLeaks: ProfitLeakService;
  cashFlow: CashFlowService;
  simulator: SimulatorService;
  businessBrain: BusinessBrainService;
  rag: RAGService;
  actions: ActionService;
  notifications: NotificationService;
  audit: AuditService;
}

export type ModuleName = keyof ModuleRegistry;

let registry: Partial<ModuleRegistry> = {};
let frozen = false;

export function registerModule<K extends ModuleName>(name: K, service: ModuleRegistry[K]): void {
  if (frozen) throw new Error(`Registry is frozen. Cannot register "${name}" after init.`);
  registry[name] = service;
}

export function getModule<K extends ModuleName>(name: K): ModuleRegistry[K] {
  const service = registry[name];
  if (!service) throw new Error(`Module "${name}" is not registered.`);
  return service as ModuleRegistry[K];
}

export function freezeRegistry(): void {
  frozen = true;
  Object.freeze(registry);
}

export function resetRegistry(): void {
  registry = {};
  frozen = false;
}
