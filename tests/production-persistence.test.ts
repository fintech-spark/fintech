import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from '@/lib/database';
import type { Db } from '@/lib/database/query-helpers';
import { AuthenticationError, ConflictError, DatabaseError } from '@/lib/errors';
import { asUserId } from '@/lib/types';
import { PostgrestBusinessRepository } from '@/modules/businesses/infrastructure/business-repository';

const from = vi.fn(() => { throw new Error('Provisioning must not write through PostgREST'); });
const postgrest = { from } as unknown as Db;
const localUrl = process.env.LOCAL_DATABASE_URL;

describe('business provisioning failure propagation', () => {
  it('rejects a failed transaction instead of returning a fabricated business', async () => {
    const failure = new DatabaseError('Database unavailable.');
    const repository = new PostgrestBusinessRepository(postgrest, {
      transaction: async () => { throw failure; },
    });
    await expect(repository.create(asUserId(randomUUID()), { name: 'Synthetic', type: 'retail' }))
      .rejects.toBe(failure);
    expect(from).not.toHaveBeenCalled();
  });
});

// Default unit runs have no database. The explicit production/security run sets
// LOCAL_DATABASE_URL; every live test below then executes, with no skipped cases.
describe.skipIf(!localUrl)('atomic business provisioning against raw PostgreSQL', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let userId: ReturnType<typeof asUserId>;
  let email: string;
  const createdBusinessIds: string[] = [];

  beforeEach(async () => {
    const url = new URL(localUrl!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        (!url.pathname.startsWith('/data_production_') && process.env.CI !== 'true')) {
      throw new Error('Use a disposable loopback data_production_* database for provisioning tests.');
    }
    db = createDatabaseClient({ connectionString: localUrl });
    userId = asUserId(randomUUID());
    email = `${userId}@example.invalid`;
    await db.execute('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [userId, email]);
  });

  afterEach(async () => {
    if (!db) return;
    await db.transaction(async (tx) => {
      await tx.execute('DELETE FROM public.business_members WHERE user_id = $1', [userId]);
      await tx.execute('DELETE FROM public.businesses WHERE id = ANY($1::uuid[])', [createdBusinessIds]);
      await tx.execute('DELETE FROM public.users WHERE id = $1', [userId]);
      await tx.execute('DELETE FROM auth.users WHERE id = $1', [userId]);
    });
    createdBusinessIds.length = 0;
    await db.close();
  });

  const repository = (database: Pick<DatabaseClient, 'transaction'> = db) =>
    new PostgrestBusinessRepository(postgrest, database);

  async function expectNoPartialProvisioning() {
    expect(await db.query('SELECT id FROM public.users WHERE id = $1', [userId])).toHaveLength(0);
    expect(await db.query('SELECT id FROM public.business_members WHERE user_id = $1', [userId]))
      .toHaveLength(0);
    expect(await db.query('SELECT id FROM public.businesses WHERE name = $1', [userId]))
      .toHaveLength(0);
  }

  // Inject a real invalid/duplicate write on the SAME transaction connection.
  // This exercises driver failure, rollback, and the repository's propagation.
  function failingMembership(mode: 'duplicate' | 'invalid' | 'zero'): Pick<DatabaseClient, 'transaction'> {
    return {
      transaction: (fn) => db.transaction((tx) => fn({
        id: tx.id,
        query: <T>(sql: string, params?: readonly unknown[]) => tx.query<T>(sql, params),
        execute: async (sql, params) => {
          if (sql.startsWith('INSERT INTO public.business_members')) {
            if (mode === 'zero') return 0;
            if (mode === 'duplicate') await tx.execute(sql, params);
            if (mode === 'invalid') sql = sql.replace("'owner'", "'invalid-role'");
          }
          return tx.execute(sql, params);
        },
        commit: () => tx.commit(),
        rollback: () => tx.rollback(),
      } satisfies DatabaseTransaction)),
    };
  }

  it('commits the real business, verified user profile and exactly one active owner together', async () => {
    const result = await repository().create(userId, {
      name: userId, type: 'retail', settings: { currency: 'USD', fiscalYearStart: 4 },
    });
    createdBusinessIds.push(result.id);
    const [stored] = await db.query<{ name: string; currency: string }>(
      'SELECT name, currency FROM public.businesses WHERE id = $1', [result.id],
    );
    expect(stored).toEqual({ name: result.name, currency: 'USD' });
    expect(await db.query(
      'SELECT role, status FROM public.business_members WHERE business_id = $1 AND user_id = $2',
      [result.id, userId],
    )).toEqual([{ role: 'owner', status: 'active' }]);
    expect(await db.query('SELECT email FROM public.users WHERE id = $1', [userId]))
      .toEqual([{ email }]);
  });

  it.each(['duplicate', 'invalid', 'zero'] as const)('rolls everything back on %s membership', async (mode) => {
    await expect(repository(failingMembership(mode)).create(userId, { name: userId, type: 'retail' }))
      .rejects.toBeInstanceOf(mode === 'duplicate' ? ConflictError : DatabaseError);
    await expectNoPartialProvisioning();
  });

  it('rolls back the user profile if the business violates schema constraints', async () => {
    await expect(repository().create(userId, {
      name: userId, type: 'retail', settings: { fiscalYearStart: 13 },
    })).rejects.toBeInstanceOf(DatabaseError);
    await expectNoPartialProvisioning();
  });

  it('rejects an unknown auth subject rather than inventing a merchant.local user', async () => {
    const unknown = asUserId(randomUUID());
    await expect(repository().create(unknown, { name: unknown, type: 'retail' }))
      .rejects.toBeInstanceOf(AuthenticationError);
    expect(await db.query('SELECT id FROM public.users WHERE id = $1', [unknown])).toHaveLength(0);
    expect(await db.query('SELECT id FROM public.businesses WHERE name = $1', [unknown])).toHaveLength(0);
  });

  it('rejects a soft-deleted auth subject', async () => {
    await db.execute('UPDATE auth.users SET deleted_at = now() WHERE id = $1', [userId]);
    await expect(repository().create(userId, { name: userId, type: 'retail' }))
      .rejects.toBeInstanceOf(AuthenticationError);
    await expectNoPartialProvisioning();
  });
});
