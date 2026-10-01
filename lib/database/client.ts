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
