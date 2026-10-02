// Merchant Brain: Concrete PostgreSQL Database Client
//
// Implements the DatabaseClient, TenantDatabaseClient, and DatabaseTransaction
// interfaces defined in lib/database/client.ts using the node-postgres (pg) driver.
//
// Key design decisions:
//   - Connection pooling via pg.Pool (configurable via DATABASE_URL or PoolConfig)
//   - int8 (bigint) and numeric parsed as JavaScript numbers (safe for minor-unit money)
//   - Tenant scoping is explicit: TenantDatabaseClient stores businessId for
//     repositories to use in WHERE clauses — no implicit row filtering
//   - Transactions use BEGIN/COMMIT/ROLLBACK with automatic rollback on error
//   - All pg errors are wrapped in DatabaseError for consistent error handling

import pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { PoolConfig, QueryResult, QueryResultRow } from 'pg';
import type { BusinessId } from '../types';
import type { DatabaseClient, TenantDatabaseClient, DatabaseTransaction } from './client';
import { wrapDatabaseError } from '../errors';

// ---------------------------------------------------------------------------
// Type parser configuration
//
// PostgreSQL bigint (int8) and numeric are returned as strings by default
// because JavaScript numbers cannot represent the full range. Merchant Brain
// stores money as minor-unit bigint and quantities as numeric(20,3), both
// well within Number.MAX_SAFE_INTEGER. We parse them as numbers for ergonomic
// TypeScript usage.
// ---------------------------------------------------------------------------
pg.types.setTypeParser(20, (val: string) => Number(val)); // int8 → number
pg.types.setTypeParser(1700, (val: string) => Number(val)); // numeric → number
pg.types.setTypeParser(700, (val: string) => Number(val)); // float4 → number
pg.types.setTypeParser(701, (val: string) => Number(val)); // float8 → number

// ---------------------------------------------------------------------------
// PostgresTransaction — scoped to a single connection within a transaction
// ---------------------------------------------------------------------------

class PostgresTransaction implements DatabaseTransaction {
  readonly id: string;
  private client: pg.PoolClient;
  private committed = false;
  private rolledBack = false;

  constructor(id: string, client: pg.PoolClient) {
    this.id = id;
    this.client = client;
  }

  async query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<readonly T[]> {
    const result = await this.client.query<QueryResultRow>(sql, params ? [...params] : undefined);
    return result.rows as unknown as readonly T[];
  }

  async execute(sql: string, params?: readonly unknown[]): Promise<number> {
    const result = await this.client.query(sql, params ? [...params] : undefined);
    return result.rowCount ?? 0;
  }

  async commit(): Promise<void> {
    if (this.committed || this.rolledBack) return;
    await this.client.query('COMMIT');
    this.committed = true;
  }

  async rollback(): Promise<void> {
    if (this.committed || this.rolledBack) return;
    await this.client.query('ROLLBACK');
    this.rolledBack = true;
  }

  get isActive(): boolean {
    return !this.committed && !this.rolledBack;
  }
}

// ---------------------------------------------------------------------------
// PostgresDatabaseClient — root client with pool and tenant factory
// ---------------------------------------------------------------------------

export class PostgresDatabaseClient implements DatabaseClient {
  private pool: pg.Pool;

  constructor(config?: PoolConfig) {
    this.pool = new pg.Pool(config ?? {
      connectionString: process.env.DATABASE_URL,
    });
  }

  async query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<readonly T[]> {
    try {
      const result = await this.pool.query<QueryResultRow>(sql, params ? [...params] : undefined);
      return result.rows as unknown as readonly T[];
    } catch (error) {
      throw wrapDatabaseError(error);
    }
  }

  async execute(sql: string, params?: readonly unknown[]): Promise<number> {
    try {
      const result = await this.pool.query(sql, params ? [...params] : undefined);
      return result.rowCount ?? 0;
    } catch (error) {
      throw wrapDatabaseError(error);
    }
  }

  async transaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const txId = randomUUID();
    const tx = new PostgresTransaction(txId, client);

    try {
      await client.query('BEGIN');
      const result = await fn(tx);
      await tx.commit();
      return result;
    } catch (error) {
      if (tx.isActive) {
        try {
          await tx.rollback();
        } catch {
          // Best-effort rollback; original error takes precedence
        }
      }
      throw wrapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  forTenant(businessId: BusinessId): TenantDatabaseClient {
    return new PostgresTenantDatabaseClient(this.pool, businessId);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ---------------------------------------------------------------------------
// PostgresTenantDatabaseClient — tenant-scoped view of the database
//
// Stores the businessId so repositories can include it in WHERE clauses.
// Does NOT automatically inject tenant filters — that is the repository's
// responsibility (consistent with the existing interface design where
// repository methods accept businessId as an explicit parameter).
// ---------------------------------------------------------------------------

class PostgresTenantDatabaseClient implements TenantDatabaseClient {
  readonly businessId: BusinessId;
  private pool: pg.Pool;

  constructor(pool: pg.Pool, businessId: BusinessId) {
    this.pool = pool;
    this.businessId = businessId;
  }

  async query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<readonly T[]> {
    try {
      const result = await this.pool.query<QueryResultRow>(sql, params ? [...params] : undefined);
      return result.rows as unknown as readonly T[];
    } catch (error) {
      throw wrapDatabaseError(error);
    }
  }

  async execute(sql: string, params?: readonly unknown[]): Promise<number> {
    try {
      const result = await this.pool.query(sql, params ? [...params] : undefined);
      return result.rowCount ?? 0;
    } catch (error) {
      throw wrapDatabaseError(error);
    }
  }

  async transaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const txId = randomUUID();
    const tx = new PostgresTransaction(txId, client);

    try {
      await client.query('BEGIN');
      const result = await fn(tx);
      await tx.commit();
      return result;
    } catch (error) {
      if (tx.isActive) {
        try {
          await tx.rollback();
        } catch {
          // Best-effort rollback
        }
      }
      throw wrapDatabaseError(error);
    } finally {
      client.release();
    }
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

let clientInstance: PostgresDatabaseClient | null = null;

export function createDatabaseClient(config?: PoolConfig): PostgresDatabaseClient {
  return new PostgresDatabaseClient(config);
}

export function getDatabaseClient(): PostgresDatabaseClient {
  if (!clientInstance) {
    clientInstance = createDatabaseClient();
  }
  return clientInstance;
}

export function resetDatabaseClient(): void {
  clientInstance = null;
}

export type { QueryResult };
