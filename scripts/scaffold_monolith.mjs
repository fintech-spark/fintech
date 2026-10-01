import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function write(relPath, content) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content.trim() + '\n', 'utf8');
}

// ==========================================
// 1. Shared Kernel (lib/)
// ==========================================

write('lib/types.ts', `
declare const brand: unique symbol;
export type Brand<T, B> = T & { readonly [brand]: B };

export type UserId = Brand<string, 'UserId'>;
export type BusinessId = Brand<string, 'BusinessId'>;
export type TransactionId = Brand<string, 'TransactionId'>;
export type ProductId = Brand<string, 'ProductId'>;
export type CustomerId = Brand<string, 'CustomerId'>;
export type SupplierId = Brand<string, 'SupplierId'>;
export type DocumentId = Brand<string, 'DocumentId'>;
export type ActionId = Brand<string, 'ActionId'>;
export type ExpenseId = Brand<string, 'ExpenseId'>;

export function asUserId(id: string): UserId { return id as UserId; }
export function asBusinessId(id: string): BusinessId { return id as BusinessId; }
export function asTransactionId(id: string): TransactionId { return id as TransactionId; }
export function asProductId(id: string): ProductId { return id as ProductId; }
export function asCustomerId(id: string): CustomerId { return id as CustomerId; }
export function asSupplierId(id: string): SupplierId { return id as SupplierId; }
export function asDocumentId(id: string): DocumentId { return id as DocumentId; }
export function asActionId(id: string): ActionId { return id as ActionId; }
export function asExpenseId(id: string): ExpenseId { return id as ExpenseId; }

export type Result<T, E = Error> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: E };

export function ok<T>(data: T): Result<T, never> { return { success: true, data }; }
export function err<E>(error: E): Result<never, E> { return { success: false, error }; }

export type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP';

export interface Money {
  readonly amount: number;
  readonly currency: CurrencyCode;
}

export function createMoney(amount: number, currency: CurrencyCode = 'INR'): Money {
  if (!Number.isInteger(amount)) {
    throw new TypeError(\`Money amount must be an integer (minor units), got: \${amount}\`);
  }
  return { amount, currency };
}

export type UserRole = 'owner' | 'admin' | 'manager' | 'accountant' | 'staff';

export interface TenantContext {
  readonly businessId: BusinessId;
  readonly userId: UserId;
  readonly role: UserRole;
  readonly correlationId: string;
}

export interface PaginationParams {
  readonly page?: number;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly hasMore: boolean;
  readonly nextCursor?: string;
}

export interface DateRange {
  readonly from: Date;
  readonly to: Date;
}
`);

write('lib/errors.ts', `
export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;

  constructor(message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND';
  readonly statusCode = 404;
  constructor(resource: string, id?: string) {
    super(id ? \`\${resource} with id "\${id}" was not found.\` : \`\${resource} was not found.\`, { resource, id });
  }
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR';
  readonly statusCode = 400;
  constructor(message: string, public readonly issues?: Array<{ field: string; message: string }>) {
    super(message, { issues });
  }
}

export class AuthenticationError extends AppError {
  readonly code = 'UNAUTHENTICATED';
  readonly statusCode = 401;
  constructor(message = 'Authentication required.') { super(message); }
}

export class AuthorizationError extends AppError {
  readonly code = 'FORBIDDEN';
  readonly statusCode = 403;
  constructor(message = 'You do not have permission to perform this action.') { super(message); }
}

export class ConflictError extends AppError {
  readonly code = 'CONFLICT';
  readonly statusCode = 409;
  constructor(message: string, details?: Record<string, unknown>) { super(message, details); }
}

export class RateLimitError extends AppError {
  readonly code = 'RATE_LIMITED';
  readonly statusCode = 429;
  constructor(message = 'Too many requests. Please try again later.') { super(message); }
}

export class BusinessRuleError extends AppError {
  readonly code = 'BUSINESS_RULE_VIOLATION';
  readonly statusCode = 422;
  constructor(message: string, details?: Record<string, unknown>) { super(message, details); }
}

export class AIProviderError extends AppError {
  readonly code = 'AI_PROVIDER_ERROR';
  readonly statusCode = 502;
  constructor(message: string, public readonly provider: string, details?: Record<string, unknown>) {
    super(message, { provider, ...details });
  }
}

export class AIValidationError extends AppError {
  readonly code = 'AI_VALIDATION_ERROR';
  readonly statusCode = 502;
  constructor(message: string, public readonly rawOutput?: unknown) { super(message, { rawOutput }); }
}

export class ExtractionError extends AppError {
  readonly code = 'EXTRACTION_ERROR';
  readonly statusCode = 422;
  constructor(message: string, public readonly documentId: string, details?: Record<string, unknown>) {
    super(message, { documentId, ...details });
  }
}

export class StorageError extends AppError {
  readonly code = 'STORAGE_ERROR';
  readonly statusCode = 500;
  constructor(message: string, details?: Record<string, unknown>) { super(message, details); }
}
`);

write('lib/events.ts', `
import type { BusinessId, UserId, TransactionId, DocumentId, ActionId } from './types';

export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  readonly id: string;
  readonly type: TType;
  readonly businessId: BusinessId;
  readonly timestamp: Date;
  readonly correlationId: string;
  readonly actorId?: UserId;
  readonly payload: TPayload;
}

export type DocumentApprovedEvent = DomainEvent<'document.approved', {
  readonly documentId: DocumentId;
  readonly sourceType: string;
  readonly extractedEntityIds: readonly string[];
}>;

export type DocumentProcessedEvent = DomainEvent<'document.processed', {
  readonly documentId: DocumentId;
  readonly status: string;
}>;

export type TransactionCreatedEvent = DomainEvent<'transaction.created', {
  readonly transactionId: TransactionId;
  readonly type: 'sale' | 'purchase' | 'payment' | 'refund';
  readonly totalMinorUnits: number;
  readonly currency: string;
}>;

export type TransactionUpdatedEvent = DomainEvent<'transaction.updated', {
  readonly transactionId: TransactionId;
  readonly status: string;
}>;

export type InventoryChangedEvent = DomainEvent<'inventory.changed', {
  readonly productId: string;
  readonly previousStock: number;
  readonly newStock: number;
  readonly reason: string;
}>;

export type PaymentRecordedEvent = DomainEvent<'payment.recorded', {
  readonly paymentId: string;
  readonly amountMinorUnits: number;
  readonly counterpartyId: string;
}>;

export type ProfitLeakDetectedEvent = DomainEvent<'profit_leak.detected', {
  readonly leakId: string;
  readonly category: string;
  readonly estimatedLossMinorUnits: number;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
}>;

export type CashFlowRiskDetectedEvent = DomainEvent<'cash_flow.risk_detected', {
  readonly riskType: string;
  readonly projectedShortfallMinorUnits: number;
  readonly projectedDate: Date;
}>;

export type ActionProposedEvent = DomainEvent<'action.proposed', {
  readonly actionId: ActionId;
  readonly type: string;
  readonly source: string;
}>;

export type ActionApprovedEvent = DomainEvent<'action.approved', {
  readonly actionId: ActionId;
  readonly approvedBy: UserId;
}>;

export type ActionCompletedEvent = DomainEvent<'action.completed', {
  readonly actionId: ActionId;
  readonly result: Record<string, unknown>;
}>;

export type AppDomainEvents =
  | DocumentApprovedEvent
  | DocumentProcessedEvent
  | TransactionCreatedEvent
  | TransactionUpdatedEvent
  | InventoryChangedEvent
  | PaymentRecordedEvent
  | ProfitLeakDetectedEvent
  | CashFlowRiskDetectedEvent
  | ActionProposedEvent
  | ActionApprovedEvent
  | ActionCompletedEvent;

export type EventHandler<E extends DomainEvent = AppDomainEvents> = (event: E) => Promise<void> | void;

export type ExtractDomainEvent<T extends AppDomainEvents['type']> = Extract<AppDomainEvents, { type: T }>;

export interface EventBus {
  publish<E extends AppDomainEvents>(event: E): Promise<void>;
  subscribe<T extends AppDomainEvents['type']>(
    eventType: T,
    handler: (event: ExtractDomainEvent<T>) => Promise<void> | void,
  ): () => void;
}

type GenericHandler = (event: AppDomainEvents) => Promise<void> | void;

export function createEventBus(): EventBus {
  const handlers = new Map<string, Set<GenericHandler>>();

  return {
    async publish<E extends AppDomainEvents>(event: E): Promise<void> {
      const typeHandlers = handlers.get(event.type);
      if (!typeHandlers || typeHandlers.size === 0) return;

      const promises = Array.from(typeHandlers).map(async (handler) => {
        try {
          await handler(event);
        } catch (error) {
          console.error(\`Error handling event "\${event.type}" (ID: \${event.id}):\`, error);
        }
      });

      await Promise.all(promises);
    },

    subscribe<T extends AppDomainEvents['type']>(
      eventType: T,
      handler: (event: ExtractDomainEvent<T>) => Promise<void> | void,
    ): () => void {
      if (!handlers.has(eventType)) {
        handlers.set(eventType, new Set());
      }
      const set = handlers.get(eventType)!;
      set.add(handler as unknown as GenericHandler);

      return () => {
        set.delete(handler as unknown as GenericHandler);
        if (set.size === 0) {
          handlers.delete(eventType);
        }
      };
    },
  };
}

export const eventBus = createEventBus();
`);

write('lib/validators.ts', `
import { z } from 'zod';
import {
  asBusinessId,
  asUserId,
  asTransactionId,
  asProductId,
  asCustomerId,
  asSupplierId,
  asDocumentId,
  asActionId,
  asExpenseId,
} from './types';

export const businessIdSchema = z.string().min(1).transform(asBusinessId);
export const userIdSchema = z.string().min(1).transform(asUserId);
export const transactionIdSchema = z.string().min(1).transform(asTransactionId);
export const productIdSchema = z.string().min(1).transform(asProductId);
export const customerIdSchema = z.string().min(1).transform(asCustomerId);
export const supplierIdSchema = z.string().min(1).transform(asSupplierId);
export const documentIdSchema = z.string().min(1).transform(asDocumentId);
export const actionIdSchema = z.string().min(1).transform(asActionId);
export const expenseIdSchema = z.string().min(1).transform(asExpenseId);

export const currencyCodeSchema = z.enum(['INR', 'USD', 'EUR', 'GBP']);

export const moneySchema = z.object({
  amount: z.number().int(),
  currency: currencyCodeSchema.default('INR'),
});

export const paginationParamsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().optional(),
});

export const dateRangeSchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .refine((data) => data.from <= data.to, {
    message: '"from" date must be earlier than or equal to "to" date',
    path: ['from'],
  });
`);

write('lib/boundaries.ts', `
export const MODULE_DEPENDENCIES: Record<string, readonly string[]> = {
  auth: [],
  businesses: [],
  transactions: [],
  expenses: [],
  inventory: [],
  customers: [],
  suppliers: [],
  documents: [],
  ingestion: ['documents'],
  extraction: ['documents'],
  analytics: ['transactions', 'expenses', 'inventory', 'customers', 'suppliers'],
  'profit-leaks': ['analytics', 'transactions', 'expenses', 'inventory', 'suppliers'],
  'cash-flow': ['analytics', 'transactions', 'expenses', 'customers', 'suppliers'],
  simulator: ['analytics'],
  rag: ['documents'],
  'business-brain': ['rag', 'analytics', 'profit-leaks', 'cash-flow', 'actions'],
  actions: [],
  notifications: [],
  audit: [],
} as const;

export function isAllowedImport(fromModule: string, toModule: string): boolean {
  if (toModule === 'lib') return true;
  const allowedDeps = MODULE_DEPENDENCIES[fromModule];
  if (!allowedDeps) return false;
  return allowedDeps.includes(toModule);
}

export function detectCircularDependencies(): string[] | null {
  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(modName: string, path: string[]): string[] | null {
    if (stack.has(modName)) return [...path, modName];
    if (visited.has(modName)) return null;

    visited.add(modName);
    stack.add(modName);

    const deps = MODULE_DEPENDENCIES[modName] ?? [];
    for (const dep of deps) {
      const cycle = dfs(dep, [...path, modName]);
      if (cycle) return cycle;
    }

    stack.delete(modName);
    return null;
  }

  for (const modName of Object.keys(MODULE_DEPENDENCIES)) {
    const cycle = dfs(modName, []);
    if (cycle) return cycle;
  }

  return null;
}
`);

write('lib/database/client.ts', `
import type { BusinessId } from '../types';

export interface DatabaseTransaction {
  readonly id: string;
  query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<readonly T[]>;
  execute(sql: string, params?: readonly unknown[]): Promise<number>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface DatabaseClient {
  query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<readonly T[]>;
  execute(sql: string, params?: readonly unknown[]): Promise<number>;
  transaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T>;
  forTenant(businessId: BusinessId): TenantDatabaseClient;
}

export interface TenantDatabaseClient {
  readonly businessId: BusinessId;
  query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<readonly T[]>;
  execute(sql: string, params?: readonly unknown[]): Promise<number>;
  transaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T>;
}
`);

write('lib/database/index.ts', `
export type {
  DatabaseClient,
  TenantDatabaseClient,
  DatabaseTransaction,
} from './client';
`);

write('lib/ai/tools/types.ts', `
import type { TenantContext } from '@/lib/types';

export interface ToolContext {
  readonly tenant: TenantContext;
  readonly correlationId: string;
}

export interface ToolResult<T = unknown> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

export interface Tool<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  execute(ctx: ToolContext, input: TInput): Promise<ToolResult<TOutput>>;
}

export interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  list(): Tool[];
  getDefinitions(): { name: string; description: string; parameters: Record<string, unknown> }[];
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, Tool>();
  return {
    register(tool: Tool): void { tools.set(tool.name, tool); },
    get(name: string): Tool | undefined { return tools.get(name); },
    list(): Tool[] { return Array.from(tools.values()); },
    getDefinitions() {
      return Array.from(tools.values()).map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
    },
  };
}
`);

write('lib/ai/index.ts', `
export type {
  AIProvider,
  ModelRole,
  ModelConfig,
  CompletionRequest,
  CompletionResponse,
  AIMessage,
  AIContentPart,
  AIToolDefinition,
  AIToolCall,
  TokenUsage,
  EmbeddingRequest,
  EmbeddingResponse,
  AIProviderAdapter,
} from './providers/types';

export { createModelRegistry } from './router';
export type { ModelRegistry } from './router';

export { createToolRegistry } from './tools/types';
export type { Tool, ToolContext, ToolResult, ToolRegistry } from './tools/types';

export { guardOutput, guardJSON } from './guards';
export type { GuardResult } from './guards';

export { createAITelemetry } from './telemetry';
export type { AITelemetry, AIOperationRecord } from './telemetry';
`);

// ==========================================
// 2. Modules
// ==========================================

// Auth
write('modules/auth/domain/types.ts', `
import type { UserId, BusinessId, UserRole } from '@/lib/types';
export interface AuthenticatedUser { readonly id: UserId; readonly email: string; readonly name: string; readonly role: UserRole; }
export interface AuthSession { readonly userId: UserId; readonly businessId: BusinessId; readonly role: UserRole; readonly expiresAt: Date; }
export interface AccessContext { readonly user: AuthenticatedUser; readonly businessId: BusinessId; readonly permissions: readonly Permission[]; }
export type Permission = 'transactions:read' | 'transactions:write' | 'inventory:read' | 'inventory:write' | 'expenses:read' | 'expenses:write' | 'customers:read' | 'customers:write' | 'suppliers:read' | 'suppliers:write' | 'documents:read' | 'documents:write' | 'analytics:read' | 'actions:read' | 'actions:approve' | 'actions:execute' | 'settings:read' | 'settings:write' | 'audit:read';
`);
write('modules/auth/application/service.ts', `
import type { TenantContext, UserId, BusinessId } from '@/lib/types';
import type { AuthenticatedUser, AccessContext, Permission } from '../domain/types';
export interface AuthService {
  resolveUser(sessionToken: string): Promise<AuthenticatedUser | null>;
  establishContext(userId: UserId, businessId: BusinessId): Promise<TenantContext>;
  getAccessContext(ctx: TenantContext): Promise<AccessContext>;
  hasPermission(ctx: TenantContext, permission: Permission): Promise<boolean>;
  requirePermission(ctx: TenantContext, permission: Permission): Promise<void>;
}
`);
write('modules/auth/index.ts', `
export type { AuthenticatedUser, AuthSession, AccessContext, Permission } from './domain/types';
export type { AuthService } from './application/service';
`);

// Businesses
write('modules/businesses/domain/types.ts', `
import type { BusinessId, UserId, UserRole, CurrencyCode } from '@/lib/types';
export interface Business { readonly id: BusinessId; readonly name: string; readonly type: BusinessType; readonly status: BusinessStatus; readonly profile: BusinessProfile; readonly settings: BusinessSettings; readonly createdAt: Date; readonly updatedAt: Date; }
export type BusinessType = 'retail' | 'wholesale' | 'manufacturing' | 'services' | 'food_beverage' | 'other';
export type BusinessStatus = 'active' | 'suspended' | 'closed';
export interface BusinessProfile { readonly displayName: string; readonly industry?: string; readonly address?: string; readonly phone?: string; readonly email?: string; readonly gstin?: string; readonly pan?: string; }
export interface BusinessSettings { readonly currency: CurrencyCode; readonly fiscalYearStart: number; readonly timezone: string; readonly lowStockThreshold: number; readonly overdueThresholdDays: number; }
export interface BusinessMembership { readonly businessId: BusinessId; readonly userId: UserId; readonly role: UserRole; readonly joinedAt: Date; readonly status: 'active' | 'invited' | 'removed'; }
`);
write('modules/businesses/domain/rules.ts', `
import type { BusinessMembership, BusinessStatus } from './types';
export function isBusinessOperational(status: BusinessStatus): boolean { return status === 'active'; }
export function isMemberActive(membership: BusinessMembership): boolean { return membership.status === 'active'; }
export function canManageSettings(role: string): boolean { return role === 'owner' || role === 'admin'; }
export function canInviteMembers(role: string): boolean { return role === 'owner' || role === 'admin'; }
`);
write('modules/businesses/application/service.ts', `
import type { TenantContext } from '@/lib/types';
import type { Business, BusinessProfile, BusinessSettings, BusinessMembership } from '../domain/types';
export interface BusinessService {
  getById(ctx: TenantContext): Promise<Business>;
  updateProfile(ctx: TenantContext, profile: Partial<BusinessProfile>): Promise<Business>;
  updateSettings(ctx: TenantContext, settings: Partial<BusinessSettings>): Promise<Business>;
  getMembers(ctx: TenantContext): Promise<readonly BusinessMembership[]>;
}
export interface CreateBusinessInput { readonly name: string; readonly type: string; readonly profile: Partial<BusinessProfile>; readonly settings?: Partial<BusinessSettings>; }
`);
write('modules/businesses/infrastructure/repository.ts', `
import type { BusinessId, UserId } from '@/lib/types';
import type { Business, BusinessMembership } from '../domain/types';
export interface BusinessRepository {
  findById(id: BusinessId): Promise<Business | null>;
  save(business: Business): Promise<Business>;
  findMembershipsByBusiness(businessId: BusinessId): Promise<readonly BusinessMembership[]>;
  findMembershipByUser(businessId: BusinessId, userId: UserId): Promise<BusinessMembership | null>;
}
`);
write('modules/businesses/index.ts', `
export type { Business, BusinessType, BusinessStatus, BusinessProfile, BusinessSettings, BusinessMembership } from './domain/types';
export { isBusinessOperational, isMemberActive, canManageSettings, canInviteMembers } from './domain/rules';
export type { BusinessService, CreateBusinessInput } from './application/service';
export type { BusinessRepository } from './infrastructure/repository';
`);

// Transactions
write('modules/transactions/domain/types.ts', `
import type { BusinessId, TransactionId, CustomerId, SupplierId, ProductId, UserId, Money } from '@/lib/types';
export interface Transaction {
  readonly id: TransactionId; readonly businessId: BusinessId; readonly type: TransactionType; readonly status: TransactionStatus;
  readonly counterpartyType: 'customer' | 'supplier'; readonly counterpartyId: CustomerId | SupplierId;
  readonly items: readonly TransactionItem[]; readonly subtotal: Money; readonly discount: Money; readonly tax: Money; readonly total: Money;
  readonly paymentMethod?: PaymentMethod; readonly reference?: string; readonly notes?: string; readonly transactionDate: Date;
  readonly createdAt: Date; readonly updatedAt: Date; readonly createdBy: UserId;
}
export type TransactionType = 'sale' | 'purchase' | 'payment' | 'refund';
export type TransactionStatus = 'draft' | 'confirmed' | 'completed' | 'voided';
export interface TransactionItem { readonly productId: ProductId; readonly productName: string; readonly quantity: number; readonly unitPrice: Money; readonly discount: Money; readonly tax: Money; readonly total: Money; }
export type PaymentMethod = 'cash' | 'upi' | 'card' | 'bank_transfer' | 'credit' | 'other';
`);
write('modules/transactions/domain/rules.ts', `
import type { Transaction, TransactionStatus, TransactionItem } from './types';
import type { Money } from '@/lib/types';
const VALID_TRANSITIONS: Record<TransactionStatus, readonly TransactionStatus[]> = {
  draft: ['confirmed', 'voided'], confirmed: ['completed', 'voided'], completed: [], voided: [],
};
export function canTransitionTo(current: TransactionStatus, next: TransactionStatus): boolean { return VALID_TRANSITIONS[current].includes(next); }
export function isModifiable(status: TransactionStatus): boolean { return status === 'draft' || status === 'confirmed'; }
export function calculateItemTotal(item: Pick<TransactionItem, 'unitPrice' | 'quantity' | 'discount' | 'tax'>): number {
  return item.unitPrice.amount * item.quantity - item.discount.amount + item.tax.amount;
}
export function validateTransactionTotal(items: readonly TransactionItem[], expectedTotal: Money): boolean {
  const computed = items.reduce((sum, item) => sum + item.total.amount, 0);
  return computed === expectedTotal.amount;
}
export function isDuplicateCandidate(a: Transaction, b: Transaction): boolean {
  return a.counterpartyId === b.counterpartyId && a.total.amount === b.total.amount && a.total.currency === b.total.currency && a.transactionDate.toDateString() === b.transactionDate.toDateString() && a.type === b.type;
}
`);
write('modules/transactions/application/service.ts', `
import type { TenantContext, PaginatedResult, PaginationParams, DateRange, TransactionId } from '@/lib/types';
import type { Transaction, TransactionType, TransactionStatus, PaymentMethod } from '../domain/types';
export interface TransactionService {
  create(ctx: TenantContext, input: CreateTransactionInput): Promise<Transaction>;
  getById(ctx: TenantContext, id: TransactionId): Promise<Transaction | null>;
  list(ctx: TenantContext, filters: TransactionFilters): Promise<PaginatedResult<Transaction>>;
  updateStatus(ctx: TenantContext, id: TransactionId, status: TransactionStatus): Promise<Transaction>;
  checkDuplicate(ctx: TenantContext, input: CreateTransactionInput): Promise<Transaction | null>;
}
export interface CreateTransactionInput { readonly type: TransactionType; readonly counterpartyType: 'customer' | 'supplier'; readonly counterpartyId: string; readonly items: readonly CreateTransactionItemInput[]; readonly paymentMethod?: PaymentMethod; readonly reference?: string; readonly notes?: string; readonly transactionDate: Date; }
export interface CreateTransactionItemInput { readonly productId: string; readonly quantity: number; readonly unitPrice: number; readonly discount?: number; readonly tax?: number; }
export interface TransactionFilters extends PaginationParams { readonly type?: TransactionType; readonly status?: TransactionStatus; readonly counterpartyId?: string; readonly dateRange?: DateRange; }
`);
write('modules/transactions/infrastructure/repository.ts', `
import type { BusinessId, TransactionId, PaginatedResult } from '@/lib/types';
import type { Transaction } from '../domain/types';
import type { TransactionFilters } from '../application/service';
export interface TransactionRepository {
  findById(businessId: BusinessId, id: TransactionId): Promise<Transaction | null>;
  save(transaction: Transaction): Promise<Transaction>;
  update(transaction: Transaction): Promise<Transaction>;
  list(businessId: BusinessId, filters: TransactionFilters): Promise<PaginatedResult<Transaction>>;
  findByCounterparty(businessId: BusinessId, counterpartyId: string, limit?: number): Promise<readonly Transaction[]>;
}
`);
write('modules/transactions/index.ts', `
export type { Transaction, TransactionType, TransactionStatus, TransactionItem, PaymentMethod } from './domain/types';
export { canTransitionTo, isModifiable, calculateItemTotal, validateTransactionTotal } from './domain/rules';
export type { TransactionService, CreateTransactionInput, TransactionFilters } from './application/service';
export type { TransactionRepository } from './infrastructure/repository';
`);

// Expenses
write('modules/expenses/domain/types.ts', `
import type { BusinessId, ExpenseId, UserId, Money } from '@/lib/types';
export interface Expense {
  readonly id: ExpenseId; readonly businessId: BusinessId; readonly category: ExpenseCategory; readonly amount: Money;
  readonly description: string; readonly vendor?: string; readonly reference?: string; readonly status: ExpenseStatus;
  readonly expenseDate: Date; readonly isRecurring: boolean; readonly recurringConfig?: RecurringExpenseConfig;
  readonly createdAt: Date; readonly updatedAt: Date; readonly createdBy: UserId;
}
export type ExpenseCategory = 'rent' | 'utilities' | 'salaries' | 'supplies' | 'marketing' | 'transportation' | 'insurance' | 'maintenance' | 'taxes' | 'fees' | 'other';
export type ExpenseStatus = 'pending' | 'approved' | 'rejected' | 'paid';
export interface RecurringExpenseConfig { readonly frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'; readonly nextDueDate: Date; readonly endDate?: Date; }
`);
write('modules/expenses/application/service.ts', `
import type { TenantContext, PaginatedResult, PaginationParams, DateRange, ExpenseId } from '@/lib/types';
import type { Expense, ExpenseCategory, ExpenseStatus } from '../domain/types';
export interface ExpenseService {
  create(ctx: TenantContext, input: CreateExpenseInput): Promise<Expense>;
  getById(ctx: TenantContext, id: ExpenseId): Promise<Expense | null>;
  list(ctx: TenantContext, filters: ExpenseFilters): Promise<PaginatedResult<Expense>>;
  approve(ctx: TenantContext, id: ExpenseId): Promise<Expense>;
  getTotalByCategory(ctx: TenantContext, dateRange: DateRange): Promise<readonly CategoryTotal[]>;
}
export interface CreateExpenseInput { readonly category: ExpenseCategory; readonly amount: number; readonly currency: string; readonly description: string; readonly vendor?: string; readonly expenseDate: Date; }
export interface ExpenseFilters extends PaginationParams { readonly category?: ExpenseCategory; readonly status?: ExpenseStatus; readonly dateRange?: DateRange; }
export interface CategoryTotal { readonly category: ExpenseCategory; readonly total: number; readonly count: number; }
`);
write('modules/expenses/infrastructure/repository.ts', `
import type { BusinessId, ExpenseId, PaginatedResult } from '@/lib/types';
import type { Expense } from '../domain/types';
import type { ExpenseFilters } from '../application/service';
export interface ExpenseRepository {
  findById(businessId: BusinessId, id: ExpenseId): Promise<Expense | null>;
  save(expense: Expense): Promise<Expense>;
  update(expense: Expense): Promise<Expense>;
  list(businessId: BusinessId, filters: ExpenseFilters): Promise<PaginatedResult<Expense>>;
}
`);
write('modules/expenses/index.ts', `
export type { Expense, ExpenseCategory, ExpenseStatus, RecurringExpenseConfig } from './domain/types';
export type { ExpenseService, CreateExpenseInput, ExpenseFilters, CategoryTotal } from './application/service';
export type { ExpenseRepository } from './infrastructure/repository';
`);

// Inventory
write('modules/inventory/domain/types.ts', `
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
`);
write('modules/inventory/domain/rules.ts', `
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
`);
write('modules/inventory/application/service.ts', `
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
`);
write('modules/inventory/infrastructure/repository.ts', `
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
`);
write('modules/inventory/index.ts', `
export type { Product, ProductUnit, ProductStatus, InventoryMovement, MovementType } from './domain/types';
export { needsReorder, hasSufficientStock, calculateNewStock, calculateInventoryValue, calculateMarginBps } from './domain/rules';
export type { InventoryService, ProductFilters, RecordMovementInput } from './application/service';
export type { InventoryRepository } from './infrastructure/repository';
`);

// Customers
write('modules/customers/domain/types.ts', `
import type { BusinessId, CustomerId, Money } from '@/lib/types';
export interface Customer {
  readonly id: CustomerId; readonly businessId: BusinessId; readonly name: string; readonly phone?: string;
  readonly email?: string; readonly address?: string; readonly gstin?: string; readonly status: CustomerStatus;
  readonly totalPurchases: Money; readonly outstandingBalance: Money; readonly lastTransactionDate?: Date;
  readonly createdAt: Date; readonly updatedAt: Date;
}
export type CustomerStatus = 'active' | 'inactive';
export interface Receivable {
  readonly id: string; readonly businessId: BusinessId; readonly customerId: CustomerId; readonly transactionId: string;
  readonly amount: Money; readonly dueDate: Date; readonly status: ReceivableStatus; readonly paidAmount: Money; readonly paidDate?: Date;
}
export type ReceivableStatus = 'pending' | 'partial' | 'paid' | 'overdue' | 'written_off';
`);
write('modules/customers/application/service.ts', `
import type { TenantContext, PaginatedResult, PaginationParams, CustomerId, DateRange } from '@/lib/types';
import type { Customer, Receivable, ReceivableStatus } from '../domain/types';
export interface CustomerService {
  getById(ctx: TenantContext, id: CustomerId): Promise<Customer | null>;
  list(ctx: TenantContext, filters: CustomerFilters): Promise<PaginatedResult<Customer>>;
  getBalance(ctx: TenantContext, id: CustomerId): Promise<{ outstanding: number; overdue: number }>;
  getReceivables(ctx: TenantContext, filters: ReceivableFilters): Promise<PaginatedResult<Receivable>>;
  getTotalReceivables(ctx: TenantContext): Promise<{ total: number; overdue: number }>;
}
export interface CustomerFilters extends PaginationParams { readonly search?: string; readonly status?: 'active' | 'inactive'; readonly hasOutstanding?: boolean; }
export interface ReceivableFilters extends PaginationParams { readonly customerId?: CustomerId; readonly status?: ReceivableStatus; readonly dateRange?: DateRange; }
`);
write('modules/customers/infrastructure/repository.ts', `
import type { BusinessId, CustomerId, PaginatedResult } from '@/lib/types';
import type { Customer, Receivable } from '../domain/types';
import type { CustomerFilters, ReceivableFilters } from '../application/service';
export interface CustomerRepository {
  findById(businessId: BusinessId, id: CustomerId): Promise<Customer | null>;
  save(customer: Customer): Promise<Customer>;
  list(businessId: BusinessId, filters: CustomerFilters): Promise<PaginatedResult<Customer>>;
  findReceivables(businessId: BusinessId, filters: ReceivableFilters): Promise<PaginatedResult<Receivable>>;
  saveReceivable(receivable: Receivable): Promise<Receivable>;
}
`);
write('modules/customers/index.ts', `
export type { Customer, CustomerStatus, Receivable, ReceivableStatus } from './domain/types';
export type { CustomerService, CustomerFilters, ReceivableFilters } from './application/service';
export type { CustomerRepository } from './infrastructure/repository';
`);

// Suppliers
write('modules/suppliers/domain/types.ts', `
import type { BusinessId, SupplierId, Money } from '@/lib/types';
export interface Supplier {
  readonly id: SupplierId; readonly businessId: BusinessId; readonly name: string; readonly contactName?: string;
  readonly phone?: string; readonly email?: string; readonly address?: string; readonly gstin?: string;
  readonly status: SupplierStatus; readonly totalPurchases: Money; readonly outstandingPayable: Money;
  readonly lastTransactionDate?: Date; readonly createdAt: Date; readonly updatedAt: Date;
}
export type SupplierStatus = 'active' | 'inactive';
export interface Payable {
  readonly id: string; readonly businessId: BusinessId; readonly supplierId: SupplierId; readonly transactionId: string;
  readonly amount: Money; readonly dueDate: Date; readonly status: PayableStatus; readonly paidAmount: Money; readonly paidDate?: Date;
}
export type PayableStatus = 'pending' | 'partial' | 'paid' | 'overdue';
export interface SupplierPricing { readonly supplierId: SupplierId; readonly productId: string; readonly unitPrice: Money; readonly minOrderQuantity?: number; readonly lastUpdated: Date; }
`);
write('modules/suppliers/application/service.ts', `
import type { TenantContext, PaginatedResult, PaginationParams, SupplierId, DateRange } from '@/lib/types';
import type { Supplier, Payable, SupplierPricing, PayableStatus } from '../domain/types';
export interface SupplierService {
  getById(ctx: TenantContext, id: SupplierId): Promise<Supplier | null>;
  list(ctx: TenantContext, filters: SupplierFilters): Promise<PaginatedResult<Supplier>>;
  getPayables(ctx: TenantContext, filters: PayableFilters): Promise<PaginatedResult<Payable>>;
  getTotalPayables(ctx: TenantContext): Promise<{ total: number; overdue: number }>;
  getPricing(ctx: TenantContext, supplierId: SupplierId): Promise<readonly SupplierPricing[]>;
}
export interface SupplierFilters extends PaginationParams { readonly search?: string; readonly status?: 'active' | 'inactive'; readonly hasOutstanding?: boolean; }
export interface PayableFilters extends PaginationParams { readonly supplierId?: SupplierId; readonly status?: PayableStatus; readonly dateRange?: DateRange; }
`);
write('modules/suppliers/infrastructure/repository.ts', `
import type { BusinessId, SupplierId, PaginatedResult } from '@/lib/types';
import type { Supplier, Payable, SupplierPricing } from '../domain/types';
import type { SupplierFilters, PayableFilters } from '../application/service';
export interface SupplierRepository {
  findById(businessId: BusinessId, id: SupplierId): Promise<Supplier | null>;
  save(supplier: Supplier): Promise<Supplier>;
  list(businessId: BusinessId, filters: SupplierFilters): Promise<PaginatedResult<Supplier>>;
  findPayables(businessId: BusinessId, filters: PayableFilters): Promise<PaginatedResult<Payable>>;
  savePayable(payable: Payable): Promise<Payable>;
  findPricingBySupplierId(businessId: BusinessId, supplierId: SupplierId): Promise<readonly SupplierPricing[]>;
}
`);
write('modules/suppliers/index.ts', `
export type { Supplier, SupplierStatus, Payable, PayableStatus, SupplierPricing } from './domain/types';
export type { SupplierService, SupplierFilters, PayableFilters } from './application/service';
export type { SupplierRepository } from './infrastructure/repository';
`);

// Documents
write('modules/documents/domain/types.ts', `
import type { BusinessId, DocumentId, UserId } from '@/lib/types';
export interface Document {
  readonly id: DocumentId; readonly businessId: BusinessId; readonly sourceType: DocumentSourceType; readonly fileName: string;
  readonly mimeType: string; readonly fileSize: number; readonly storagePath: string; readonly status: DocumentStatus;
  readonly metadata: DocumentMetadata; readonly uploadedAt: Date; readonly processedAt?: Date; readonly uploadedBy: UserId;
}
export type DocumentSourceType = 'invoice' | 'receipt' | 'upi_screenshot' | 'pdf' | 'audio' | 'csv' | 'excel' | 'whatsapp_export' | 'text' | 'image' | 'other';
export type DocumentStatus = 'uploaded' | 'validating' | 'queued' | 'processing' | 'extracted' | 'review_required' | 'approved' | 'rejected' | 'failed';
export interface DocumentMetadata { readonly originalName: string; readonly contentHash?: string; readonly pageCount?: number; readonly language?: string; readonly extractionId?: string; readonly rejectionReason?: string; readonly tags?: readonly string[]; }
export const DOCUMENT_STATUS_TRANSITIONS: Record<DocumentStatus, readonly DocumentStatus[]> = {
  uploaded: ['validating', 'failed'], validating: ['queued', 'failed'], queued: ['processing'],
  processing: ['extracted', 'failed'], extracted: ['review_required', 'approved'], review_required: ['approved', 'rejected'],
  approved: [], rejected: [], failed: ['queued'],
};
`);
write('modules/documents/domain/rules.ts', `
import type { DocumentStatus } from './types';
import { DOCUMENT_STATUS_TRANSITIONS } from './types';
export function canTransitionDocumentTo(current: DocumentStatus, next: DocumentStatus): boolean { return DOCUMENT_STATUS_TRANSITIONS[current].includes(next); }
export function canRetry(status: DocumentStatus): boolean { return status === 'failed'; }
export function needsReview(status: DocumentStatus): boolean { return status === 'review_required'; }
export function isFinalized(status: DocumentStatus): boolean { return status === 'approved' || status === 'rejected'; }
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'audio/mpeg', 'audio/wav', 'audio/webm', 'text/plain'] as const;
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
export function isAllowedMimeType(mimeType: string): boolean { return (ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType); }
export function isWithinSizeLimit(sizeBytes: number): boolean { return sizeBytes <= MAX_FILE_SIZE_BYTES; }
`);
write('modules/documents/application/service.ts', `
import type { TenantContext, PaginatedResult, PaginationParams, DocumentId, DateRange } from '@/lib/types';
import type { Document, DocumentSourceType, DocumentStatus } from '../domain/types';
export interface DocumentService {
  upload(ctx: TenantContext, input: UploadDocumentInput): Promise<Document>;
  getById(ctx: TenantContext, id: DocumentId): Promise<Document | null>;
  list(ctx: TenantContext, filters: DocumentFilters): Promise<PaginatedResult<Document>>;
  updateStatus(ctx: TenantContext, id: DocumentId, status: DocumentStatus, reason?: string): Promise<Document>;
  approve(ctx: TenantContext, id: DocumentId): Promise<Document>;
  reject(ctx: TenantContext, id: DocumentId, reason: string): Promise<Document>;
}
export interface UploadDocumentInput { readonly fileName: string; readonly mimeType: string; readonly fileSize: number; readonly sourceType: DocumentSourceType; readonly fileData: Buffer | ArrayBuffer; readonly tags?: readonly string[]; }
export interface DocumentFilters extends PaginationParams { readonly status?: DocumentStatus; readonly sourceType?: DocumentSourceType; readonly dateRange?: DateRange; readonly search?: string; }
`);
write('modules/documents/infrastructure/repository.ts', `
import type { BusinessId, DocumentId, PaginatedResult } from '@/lib/types';
import type { Document } from '../domain/types';
import type { DocumentFilters } from '../application/service';
export interface DocumentRepository {
  findById(businessId: BusinessId, id: DocumentId): Promise<Document | null>;
  save(document: Document): Promise<Document>;
  update(document: Document): Promise<Document>;
  list(businessId: BusinessId, filters: DocumentFilters): Promise<PaginatedResult<Document>>;
  findByContentHash(businessId: BusinessId, contentHash: string): Promise<Document | null>;
}
export interface StorageAdapter {
  upload(path: string, data: Buffer | ArrayBuffer, mimeType: string): Promise<string>;
  download(path: string): Promise<Buffer>;
  delete(path: string): Promise<void>;
  getUrl(path: string): Promise<string>;
}
`);
write('modules/documents/index.ts', `
export type { Document, DocumentSourceType, DocumentStatus, DocumentMetadata } from './domain/types';
export { canTransitionDocumentTo, canRetry, needsReview, isFinalized, isAllowedMimeType, isWithinSizeLimit, ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from './domain/rules';
export type { DocumentService, UploadDocumentInput, DocumentFilters } from './application/service';
export type { DocumentRepository, StorageAdapter } from './infrastructure/repository';
`);

// Ingestion
write('modules/ingestion/domain/types.ts', `
import type { BusinessId, DocumentId, UserId } from '@/lib/types';
export interface IngestionJob {
  readonly id: string; readonly businessId: BusinessId; readonly documentId: DocumentId; readonly state: ProcessingState;
  readonly sourceType: string; readonly steps: readonly IngestionStep[]; readonly result?: IngestionResult; readonly error?: string;
  readonly startedAt: Date; readonly completedAt?: Date; readonly createdBy: UserId;
}
export type ProcessingState = 'pending' | 'validating' | 'storing' | 'extracting' | 'normalizing' | 'deduplicating' | 'review' | 'approved' | 'completed' | 'failed';
export interface IngestionStep { readonly name: string; readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'; readonly startedAt?: Date; readonly completedAt?: Date; readonly error?: string; }
export interface IngestionResult { readonly extractedEntities: number; readonly duplicatesFound: number; readonly requiresReview: boolean; readonly reviewReasons?: readonly string[]; }
`);
write('modules/ingestion/application/service.ts', `
import type { TenantContext, DocumentId } from '@/lib/types';
import type { IngestionJob } from '../domain/types';
export interface IngestionService {
  startIngestion(ctx: TenantContext, documentId: DocumentId): Promise<IngestionJob>;
  getJobStatus(ctx: TenantContext, jobId: string): Promise<IngestionJob | null>;
  advanceStep(ctx: TenantContext, jobId: string): Promise<IngestionJob>;
  failJob(ctx: TenantContext, jobId: string, error: string): Promise<IngestionJob>;
}
`);
write('modules/ingestion/index.ts', `
export type { IngestionJob, ProcessingState, IngestionStep, IngestionResult } from './domain/types';
export type { IngestionService } from './application/service';
`);

// Extraction
write('modules/extraction/domain/types.ts', `
import type { BusinessId, DocumentId } from '@/lib/types';
export interface ExtractionResult {
  readonly id: string; readonly businessId: BusinessId; readonly documentId: DocumentId; readonly status: ExtractionStatus;
  readonly fields: readonly ExtractionField[]; readonly overallConfidence: ConfidenceLevel; readonly modelUsed: string;
  readonly rawOutput?: string; readonly extractedAt: Date; readonly validatedAt?: Date;
}
export type ExtractionStatus = 'pending' | 'processing' | 'completed' | 'validated' | 'rejected' | 'failed';
export interface ExtractionField { readonly name: string; readonly value: unknown; readonly type: FieldType; readonly confidence: ConfidenceLevel; readonly source?: string; }
export type FieldType = 'string' | 'number' | 'date' | 'money' | 'boolean' | 'array';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export const CONFIDENCE_THRESHOLDS = { high: 0.9, medium: 0.7, low: 0.0 } as const;
export function classifyConfidence(score: number): ConfidenceLevel {
  if (score >= CONFIDENCE_THRESHOLDS.high) return 'high';
  if (score >= CONFIDENCE_THRESHOLDS.medium) return 'medium';
  return 'low';
}
`);
write('modules/extraction/application/service.ts', `
import type { TenantContext, DocumentId } from '@/lib/types';
import type { ExtractionResult } from '../domain/types';
export interface ExtractionService {
  extract(ctx: TenantContext, documentId: DocumentId): Promise<ExtractionResult>;
  getResult(ctx: TenantContext, extractionId: string): Promise<ExtractionResult | null>;
  validate(ctx: TenantContext, extractionId: string): Promise<ExtractionResult>;
  getByDocumentId(ctx: TenantContext, documentId: DocumentId): Promise<readonly ExtractionResult[]>;
}
`);
write('modules/extraction/index.ts', `
export type { ExtractionResult, ExtractionStatus, ExtractionField, FieldType, ConfidenceLevel } from './domain/types';
export { classifyConfidence, CONFIDENCE_THRESHOLDS } from './domain/types';
export type { ExtractionService } from './application/service';
`);

// Analytics
write('modules/analytics/domain/types.ts', `
import type { BusinessId, Money, DateRange } from '@/lib/types';
export interface FinancialSnapshot {
  readonly businessId: BusinessId; readonly period: DateRange; readonly revenue: Money; readonly cogs: Money;
  readonly grossProfit: Money; readonly grossMarginBps: number; readonly operatingExpenses: Money; readonly netProfit: Money;
  readonly netMarginBps: number; readonly inventoryValue: Money; readonly totalReceivables: Money; readonly totalPayables: Money;
  readonly cashPosition: Money; readonly calculatedAt: Date;
}
export interface FinancialMetric { readonly name: MetricName; readonly value: number; readonly previousValue?: number; readonly changeBps?: number; readonly period: DateRange; }
export type MetricName = 'revenue' | 'cogs' | 'gross_profit' | 'net_profit' | 'gross_margin' | 'net_margin' | 'inventory_value' | 'receivables' | 'payables' | 'cash_position' | 'transaction_count' | 'average_order_value';
`);
write('modules/analytics/domain/rules.ts', `
export function calculateGrossProfit(revenue: number, cogs: number): number { return revenue - cogs; }
export function calculateNetProfit(grossProfit: number, operatingExpenses: number): number { return grossProfit - operatingExpenses; }
export function calculateMarginBps(profit: number, revenue: number): number { if (revenue === 0) return 0; return Math.round((profit / revenue) * 10_000); }
export function calculateCashPosition(currentCash: number, receivables: number, payables: number): number { return currentCash + receivables - payables; }
export function calculateChangeBps(current: number, previous: number): number { if (previous === 0) return current > 0 ? 10_000 : 0; return Math.round(((current - previous) / Math.abs(previous)) * 10_000); }
`);
write('modules/analytics/application/service.ts', `
import type { TenantContext, DateRange } from '@/lib/types';
import type { FinancialSnapshot, FinancialMetric, MetricName } from '../domain/types';
export interface AnalyticsService {
  getSnapshot(ctx: TenantContext, period: DateRange): Promise<FinancialSnapshot>;
  getMetric(ctx: TenantContext, metric: MetricName, period: DateRange): Promise<FinancialMetric>;
  getDashboardMetrics(ctx: TenantContext, period: DateRange): Promise<readonly FinancialMetric[]>;
  getRevenueBreakdown(ctx: TenantContext, period: DateRange): Promise<readonly BreakdownItem[]>;
  getExpenseBreakdown(ctx: TenantContext, period: DateRange): Promise<readonly BreakdownItem[]>;
}
export interface BreakdownItem { readonly category: string; readonly amount: number; readonly percentage: number; readonly count: number; }
`);
write('modules/analytics/index.ts', `
export type { FinancialSnapshot, FinancialMetric, MetricName } from './domain/types';
export { calculateGrossProfit, calculateNetProfit, calculateMarginBps, calculateCashPosition, calculateChangeBps } from './domain/rules';
export type { AnalyticsService, BreakdownItem } from './application/service';
`);

// Profit Leaks
write('modules/profit-leaks/domain/types.ts', `
import type { BusinessId, Money } from '@/lib/types';
export interface ProfitLeak {
  readonly id: string; readonly businessId: BusinessId; readonly category: LeakCategory; readonly severity: LeakSeverity;
  readonly title: string; readonly description: string; readonly impact: Money; readonly impactPeriod: string;
  readonly evidence: readonly LeakEvidence[]; readonly status: LeakStatus; readonly detectedAt: Date; readonly resolvedAt?: Date;
}
export type LeakCategory = 'supplier_cost_increase' | 'margin_compression' | 'excessive_discounting' | 'dead_inventory' | 'high_payment_fees' | 'abnormal_expenses' | 'overdue_receivables' | 'low_margin_products';
export type LeakSeverity = 'critical' | 'high' | 'medium' | 'low';
export type LeakStatus = 'active' | 'acknowledged' | 'resolved' | 'dismissed';
export interface LeakEvidence { readonly type: EvidenceType; readonly resourceId: string; readonly description: string; readonly value?: number; }
export type EvidenceType = 'transaction' | 'expense' | 'product' | 'supplier' | 'customer' | 'invoice' | 'calculation';
`);
write('modules/profit-leaks/domain/rules.ts', `
import type { LeakSeverity } from './types';
export function classifySeverity(monthlyImpactMinorUnits: number): LeakSeverity {
  if (monthlyImpactMinorUnits >= 50_000_00) return 'critical';
  if (monthlyImpactMinorUnits >= 10_000_00) return 'high';
  if (monthlyImpactMinorUnits >= 2_000_00) return 'medium';
  return 'low';
}
export function hasMinimumEvidence(evidenceCount: number, category: string): boolean {
  const highEvidenceCategories = ['margin_compression', 'abnormal_expenses'];
  const minRequired = highEvidenceCategories.includes(category) ? 3 : 1;
  return evidenceCount >= minRequired;
}
`);
write('modules/profit-leaks/application/service.ts', `
import type { TenantContext, PaginatedResult, PaginationParams, DateRange } from '@/lib/types';
import type { ProfitLeak, LeakCategory, LeakSeverity, LeakStatus } from '../domain/types';
export interface ProfitLeakService {
  detectLeaks(ctx: TenantContext, period: DateRange): Promise<readonly ProfitLeak[]>;
  list(ctx: TenantContext, filters: LeakFilters): Promise<PaginatedResult<ProfitLeak>>;
  getById(ctx: TenantContext, leakId: string): Promise<ProfitLeak | null>;
  getTotalImpact(ctx: TenantContext): Promise<{ totalMonthly: number; leakCount: number }>;
  updateStatus(ctx: TenantContext, leakId: string, status: LeakStatus): Promise<ProfitLeak>;
}
export interface LeakFilters extends PaginationParams { readonly category?: LeakCategory; readonly severity?: LeakSeverity; readonly status?: LeakStatus; }
`);
write('modules/profit-leaks/infrastructure/repository.ts', `
import type { BusinessId, PaginatedResult } from '@/lib/types';
import type { ProfitLeak } from '../domain/types';
import type { LeakFilters } from '../application/service';
export interface ProfitLeakRepository {
  findById(businessId: BusinessId, id: string): Promise<ProfitLeak | null>;
  save(leak: ProfitLeak): Promise<ProfitLeak>;
  update(leak: ProfitLeak): Promise<ProfitLeak>;
  list(businessId: BusinessId, filters: LeakFilters): Promise<PaginatedResult<ProfitLeak>>;
  findActiveByCategory(businessId: BusinessId, category: string): Promise<readonly ProfitLeak[]>;
}
`);
write('modules/profit-leaks/index.ts', `
export type { ProfitLeak, LeakCategory, LeakSeverity, LeakStatus, LeakEvidence, EvidenceType } from './domain/types';
export { classifySeverity, hasMinimumEvidence } from './domain/rules';
export type { ProfitLeakService, LeakFilters } from './application/service';
export type { ProfitLeakRepository } from './infrastructure/repository';
`);

// Cash Flow
write('modules/cash-flow/domain/types.ts', `
import type { BusinessId, Money, DateRange } from '@/lib/types';
export interface CashFlowForecast {
  readonly id: string; readonly businessId: BusinessId; readonly period: DateRange; readonly periods: readonly CashFlowPeriod[];
  readonly startingCash: Money; readonly endingCash: Money; readonly risks: readonly CashFlowRisk[]; readonly calculatedAt: Date;
}
export interface CashFlowPeriod { readonly periodStart: Date; readonly periodEnd: Date; readonly inflows: readonly CashFlowItem[]; readonly outflows: readonly CashFlowItem[]; readonly netFlow: number; readonly runningBalance: number; }
export interface CashFlowItem { readonly category: CashFlowCategory; readonly amount: number; readonly description: string; readonly confidence: 'actual' | 'expected' | 'projected'; readonly sourceId?: string; }
export type CashFlowCategory = 'sales_revenue' | 'collections' | 'other_income' | 'supplier_payments' | 'operating_expenses' | 'salaries' | 'rent' | 'taxes' | 'loan_payments' | 'planned_purchases' | 'other_expenses';
export interface CashFlowRisk { readonly type: RiskType; readonly severity: 'critical' | 'warning' | 'info'; readonly periodStart: Date; readonly description: string; readonly projectedShortfall?: number; readonly contributingFactors: readonly string[]; }
export type RiskType = 'negative_balance' | 'low_balance' | 'high_concentration' | 'payment_spike';
`);
write('modules/cash-flow/domain/rules.ts', `
import type { CashFlowPeriod, CashFlowRisk } from './types';
export function calculateNetFlow(inflows: readonly { amount: number }[], outflows: readonly { amount: number }[]): number {
  return inflows.reduce((sum, i) => sum + i.amount, 0) - outflows.reduce((sum, o) => sum + o.amount, 0);
}
export function detectNegativeBalance(period: CashFlowPeriod): CashFlowRisk | null {
  if (period.runningBalance < 0) {
    return {
      type: 'negative_balance',
      severity: 'critical',
      periodStart: period.periodStart,
      description: \`Projected negative balance of \${Math.abs(period.runningBalance)} minor units\`,
      projectedShortfall: Math.abs(period.runningBalance),
      contributingFactors: Array.from(period.outflows).sort((a, b) => b.amount - a.amount).slice(0, 3).map((o) => o.category),
    };
  }
  return null;
}
export function calculateLowBalanceThreshold(averageMonthlyOutflow: number): number { return Math.round(averageMonthlyOutflow * 0.1); }
`);
write('modules/cash-flow/application/service.ts', `
import type { TenantContext, DateRange } from '@/lib/types';
import type { CashFlowForecast, CashFlowRisk } from '../domain/types';
export interface CashFlowService {
  forecast(ctx: TenantContext, period: DateRange): Promise<CashFlowForecast>;
  getRisks(ctx: TenantContext): Promise<readonly CashFlowRisk[]>;
  getLatestForecast(ctx: TenantContext): Promise<CashFlowForecast | null>;
}
`);
write('modules/cash-flow/index.ts', `
export type { CashFlowForecast, CashFlowPeriod, CashFlowItem, CashFlowCategory, CashFlowRisk, RiskType } from './domain/types';
export { calculateNetFlow, detectNegativeBalance, calculateLowBalanceThreshold } from './domain/rules';
export type { CashFlowService } from './application/service';
`);

// Simulator
write('modules/simulator/domain/types.ts', `
import type { BusinessId } from '@/lib/types';
export interface Scenario {
  readonly id: string; readonly businessId: BusinessId; readonly name: string; readonly description?: string;
  readonly parameters: readonly ScenarioParameter[]; readonly baseline: ScenarioSnapshot; readonly projected: ScenarioSnapshot;
  readonly comparison: ScenarioComparison; readonly status: ScenarioStatus; readonly createdAt: Date;
}
export type ScenarioStatus = 'draft' | 'calculated' | 'expired';
export interface ScenarioParameter { readonly type: ParameterType; readonly targetId?: string; readonly targetName?: string; readonly currentValue: number; readonly newValue: number; readonly unit: 'amount' | 'percentage' | 'quantity' | 'days'; }
export type ParameterType = 'price_change' | 'quantity_change' | 'discount_change' | 'cost_change' | 'expense_change' | 'payment_timing' | 'inventory_order';
export interface ScenarioSnapshot { readonly revenue: number; readonly cogs: number; readonly grossProfit: number; readonly grossMarginBps: number; readonly operatingExpenses: number; readonly netProfit: number; readonly netMarginBps: number; }
export interface ScenarioComparison { readonly revenueDelta: number; readonly profitDelta: number; readonly marginDeltaBps: number; readonly summary: string; }
`);
write('modules/simulator/domain/rules.ts', `
import type { ScenarioSnapshot, ScenarioComparison, ScenarioParameter } from './types';
export function applyPriceChange(currentRevenue: number, changeBps: number): number { return Math.round(currentRevenue * (1 + changeBps / 10_000)); }
export function applyCostChange(currentCogs: number, changeBps: number): number { return Math.round(currentCogs * (1 + changeBps / 10_000)); }
export function compareSnapshots(baseline: ScenarioSnapshot, projected: ScenarioSnapshot): ScenarioComparison {
  const profitDelta = projected.netProfit - baseline.netProfit;
  const direction = profitDelta > 0 ? 'increase' : profitDelta < 0 ? 'decrease' : 'no change';
  return { revenueDelta: projected.revenue - baseline.revenue, profitDelta, marginDeltaBps: projected.netMarginBps - baseline.netMarginBps, summary: \`Projected net profit \${direction} of \${Math.abs(profitDelta)} minor units\` };
}
export function validateParameterBounds(param: ScenarioParameter): boolean {
  if (param.unit === 'percentage') return Math.abs(param.newValue - param.currentValue) <= 10_000;
  return param.newValue >= 0;
}
`);
write('modules/simulator/application/service.ts', `
import type { TenantContext, PaginatedResult, PaginationParams } from '@/lib/types';
import type { Scenario, ScenarioParameter, ScenarioStatus } from '../domain/types';
export interface SimulatorService {
  runScenario(ctx: TenantContext, input: RunScenarioInput): Promise<Scenario>;
  getById(ctx: TenantContext, scenarioId: string): Promise<Scenario | null>;
  list(ctx: TenantContext, filters: ScenarioFilters): Promise<PaginatedResult<Scenario>>;
}
export interface RunScenarioInput { readonly name: string; readonly description?: string; readonly parameters: readonly ScenarioParameter[]; }
export interface ScenarioFilters extends PaginationParams { readonly status?: ScenarioStatus; }
`);
write('modules/simulator/index.ts', `
export type { Scenario, ScenarioStatus, ScenarioParameter, ParameterType, ScenarioSnapshot, ScenarioComparison } from './domain/types';
export { applyPriceChange, applyCostChange, compareSnapshots, validateParameterBounds } from './domain/rules';
export type { SimulatorService, RunScenarioInput, ScenarioFilters } from './application/service';
`);

// Business Brain
write('modules/business-brain/domain/types.ts', `
import type { BusinessId, UserId } from '@/lib/types';
export interface BrainQuery { readonly businessId: BusinessId; readonly userId: UserId; readonly sessionId: string; readonly message: string; readonly conversationHistory?: readonly ConversationMessage[]; }
export interface BrainResponse { readonly message: string; readonly toolsUsed: readonly ToolCallRecord[]; readonly evidence: readonly EvidenceReference[]; readonly confidence: 'high' | 'medium' | 'low'; readonly metadata: ResponseMetadata; }
export interface ToolCallRecord { readonly toolName: string; readonly input: Record<string, unknown>; readonly output: unknown; readonly latencyMs: number; }
export interface EvidenceReference { readonly type: EvidenceSourceType; readonly resourceId: string; readonly description: string; readonly value?: string; }
export type EvidenceSourceType = 'transaction' | 'invoice' | 'expense' | 'product' | 'customer' | 'supplier' | 'document' | 'calculation' | 'rag_document';
export interface ConversationMessage { readonly role: 'user' | 'assistant'; readonly content: string; readonly timestamp: Date; }
export interface ResponseMetadata { readonly totalLatencyMs: number; readonly modelUsed: string; readonly tokensUsed: number; readonly ragContextUsed: boolean; }
`);
write('modules/business-brain/application/service.ts', `
import type { TenantContext } from '@/lib/types';
import type { BrainQuery, BrainResponse } from '../domain/types';
export interface BusinessBrainService {
  query(ctx: TenantContext, query: BrainQuery): Promise<BrainResponse>;
  getSessionHistory(ctx: TenantContext, sessionId: string): Promise<{ readonly messages: readonly { readonly role: string; readonly content: string; readonly timestamp: Date }[] }>;
}
`);
write('modules/business-brain/index.ts', `
export type { BrainQuery, BrainResponse, ToolCallRecord, EvidenceReference, EvidenceSourceType, ConversationMessage, ResponseMetadata } from './domain/types';
export type { BusinessBrainService } from './application/service';
`);

// RAG
write('modules/rag/domain/types.ts', `
import type { BusinessId } from '@/lib/types';
export interface EmbeddingChunk { readonly id: string; readonly businessId: BusinessId; readonly content: string; readonly metadata: ChunkMetadata; readonly embedding?: readonly number[]; readonly createdAt: Date; }
export interface ChunkMetadata { readonly sourceId: string; readonly sourceType: 'document' | 'conversation' | 'note' | 'voice_transcript' | 'whatsapp'; readonly fileName?: string; readonly pageNumber?: number; readonly chunkIndex: number; readonly totalChunks: number; }
export interface RetrievalQuery { readonly businessId: BusinessId; readonly queryText: string; readonly topK: number; readonly sourceTypes?: readonly ChunkMetadata['sourceType'][]; readonly minScore?: number; }
export interface RetrievalResult { readonly chunks: readonly ScoredChunk[]; readonly queryEmbedding?: readonly number[]; }
export interface ScoredChunk { readonly chunk: EmbeddingChunk; readonly score: number; }
`);
write('modules/rag/application/service.ts', `
import type { TenantContext, DocumentId } from '@/lib/types';
import type { RetrievalQuery, RetrievalResult, EmbeddingChunk } from '../domain/types';
export interface RAGService {
  indexDocument(ctx: TenantContext, documentId: DocumentId, content: string): Promise<readonly EmbeddingChunk[]>;
  retrieve(ctx: TenantContext, query: RetrievalQuery): Promise<RetrievalResult>;
  removeDocument(ctx: TenantContext, documentId: DocumentId): Promise<void>;
}
`);
write('modules/rag/index.ts', `
export type { EmbeddingChunk, ChunkMetadata, RetrievalQuery, RetrievalResult, ScoredChunk } from './domain/types';
export type { RAGService } from './application/service';
`);

// Actions
write('modules/actions/domain/types.ts', `
import type { BusinessId, ActionId, UserId } from '@/lib/types';
export interface Action {
  readonly id: ActionId; readonly businessId: BusinessId; readonly type: ActionType; readonly title: string;
  readonly description: string; readonly status: ActionStatus; readonly source: ActionSource; readonly parameters: Record<string, unknown>;
  readonly result?: ActionResult; readonly createdAt: Date; readonly updatedAt: Date; readonly createdBy: UserId;
  readonly approvedBy?: UserId; readonly approvedAt?: Date; readonly executedAt?: Date;
}
export type ActionType = 'adjust_price' | 'reorder_stock' | 'send_reminder' | 'change_supplier' | 'reduce_expense' | 'create_transaction' | 'custom';
export type ActionStatus = 'proposed' | 'drafted' | 'awaiting_approval' | 'approved' | 'executing' | 'completed' | 'failed' | 'cancelled';
export type ActionSource = 'ai_recommendation' | 'profit_leak' | 'cash_flow_risk' | 'manual';
export interface ActionResult { readonly success: boolean; readonly output?: string; readonly error?: string; readonly affectedResources?: readonly { readonly type: string; readonly id: string }[]; }
export const ACTION_STATUS_TRANSITIONS: Record<ActionStatus, readonly ActionStatus[]> = {
  proposed: ['drafted', 'cancelled'], drafted: ['awaiting_approval', 'cancelled'], awaiting_approval: ['approved', 'cancelled'],
  approved: ['executing'], executing: ['completed', 'failed'], completed: [], failed: ['drafted'], cancelled: [],
};
`);
write('modules/actions/domain/rules.ts', `
import type { ActionStatus } from './types';
import { ACTION_STATUS_TRANSITIONS } from './types';
export function canTransitionActionTo(current: ActionStatus, next: ActionStatus): boolean { return ACTION_STATUS_TRANSITIONS[current].includes(next); }
export function requiresApproval(status: ActionStatus): boolean { return status === 'awaiting_approval'; }
export function canCancel(status: ActionStatus): boolean { return ['proposed', 'drafted', 'awaiting_approval'].includes(status); }
export function canRetryAction(status: ActionStatus): boolean { return status === 'failed'; }
`);
write('modules/actions/application/service.ts', `
import type { TenantContext, PaginatedResult, PaginationParams, ActionId } from '@/lib/types';
import type { Action, ActionStatus, ActionType, ActionSource } from '../domain/types';
export interface ActionService {
  propose(ctx: TenantContext, input: ProposeActionInput): Promise<Action>;
  getById(ctx: TenantContext, id: ActionId): Promise<Action | null>;
  list(ctx: TenantContext, filters: ActionFilters): Promise<PaginatedResult<Action>>;
  approve(ctx: TenantContext, id: ActionId): Promise<Action>;
  execute(ctx: TenantContext, id: ActionId): Promise<Action>;
  cancel(ctx: TenantContext, id: ActionId): Promise<Action>;
}
export interface ProposeActionInput { readonly type: ActionType; readonly title: string; readonly description: string; readonly source: ActionSource; readonly parameters: Record<string, unknown>; }
export interface ActionFilters extends PaginationParams { readonly type?: ActionType; readonly status?: ActionStatus; readonly source?: ActionSource; }
`);
write('modules/actions/infrastructure/repository.ts', `
import type { BusinessId, ActionId, PaginatedResult } from '@/lib/types';
import type { Action } from '../domain/types';
import type { ActionFilters } from '../application/service';
export interface ActionRepository {
  findById(businessId: BusinessId, id: ActionId): Promise<Action | null>;
  save(action: Action): Promise<Action>;
  update(action: Action): Promise<Action>;
  list(businessId: BusinessId, filters: ActionFilters): Promise<PaginatedResult<Action>>;
  findPendingApproval(businessId: BusinessId): Promise<readonly Action[]>;
}
`);
write('modules/actions/index.ts', `
export type { Action, ActionType, ActionStatus, ActionSource, ActionResult } from './domain/types';
export { canTransitionActionTo, requiresApproval, canCancel, canRetryAction } from './domain/rules';
export type { ActionService, ProposeActionInput, ActionFilters } from './application/service';
export type { ActionRepository } from './infrastructure/repository';
`);

// Notifications
write('modules/notifications/domain/types.ts', `
import type { BusinessId, UserId } from '@/lib/types';
export interface Notification {
  readonly id: string; readonly businessId: BusinessId; readonly userId: UserId; readonly type: NotificationType;
  readonly title: string; readonly message: string; readonly severity: NotificationSeverity; readonly status: NotificationStatus;
  readonly actionUrl?: string; readonly metadata?: Record<string, unknown>; readonly createdAt: Date; readonly readAt?: Date;
}
export type NotificationType = 'profit_leak_detected' | 'cash_flow_risk' | 'action_proposed' | 'action_completed' | 'document_processed' | 'low_stock_alert' | 'overdue_payment' | 'review_required' | 'system';
export type NotificationSeverity = 'critical' | 'warning' | 'info' | 'success';
export type NotificationStatus = 'unread' | 'read' | 'dismissed';
`);
write('modules/notifications/application/service.ts', `
import type { TenantContext, PaginatedResult, PaginationParams, UserId } from '@/lib/types';
import type { Notification, NotificationType, NotificationSeverity, NotificationStatus } from '../domain/types';
export interface NotificationService {
  send(ctx: TenantContext, input: SendNotificationInput): Promise<Notification>;
  list(ctx: TenantContext, filters: NotificationFilters): Promise<PaginatedResult<Notification>>;
  markAsRead(ctx: TenantContext, notificationId: string): Promise<void>;
  markAllAsRead(ctx: TenantContext): Promise<void>;
  getUnreadCount(ctx: TenantContext): Promise<number>;
}
export interface SendNotificationInput { readonly userId: UserId; readonly type: NotificationType; readonly title: string; readonly message: string; readonly severity: NotificationSeverity; readonly actionUrl?: string; readonly metadata?: Record<string, unknown>; }
export interface NotificationFilters extends PaginationParams { readonly type?: NotificationType; readonly status?: NotificationStatus; }
`);
write('modules/notifications/index.ts', `
export type { Notification, NotificationType, NotificationSeverity, NotificationStatus } from './domain/types';
export type { NotificationService, SendNotificationInput, NotificationFilters } from './application/service';
`);

// Audit
write('modules/audit/domain/types.ts', `
import type { BusinessId, UserId } from '@/lib/types';
export interface AuditEntry {
  readonly id: string; readonly businessId: BusinessId; readonly userId: UserId; readonly action: AuditAction;
  readonly resourceType: AuditResourceType; readonly resourceId: string; readonly before?: Record<string, unknown>;
  readonly after?: Record<string, unknown>; readonly metadata?: Record<string, unknown>; readonly ip?: string;
  readonly userAgent?: string; readonly timestamp: Date;
}
export type AuditAction = 'create' | 'update' | 'delete' | 'approve' | 'reject' | 'execute' | 'upload' | 'extract' | 'login' | 'view';
export type AuditResourceType = 'transaction' | 'expense' | 'product' | 'customer' | 'supplier' | 'document' | 'action' | 'scenario' | 'business_setting' | 'user' | 'brain_query';
`);
write('modules/audit/application/service.ts', `
import type { TenantContext, PaginatedResult, PaginationParams, DateRange, UserId } from '@/lib/types';
import type { AuditEntry, AuditAction, AuditResourceType } from '../domain/types';
export interface AuditService {
  log(ctx: TenantContext, input: LogAuditInput): Promise<AuditEntry>;
  list(ctx: TenantContext, filters: AuditFilters): Promise<PaginatedResult<AuditEntry>>;
  getByResource(ctx: TenantContext, resourceType: AuditResourceType, resourceId: string): Promise<readonly AuditEntry[]>;
}
export interface LogAuditInput { readonly action: AuditAction; readonly resourceType: AuditResourceType; readonly resourceId: string; readonly before?: Record<string, unknown>; readonly after?: Record<string, unknown>; readonly metadata?: Record<string, unknown>; }
export interface AuditFilters extends PaginationParams { readonly userId?: UserId; readonly action?: AuditAction; readonly resourceType?: AuditResourceType; readonly dateRange?: DateRange; }
`);
write('modules/audit/index.ts', `
export type { AuditEntry, AuditAction, AuditResourceType } from './domain/types';
export type { AuditService, LogAuditInput, AuditFilters } from './application/service';
`);

// ==========================================
// 3. Module Registry (lib/registry.ts)
// ==========================================
write('lib/registry.ts', `
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
  if (frozen) throw new Error(\`Registry is frozen. Cannot register "\${name}" after init.\`);
  registry[name] = service;
}

export function getModule<K extends ModuleName>(name: K): ModuleRegistry[K] {
  const service = registry[name];
  if (!service) throw new Error(\`Module "\${name}" is not registered.\`);
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
`);

// ==========================================
// 4. Database Layer
// ==========================================
write('database/schema.ts', `
export const DATABASE_TABLES = {
  businesses: 'businesses',
  businessMembers: 'business_members',
  users: 'users',
  transactions: 'transactions',
  transactionItems: 'transaction_items',
  expenses: 'expenses',
  products: 'products',
  inventoryMovements: 'inventory_movements',
  customers: 'customers',
  receivables: 'receivables',
  suppliers: 'suppliers',
  payables: 'payables',
  supplierPricing: 'supplier_pricing',
  documents: 'documents',
  ingestionJobs: 'ingestion_jobs',
  extractions: 'document_extractions',
  profitLeaks: 'profit_leaks',
  cashFlowForecasts: 'cash_flow_forecasts',
  scenarios: 'scenarios',
  actions: 'actions',
  actionLogs: 'action_logs',
  embeddings: 'document_embeddings',
  chatSessions: 'chat_sessions',
  chatMessages: 'chat_messages',
  notifications: 'notifications',
  auditLogs: 'audit_logs',
} as const;

export type TableName = (typeof DATABASE_TABLES)[keyof typeof DATABASE_TABLES];
`);

write('database/index.ts', `
export * from './schema';
export type { DatabaseClient, TenantDatabaseClient, DatabaseTransaction } from '@/lib/database';
`);

// ==========================================
// 5. Tests
// ==========================================
write('tests/architecture.test.ts', `
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
`);

console.log('Modular monolith architecture successfully scaffolded.');
