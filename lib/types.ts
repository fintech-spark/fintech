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
    throw new TypeError(`Money amount must be an integer (minor units), got: ${amount}`);
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
