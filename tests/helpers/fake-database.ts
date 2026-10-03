// Merchant Brain: test doubles for the database layer
//
// `modules/**` had no database access before Phase 7, so there was no
// established pattern to copy. These fakes are SQL-text aware rather than
// emulating Postgres: the thing worth testing about a repository is WHICH
// statement it issued and WHICH values it bound — not whether Postgres parses
// it correctly.
//
// `sql` and `params` are recorded on every call so a test can assert that the
// tenant predicate is present and that `$1` is the authenticated tenant. That is
// the property that actually matters here, because the runtime connection
// authenticates as a BYPASSRLS role and RLS cannot be relied on.

import { vi } from 'vitest';
import type { BusinessId } from '@/lib/types';
import type { DatabaseClient, DatabaseTransaction } from '@/lib/database/client';

export interface RecordedQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export interface FakeHandler {
  /** Matched as a substring of the statement text. */
  readonly match: string;
  readonly rows?: readonly Record<string, unknown>[];
  readonly rowCount?: number;
  readonly error?: Error;
}

export interface FakeDatabase extends DatabaseClient {
  readonly calls: RecordedQuery[];
  /** Every statement issued, joined, for coarse assertions. */
  readonly allSql: string;
  callsMatching(fragment: string): RecordedQuery[];
  /** The single call whose SQL contains `fragment`. Throws if not exactly one. */
  onlyCallMatching(fragment: string): RecordedQuery;
}

/**
 * Statements that configure a session rather than fetch data.
 *
 * They are answered with no rows automatically so a test does not have to
 * register a handler for `BEGIN` or `SET LOCAL hnsw.ef_search`. They are still
 * recorded, so `onlyCallMatching('SET LOCAL')` works.
 */
const SESSION_CONTROL = ['BEGIN', 'COMMIT', 'ROLLBACK', 'SET LOCAL', 'SET SESSION'];

/**
 * Builds a `DatabaseClient` that answers from a handler list.
 *
 * Handlers are matched in registration order. An unmatched data statement
 * throws, because a repository silently returning `[]` for an unexpected query is
 * how a tenant-isolation bug hides.
 */
export function createFakeDatabase(handlers: readonly FakeHandler[] = []): FakeDatabase {
  const calls: RecordedQuery[] = [];

  const run = <T>(sql: string, params: readonly unknown[]): readonly T[] => {
    calls.push({ sql, params });
    if (SESSION_CONTROL.some((prefix) => sql.trimStart().startsWith(prefix))) return [];
    const handler = handlers.find((candidate) => sql.includes(candidate.match));
    if (!handler) {
      throw new Error(`fake database: no handler for statement:\n${sql}`);
    }
    if (handler.error) throw handler.error;
    return (handler.rows ?? []) as readonly T[];
  };

  const transaction = {
    id: 'tx-test',
    query: async <T>(sql: string, params?: readonly unknown[]) =>
      run<T>(sql, params ?? []),
    execute: async (sql: string, params?: readonly unknown[]) => {
      run(sql, params ?? []);
      return findCount(sql);
    },
    commit: async () => undefined,
    rollback: async () => undefined,
  } satisfies DatabaseTransaction;

  const client: DatabaseClient = {
    query: async <T>(sql: string, params?: readonly unknown[]) => run<T>(sql, params ?? []),
    execute: async (sql: string, params?: readonly unknown[]) => {
      run(sql, params ?? []);
      return findCount(sql);
    },
    transaction: async <T>(fn: (tx: DatabaseTransaction) => Promise<T>) => fn(transaction),
    // Mirrors the real client: a tenant view is the same pool with the business
    // id attached. It is a naming convention, NOT an injected filter, which is
    // exactly why `modules/business-brain` has its own predicate guard.
    forTenant: (businessId: BusinessId) => ({
      businessId,
      query: client.query,
      execute: client.execute,
      transaction: client.transaction,
    }),
  };

  const fake = client as FakeDatabase;
  Object.defineProperty(fake, 'calls', { get: () => calls });
  Object.defineProperty(fake, 'allSql', {
    get: () => calls.map((call) => call.sql).join('\n'),
  });
  fake.callsMatching = (fragment: string) =>
    calls.filter((call) => call.sql.includes(fragment));
  fake.onlyCallMatching = (fragment: string) => {
    const matched = fake.callsMatching(fragment);
    if (matched.length !== 1) {
      throw new Error(
        `expected exactly one statement containing "${fragment}", found ${matched.length}`,
      );
    }
    return matched[0];
  };

  function findCount(sql: string): number {
    return handlers.find((candidate) => sql.includes(candidate.match))?.rowCount ?? 1;
  }

  return fake;
}

export function createThrowingDatabase(error: Error): FakeDatabase {
  return createFakeDatabase([{ match: '', error }]);
}

// ---------------------------------------------------------------------------
// Tenant fixtures
// ---------------------------------------------------------------------------

export const BUSINESS_A = 'aaaaaaaa-0000-4000-8000-00000000000a' as BusinessId;
export const BUSINESS_B = 'bbbbbbbb-0000-4000-8000-00000000000b' as BusinessId;

export function tenantFor(
  businessId: BusinessId,
  overrides: { readonly role?: 'owner' | 'admin' | 'manager' | 'accountant' | 'staff' } = {},
) {
  return {
    businessId,
    userId: 'cccccccc-0000-4000-8000-00000000000c' as never,
    role: overrides.role ?? 'owner',
    correlationId: 'corr-test-1',
  };
}

/** A `vi.fn` authorizer that allows the listed tools and denies the rest. */
export function allowAllAuthorizer() {
  return vi.fn(async () => undefined);
}

/** An authorizer that denies a fixed set of tool names. */
export function denyingAuthorizer(denied: readonly string[]) {
  return vi.fn(async (_tenant: unknown, tool: { name: string }) => {
    if (denied.includes(tool.name)) {
      const { AuthorizationError } = await import('@/lib/errors');
      throw new AuthorizationError(`denied: ${tool.name}`);
    }
  });
}
