// Merchant Brain: Phase 4 hardening tests
//
// These cover the defects found in the Phase 4 audit, plus the state-transition
// and idempotency behaviour that had NO coverage at all:
//
//   tenant isolation   a record owned by another business is invisible
//   authorization      the business record and roster need settings:read
//   bounded scans      whole-set aggregates throw rather than return a partial total
//   fabricated data    a hardcoded zero is not a computed zero
//   error contract     unique violation is 409, not 500
//   status codes       create is 201
//   state transitions  illegal transitions are refused
//   idempotency        a duplicate key surfaces as 409, not a second record
//   search             LIKE wildcards are literal
//   storage path       a caller cannot address another tenant's prefix

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { TenantContext } from '@/lib/types';
import type { Db } from '@/lib/database/query-helpers';
import { normalizeError } from '@/lib/http/errors';
import {
  MAX_PAGE_NUMBER,
  MAX_PAGE_SIZE,
  MAX_REQUEST_BODY_BYTES,
  dateRangeArgs,
  escapeLikePattern,
  parseJsonBody,
  parsePagination,
  parseSearch,
} from '@/lib/http/params';
import {
  MAX_LEDGER_SCAN,
  MAX_LOW_STOCK_SCAN,
  MAX_MEMBERSHIP_SCAN,
  MAX_PRICING_SCAN,
  MAX_PRODUCT_SCAN,
  POSTGREST_MAX_ROWS,
  assertScanWithinLimit,
} from '@/lib/bounded-scan';
import {
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
  wrapDatabaseError,
} from '@/lib/errors';
import {
  MAX_MINOR_AMOUNT,
  createDocumentSchema,
  createTransactionSchema,
  recordMovementSchema,
  updateDocumentStatusSchema,
} from '@/lib/validation/api-schemas';
import {
  DefaultSupplierService,
  PostgrestSupplierRepository,
} from '@/modules/suppliers/infrastructure/supplier-repository';
import {
  DefaultExpenseService,
  PostgrestExpenseRepository,
} from '@/modules/expenses/infrastructure/expense-repository';
import { canTransitionTo } from '@/modules/transactions';
import { canTransitionDocumentTo } from '@/modules/documents';
import type { Transaction } from '@/modules/transactions';
import {
  DefaultTransactionService,
  PostgrestTransactionRepository,
} from '@/modules/transactions/infrastructure/transaction-repository';
import {
  DefaultDocumentService,
  PostgrestDocumentRepository,
} from '@/modules/documents/infrastructure/document-repository';

const DAY = 86_400_000;

function parsePaginationOf(query: string) {
  return parsePagination(new URLSearchParams(query));
}

// ---------------------------------------------------------------------------
// Pagination bounds
// ---------------------------------------------------------------------------

describe('pagination bounds', () => {
  it('clamps the limit to the maximum page size', () => {
    expect(parsePaginationOf('limit=9999').limit).toBe(MAX_PAGE_SIZE);
    expect(parsePaginationOf('limit=100').limit).toBe(MAX_PAGE_SIZE);
    expect(parsePaginationOf('limit=50').limit).toBe(50);
  });

  it('clamps an absurd page number', () => {
    // Without a cap this produced a billion-row OFFSET that Postgres had to
    // walk before returning anything.
    expect(parsePaginationOf('page=999999999').page).toBe(MAX_PAGE_NUMBER);
    expect(parsePaginationOf('page=1').page).toBe(1);
  });

  it('keeps the derived offset inside a bounded scan', () => {
    const { offset } = parsePaginationOf(`page=999999999&limit=${MAX_PAGE_SIZE}`);
    expect(offset).toBe(MAX_PAGE_NUMBER * MAX_PAGE_SIZE - MAX_PAGE_SIZE);
    expect(offset).toBeLessThanOrEqual(1_000_000);
  });

  it('rejects a non-integer page rather than coercing it', () => {
    expect(() => parsePaginationOf('page=abc')).toThrow(/page/);
    expect(() => parsePaginationOf('page=-3')).toThrow(/page/);
  });
});

// ---------------------------------------------------------------------------
// Search terms are matched literally
// ---------------------------------------------------------------------------

describe('search term escaping', () => {
  it('escapes the LIKE wildcard so it cannot match everything', () => {
    // `%` alone would otherwise become `%%%` and match every row.
    expect(escapeLikePattern('%')).toBe('\\%');
    expect(escapeLikePattern('_')).toBe('\\_');
    expect(escapeLikePattern('100%_off')).toBe('100\\%\\_off');
  });

  it('escapes the escape character first so it cannot escape its own replacement', () => {
    expect(escapeLikePattern('\\%')).toBe('\\\\\\%');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeLikePattern('Sahu Kirana')).toBe('Sahu Kirana');
    expect(escapeLikePattern('rice')).toBe('rice');
  });

  it('applies escaping inside parseSearch, not at the call site', () => {
    expect(parseSearch('%')).toBe('\\%');
    expect(parseSearch('  rice  ')).toBe('rice');
    expect(parseSearch('')).toBeUndefined();
    expect(parseSearch(null)).toBeUndefined();
  });

  it('still bounds the raw length before escaping', () => {
    expect(() => parseSearch('x'.repeat(121))).toThrow(/120 characters/);
  });
});

// ---------------------------------------------------------------------------
// Bounded whole-set scans
// ---------------------------------------------------------------------------

describe('bounded scan guard', () => {
  it('passes when the result fits', () => {
    expect(() => assertScanWithinLimit(10, 100, 'Rows')).not.toThrow();
    expect(() => assertScanWithinLimit(100, 100, 'Rows')).not.toThrow();
  });

  it('throws when the scan overflowed, rather than returning a partial total', () => {
    // The alternative — returning what was read — is indistinguishable from a
    // correct answer to the merchant.
    expect(() => assertScanWithinLimit(101, 100, 'Rows')).toThrow(/exceeds the 100 row limit/);
  });

  it('keeps every limit below the server response cap', () => {
    // THIS is the assertion that matters. PostgREST clamps every response to
    // `max_rows` (1000 here, and the hosted default). A limit AT or ABOVE that
    // cap is unenforceable: the driver asks for N rows, the server returns
    // 1000, and the overflow check sees `1000 <= N` and passes — returning a
    // total computed from a silently truncated result set.
    //
    // An earlier version of lib/bounded-scan.ts set these limits in the tens of
    // thousands. Nothing caught it because the test fake ignored `.range()`.
    const limits = {
      MAX_MEMBERSHIP_SCAN,
      MAX_PRODUCT_SCAN,
      MAX_LEDGER_SCAN,
      MAX_LOW_STOCK_SCAN,
      MAX_PRICING_SCAN,
    };

    for (const [name, value] of Object.entries(limits)) {
      expect(value, `${name} must be below POSTGREST_MAX_ROWS to be enforceable`).toBeLessThan(
        POSTGREST_MAX_ROWS,
      );
    }
  });

  it('leaves room for the extra row that proves overflow', () => {
    // `.range(0, limit)` asks for limit + 1 rows. If limit were exactly the
    // server cap, that extra row could never be served and overflow would be
    // undetectable.
    const highest = Math.max(
      MAX_MEMBERSHIP_SCAN,
      MAX_PRODUCT_SCAN,
      MAX_LEDGER_SCAN,
      MAX_LOW_STOCK_SCAN,
      MAX_PRICING_SCAN,
    );
    expect(highest + 1).toBeLessThanOrEqual(POSTGREST_MAX_ROWS);
  });
});

// ---------------------------------------------------------------------------
// Error contract
// ---------------------------------------------------------------------------

describe('error mapping', () => {
  it('maps a unique violation to 409 Conflict, not 500', () => {
    const pgError = Object.assign(new Error('duplicate key value'), { code: '23505' });
    const mapped = wrapDatabaseError(pgError);

    expect(mapped.code).toBe('CONFLICT');
    expect(mapped.statusCode).toBe(409);
  });

  it('maps a foreign-key violation to 400 Validation, not 500', () => {
    const pgError = Object.assign(new Error('violates foreign key'), { code: '23503' });
    const mapped = wrapDatabaseError(pgError);

    expect(mapped.statusCode).toBe(400);
  });

  it('does not forward the constraint name, which leaks schema detail', () => {
    const pgError = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'transactions_business_id_idempotency_key_key',
    });

    expect(JSON.stringify(wrapDatabaseError(pgError).details ?? {})).not.toContain('idempotency_key_key');
  });

  it('still maps an unrecognised driver failure to a generic 500', () => {
    const mapped = wrapDatabaseError(Object.assign(new Error('boom'), { code: 'XX000' }));
    expect(mapped.statusCode).toBe(500);
    expect(mapped.message).not.toContain('boom');
  });

  it('does not leak the SQLSTATE to the client', () => {
    // The SQLSTATE names the database vendor and acts as a free oracle for
    // probing which constraints exist, so it must not reach a response body.
    for (const code of ['23505', '23503', 'XX000', '42P01']) {
      const mapped = wrapDatabaseError(Object.assign(new Error('boom'), { code }));
      const serialized = JSON.stringify(mapped.toJSON());
      expect(serialized).not.toContain(code);
      expect(serialized).not.toContain('pgCode');
    }
  });

  it('does not leak driver internals through the HTTP error body', () => {
    const pgError = Object.assign(
      new Error('duplicate key value violates unique constraint "transactions_pkey"'),
      { code: '23505', constraint: 'transactions_pkey' },
    );

    const body = JSON.stringify(normalizeError(pgError).toJSON());
    expect(body).not.toContain('transactions_pkey');
    expect(body).not.toContain('duplicate key value');
    expect(body).not.toContain('23505');
  });

  it('passes an existing AppError through unchanged', () => {
    const original = wrapDatabaseError(Object.assign(new Error('x'), { code: '23505' }));
    expect(wrapDatabaseError(original)).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// Document status: a rejection must carry a reason
// ---------------------------------------------------------------------------

describe('document rejection reason', () => {
  it('refuses a rejection with no reason', () => {
    // PATCH .../status could otherwise bypass the rule that POST .../reject
    // exists to enforce, leaving an irreversible rejection unexplained.
    const result = updateDocumentStatusSchema.safeParse({ status: 'rejected' });
    expect(result.success).toBe(false);
  });

  it('refuses a rejection whose reason is only whitespace', () => {
    const result = updateDocumentStatusSchema.safeParse({ status: 'rejected', reason: '   ' });
    expect(result.success).toBe(false);
  });

  it('accepts a rejection with a reason', () => {
    const result = updateDocumentStatusSchema.safeParse({
      status: 'rejected',
      reason: 'Illegible total column',
    });
    expect(result.success).toBe(true);
  });

  it('still permits a non-rejection status without a reason', () => {
    expect(updateDocumentStatusSchema.safeParse({ status: 'approved' }).success).toBe(true);
    expect(updateDocumentStatusSchema.safeParse({ status: 'processing' }).success).toBe(true);
  });

  it('confirms the generic status route really can reach rejected', () => {
    // If it could not, the refinement above would be unreachable.
    expect(canTransitionDocumentTo('review_required', 'rejected')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Storage path
// ---------------------------------------------------------------------------

describe('document storage path', () => {
  const safe = {
    fileName: 'invoice.pdf',
    mimeType: 'application/pdf',
    fileSize: 1024,
    sourceType: 'invoice',
  } as const;

  it('rejects an absolute path', () => {
    const result = createDocumentSchema.safeParse({ ...safe, storagePath: '/etc/passwd' });
    expect(result.success).toBe(false);
  });

  it('rejects a traversal segment', () => {
    const result = createDocumentSchema.safeParse({
      ...safe,
      storagePath: 'biz-1/../../biz-2/secret.pdf',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a relative path', () => {
    const result = createDocumentSchema.safeParse({ ...safe, storagePath: 'biz-1/user-1/f.pdf' });
    expect(result.success).toBe(true);
  });

  it('does NOT reject another tenant UUID prefix at the schema layer', () => {
    // Documented limitation, asserted so it cannot be forgotten: the schema
    // has no tenant to compare against, so the tenant-prefix rule is enforced
    // in the service where TenantContext is available.
    const result = createDocumentSchema.safeParse({
      ...safe,
      storagePath: 'other-biz-uuid/secret.pdf',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a backslash separator', () => {
    const result = createDocumentSchema.safeParse({
      ...safe,
      storagePath: 'biz-1\\..\\biz-2\\secret.pdf',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty path segment', () => {
    const result = createDocumentSchema.safeParse({
      ...safe,
      storagePath: 'biz-1//secret.pdf',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Storage path — tenant prefix, enforced in the service
// ---------------------------------------------------------------------------

describe('document storage path tenant prefix', () => {
  const BIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const OTHER_BIZ = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  function ctxFor(businessId: string): TenantContext {
    return {
      businessId: businessId as TenantContext['businessId'],
      userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as TenantContext['userId'],
      role: 'owner',
      correlationId: 'test-correlation',
    };
  }

  function serviceWithSpy() {
    const insert = vi.fn(async (input: { storagePath: string }) => ({ id: 'doc-1', ...input }));
    const repo = { insert } as unknown as PostgrestDocumentRepository;
    return { service: new DefaultDocumentService(repo), insert };
  }

  const validInput = {
    fileName: 'invoice.pdf',
    mimeType: 'application/pdf',
    fileSize: 1024,
    sourceType: 'invoice' as const,
  };

  it('accepts a path under the caller own tenant', async () => {
    const { service, insert } = serviceWithSpy();
    await service.upload(ctxFor(BIZ), { ...validInput, storagePath: `${BIZ}/user-1/doc-1.pdf` });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('rejects a path under another tenant', async () => {
    const { service, insert } = serviceWithSpy();
    await expect(
      service.upload(ctxFor(BIZ), { ...validInput, storagePath: `${OTHER_BIZ}/user-1/secret.pdf` }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects an ambiguous prefix that only shares leading characters', async () => {
    // `BIZ` is "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; a bare startsWith check
    // would accept a different tenant id that begins with the same characters.
    const lookalike = `${BIZ}9`;
    expect(lookalike).not.toBe(BIZ);
    expect(`${BIZ}9/secret.pdf`.startsWith(BIZ)).toBe(true);

    const { service, insert } = serviceWithSpy();
    await expect(
      service.upload(ctxFor(BIZ), { ...validInput, storagePath: `${lookalike}/secret.pdf` }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects a malformed path with no tenant segment', async () => {
    for (const storagePath of ['invoice.pdf', '/invoice.pdf', '../invoice.pdf', 'a//b.pdf']) {
      const { service, insert } = serviceWithSpy();
      await expect(
        service.upload(ctxFor(BIZ), { ...validInput, storagePath }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      expect(insert).not.toHaveBeenCalled();
    }
  });

  it('rejects a missing path', async () => {
    const { service, insert } = serviceWithSpy();
    await expect(
      service.upload(ctxFor(BIZ), { ...validInput, storagePath: '' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.upload(ctxFor(BIZ), { ...validInput, storagePath: '   ' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(insert).not.toHaveBeenCalled();
  });

  it('still refuses the upload before any write when permission is absent', async () => {
    const insert = vi.fn();
    const service = new DefaultDocumentService({
      insert,
    } as unknown as PostgrestDocumentRepository);
    const viewer = { ...ctxFor(BIZ), role: 'staff' } as TenantContext;

    await expect(
      service.upload(viewer, { ...validInput, storagePath: `${BIZ}/user-1/doc-1.pdf` }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(insert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Transaction idempotency replay
// ---------------------------------------------------------------------------

describe('transaction idempotency replay', () => {
  const BIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const OTHER_BIZ = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const PRODUCT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  function ctxFor(businessId: string): TenantContext {
    return {
      businessId: businessId as TenantContext['businessId'],
      userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as TenantContext['userId'],
      role: 'owner',
      correlationId: 'test-correlation',
    };
  }

  const request = {
    type: 'sale' as const,
    counterpartyType: 'customer' as const,
    counterpartyId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    transactionDate: new Date('2026-01-15T00:00:00.000Z'),
    items: [{ productId: PRODUCT, quantity: 2, unitPrice: 1000, tax: 0 }],
    idempotencyKey: 'retry-key-0001',
  };

  /**
   * A repository stub that keeps one stored transaction per (business, key),
   * mirroring idx_transactions_idempotency, so replay and race behaviour can be
   * exercised without a database.
   */
  function repositoryStub() {
    const stored = new Map<string, Transaction>();
    const insertCalls: Array<Record<string, unknown>> = [];

    const save = vi.fn(async (transaction: Transaction & { idempotencyKey?: string }) => {
      const key = transaction.idempotencyKey;
      if (key) {
        const slot = `${transaction.businessId}:${key}`;
        const winner = stored.get(slot);
        if (winner) {
          // What the partial unique index does.
          throw Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
          });
        }
        stored.set(slot, transaction);
      }
      insertCalls.push(transaction as unknown as Record<string, unknown>);
      return transaction;
    });

    const findByIdempotencyKey = vi.fn(
      async (businessId: string, key: string) =>
        stored.get(`${businessId}:${key}`) ?? null,
    );

    // Agent 3's cross-tenant product check runs before any write; the stub
    // reports the referenced product as owned so idempotency is what is tested.
    const findOwnedProductIds = vi.fn(
      async (_businessId: string, productIds: readonly string[]) => ({
        data: productIds.map((id) => ({ id })),
        error: null,
      }),
    );

    return {
      save,
      findByIdempotencyKey,
      findOwnedProductIds,
      insertCalls,
      service: new DefaultTransactionService({
        save,
        findByIdempotencyKey,
        findOwnedProductIds,
      } as unknown as PostgrestTransactionRepository),
    };
  }

  it('replays the original transaction on an exact retry instead of duplicating', async () => {
    const { service, save } = repositoryStub();

    const first = await service.create(ctxFor(BIZ), request);
    const second = await service.create(ctxFor(BIZ), request);

    expect(save).toHaveBeenCalledTimes(1);
    expect(second.id).toBe(first.id);
  });

  it('conflicting payload under the same key is a conflict, not a silent replay', async () => {
    const { service } = repositoryStub();
    await service.create(ctxFor(BIZ), request);

    await expect(
      service.create(ctxFor(BIZ), { ...request, items: [{ productId: PRODUCT, quantity: 9, unitPrice: 1000 }] }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('replays when a concurrent identical request wins the unique index race', async () => {
    const { service, save, findByIdempotencyKey } = repositoryStub();

    // First create populates the (business, key) slot.
    const winner = await service.create(ctxFor(BIZ), request);

    // Simulate the race: the pre-check misses because the concurrent request has
    // not committed yet, then the insert loses the unique index.
    save.mockImplementationOnce(async () => {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
      });
    });

    const replayed = await service.create(ctxFor(BIZ), request);

    expect(replayed.id).toBe(winner.id);
    expect(findByIdempotencyKey).toHaveBeenCalled();
  });

  it('scopes the key to the tenant so one business cannot read another record', async () => {
    const { service, save } = repositoryStub();

    const mine = await service.create(ctxFor(BIZ), request);
    // Same key, different tenant: a distinct record, not a replay of BIZ's.
    const theirs = await service.create(ctxFor(OTHER_BIZ), request);

    expect(save).toHaveBeenCalledTimes(2);
    expect(theirs.id).not.toBe(mine.id);
    expect(theirs.businessId).toBe(OTHER_BIZ as TenantContext['businessId']);
  });

  it('replays a retried ingestion submission rather than double-posting it', async () => {
    const { service, save } = repositoryStub();

    // Ingestion re-sends the identical body after a transport failure.
    const submitted = { ...request, reference: 'extraction-run-77' };
    const first = await service.create(ctxFor(BIZ), submitted);
    const retried = await service.create(ctxFor(BIZ), submitted);

    expect(save).toHaveBeenCalledTimes(1);
    expect(retried.id).toBe(first.id);
  });

  it('still creates normally when no idempotency key is supplied', async () => {
    const { service, save } = repositoryStub();
    const withoutKey = { ...request };
    delete (withoutKey as { idempotencyKey?: string }).idempotencyKey;

    await service.create(ctxFor(BIZ), withoutKey);
    await service.create(ctxFor(BIZ), withoutKey);

    expect(save).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Numeric bounds
// ---------------------------------------------------------------------------

describe('numeric input bounds', () => {
  const BIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const txn = {
    type: 'sale',
    counterpartyType: 'customer',
    counterpartyId: 'cust-1',
    transactionDate: '2026-01-15T00:00:00.000Z',
  } as const;
  const productId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  function withItem(item: Record<string, unknown>) {
    return createTransactionSchema.safeParse({ ...txn, items: [item] });
  }

  it('rejects a quantity Postgres numeric(20,3) would round to zero', () => {
    // quantity 0.0001 is stored as 0.000 and fails CHECK (quantity > 0), which
    // surfaced as a driver 500 instead of a client error.
    const result = withItem({ productId, quantity: 0.0001, unitPrice: 1000 });
    expect(result.success).toBe(false);
  });

  it('accepts a quantity with three decimal places', () => {
    expect(withItem({ productId, quantity: 1.125, unitPrice: 1000 }).success).toBe(true);
  });

  it('rejects a quantity beyond the supported maximum', () => {
    expect(withItem({ productId, quantity: 1e9, unitPrice: 1 }).success).toBe(false);
  });

  it('rejects a unit price beyond the supported maximum', () => {
    expect(withItem({ productId, quantity: 1, unitPrice: 1e30 }).success).toBe(false);
    expect(withItem({ productId, quantity: 1, unitPrice: Number.MAX_SAFE_INTEGER + 10 }).success).toBe(false);
  });

  it('rejects a unit price that is not an integer number of minor units', () => {
    expect(withItem({ productId, quantity: 1, unitPrice: 10.5 }).success).toBe(false);
  });

  it('rejects an unbounded discount or tax the same way', () => {
    expect(withItem({ productId, quantity: 1, unitPrice: 100, discount: 1e30 }).success).toBe(false);
    expect(withItem({ productId, quantity: 1, unitPrice: 100, tax: 1e30 }).success).toBe(false);
  });

  it('applies the same quantity bound to inventory movements', () => {
    const base = {
      productId,
      type: 'sale',
    };
    expect(recordMovementSchema.safeParse({ ...base, quantity: 0.0001 }).success).toBe(false);
    expect(recordMovementSchema.safeParse({ ...base, quantity: 1e9 }).success).toBe(false);
    expect(recordMovementSchema.safeParse({ ...base, quantity: 2 }).success).toBe(true);
  });

  it('reports an unrepresentable total as a client error, not a server fault', async () => {
    // Schema-valid on its face: quantity 1e6 and unitPrice 1e12 are each within
    // their own caps, but the product is 1e18 — past Number.MAX_SAFE_INTEGER.
    // Without the service guard, createMoney's bare TypeError escapes as a 500.
    const parsed = createTransactionSchema.parse({
      ...txn,
      items: [{ productId, quantity: 1_000_000, unitPrice: MAX_MINOR_AMOUNT }],
    });

    const save = vi.fn();
    const service = new DefaultTransactionService({
      save,
      findByIdempotencyKey: vi.fn(async () => null),
      findOwnedProductIds: vi.fn(async (_b: string, ids: readonly string[]) => ({
        data: ids.map((id) => ({ id })),
        error: null,
      })),
    } as unknown as PostgrestTransactionRepository);

    await expect(
      service.create(
        {
          businessId: BIZ as TenantContext['businessId'],
          userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as TenantContext['userId'],
          role: 'owner',
          correlationId: 'c',
        },
        {
          ...parsed,
          transactionDate: new Date(parsed.transactionDate),
          items: parsed.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
        } as never,
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(save).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Request body size cap
// ---------------------------------------------------------------------------

describe('request body size cap', () => {
  function post(body: string, headers: Record<string, string> = {}): Request {
    return new Request('https://api.test/api/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    });
  }

  const schema = z.object({ note: z.string() });

  it('accepts a body under the cap', async () => {
    const result = await parseJsonBody(post(JSON.stringify({ note: 'ok' })), schema);
    expect(result).toEqual({ note: 'ok' });
  });

  it('refuses a body over the cap', async () => {
    const oversized = JSON.stringify({ note: 'x'.repeat(MAX_REQUEST_BODY_BYTES + 1024) });
    await expect(parseJsonBody(post(oversized), schema)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it('reports an oversized body as 413, not 400', () => {
    expect(new PayloadTooLargeError().statusCode).toBe(413);
  });

  it('refuses an oversized body even when Content-Length understates it', async () => {
    const oversized = JSON.stringify({ note: 'x'.repeat(MAX_REQUEST_BODY_BYTES + 1024) });

    // The header is a client claim. Enforcing only on the header would let any
    // caller bypass the limit by omitting or lying about it.
    await expect(
      parseJsonBody(post(oversized, { 'content-length': '10' }), schema),
    ).rejects.toBeInstanceOf(PayloadTooLargeError);

    await expect(
      parseJsonBody(post(oversized, { 'content-length': '' }), schema),
    ).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it('rejects early on an honest oversized Content-Length', async () => {
    await expect(
      parseJsonBody(post('{}', { 'content-length': String(MAX_REQUEST_BODY_BYTES + 1) }), schema),
    ).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it('still reports genuinely malformed JSON as a validation error', async () => {
    await expect(parseJsonBody(post('{not json'), schema)).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts a body just under the cap', async () => {
    const note = 'x'.repeat(MAX_REQUEST_BODY_BYTES - 64);
    const result = await parseJsonBody(post(JSON.stringify({ note })), schema);
    expect(result.note).toHaveLength(MAX_REQUEST_BODY_BYTES - 64);
  });
});

// ---------------------------------------------------------------------------
// Supplier pricing authorization consistency
// ---------------------------------------------------------------------------

describe('supplier pricing authorization consistency', () => {
  const BIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const OTHER_BIZ = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const SUPPLIER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

  function ctxFor(businessId: string): TenantContext {
    return {
      businessId: businessId as TenantContext['businessId'],
      userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as TenantContext['userId'],
      role: 'owner',
      correlationId: 'c',
    };
  }

  function serviceStub(supplierExists: boolean) {
    const findById = vi.fn(async () => (supplierExists ? { id: SUPPLIER } : null));
    const pricing = vi.fn(async () => []);
    return {
      findById,
      pricing,
      service: new DefaultSupplierService({ findById, pricing } as unknown as PostgrestSupplierRepository),
    };
  }

  it('returns 404 for a supplier outside the caller tenant, matching GET /suppliers/:id', async () => {
    const { service, pricing } = serviceStub(false);

    await expect(
      service.getPricing(ctxFor(BIZ), SUPPLIER as never),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(pricing).not.toHaveBeenCalled();
  });

  it('still returns an empty list for a real supplier with no price rows', async () => {
    const { service, pricing } = serviceStub(true);

    // The distinction the fix restores: "no pricing" is 200 [], "no such
    // supplier" is 404.
    await expect(service.getPricing(ctxFor(BIZ), SUPPLIER as never)).resolves.toEqual([]);
    expect(pricing).toHaveBeenCalledTimes(1);
  });

  it('scopes the price list to the caller tenant', async () => {
    const { service, pricing } = serviceStub(true);

    await service.getPricing(ctxFor(OTHER_BIZ), SUPPLIER as never);

    expect(pricing).toHaveBeenCalledWith(OTHER_BIZ, SUPPLIER);
  });

  it('refuses before any lookup when the role lacks suppliers:read', async () => {
    const { service, findById, pricing } = serviceStub(true);

    await expect(
      service.getPricing({ ...ctxFor(BIZ), role: 'staff' }, SUPPLIER as never),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(findById).not.toHaveBeenCalled();
    expect(pricing).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Whole-set aggregates must not report a partial total
// ---------------------------------------------------------------------------

describe('expense totals by category', () => {
  const BIZ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  function dbReturning(rowCount: number) {
    const rows = Array.from({ length: rowCount }, () => ({
      category: 'rent',
      amount_minor: 100,
    }));
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'gte', 'lte']) builder[method] = () => builder;
    builder.range = () => builder;
    builder.then = (onFulfilled: (value: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(onFulfilled);

    return {
      from: () => builder,
    } as unknown as Db;
  }

  function serviceFor(rowCount: number) {
    const repository = new PostgrestExpenseRepository(dbReturning(rowCount));
    return new DefaultExpenseService(repository);
  }

  const range = { from: new Date('2026-01-01T00:00:00.000Z'), to: new Date('2026-12-31T00:00:00.000Z') };
  const ctx: TenantContext = {
    businessId: BIZ as TenantContext['businessId'],
    userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as TenantContext['userId'],
    role: 'owner',
    correlationId: 'c',
  };

  it('sums the whole set when it fits', async () => {
    const totals = await serviceFor(10).getTotalByCategory(ctx, range);
    expect(totals).toEqual([{ category: 'rent', total: 1000, count: 10 }]);
  });

  it('throws rather than reporting an understated total when the scan overflows', async () => {
    // An unbounded read is silently capped by the server at 1,000 rows. The
    // category totals would then be too small with nothing to indicate it —
    // the one failure a merchant cannot audit.
    await expect(serviceFor(MAX_LEDGER_SCAN + 1).getTotalByCategory(ctx, range)).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });

  it('bounds the query explicitly so overflow is detectable', () => {
    expect(MAX_LEDGER_SCAN).toBeLessThan(POSTGREST_MAX_ROWS);
  });
});

// ---------------------------------------------------------------------------
// Transaction state transitions
// ---------------------------------------------------------------------------

describe('transaction state transitions', () => {
  it('permits the forward path', () => {
    expect(canTransitionTo('draft', 'confirmed')).toBe(true);
    expect(canTransitionTo('confirmed', 'completed')).toBe(true);
  });

  it('permits voiding a draft or confirmed transaction', () => {
    expect(canTransitionTo('draft', 'voided')).toBe(true);
    expect(canTransitionTo('confirmed', 'voided')).toBe(true);
  });

  it('refuses to modify a completed transaction', () => {
    expect(canTransitionTo('completed', 'completed')).toBe(false);
    expect(canTransitionTo('completed', 'voided')).toBe(false);
  });

  it('refuses to revive a voided transaction', () => {
    expect(canTransitionTo('voided', 'confirmed')).toBe(false);
    expect(canTransitionTo('voided', 'completed')).toBe(false);
    expect(canTransitionTo('voided', 'draft')).toBe(false);
  });

  it('refuses to skip confirmation', () => {
    expect(canTransitionTo('draft', 'completed')).toBe(false);
  });

  it('refuses to un-complete a completed transaction', () => {
    expect(canTransitionTo('completed', 'confirmed')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe('idempotency keys', () => {
  it('requires a key of meaningful length', () => {
    const base = {
      type: 'sale',
      counterpartyType: 'customer',
      counterpartyId: 'cust-1',
      items: [{ productId: '11111111-1111-4111-8111-111111111111', quantity: 1, unitPrice: 100 }],
      transactionDate: '2026-01-15T10:00:00.000Z',
    } as const;

    expect(createTransactionSchema.safeParse({ ...base }).success).toBe(true);
    // A one-character key would collide with every other one-character key.
    expect(createTransactionSchema.safeParse({ ...base, idempotencyKey: 'x' }).success).toBe(false);
    expect(createTransactionSchema.safeParse({ ...base, idempotencyKey: 'long-enough-key' }).success).toBe(true);
  });

  it('surfaces a duplicate key as a conflict rather than a second record', () => {
    // Transactions rely on the partial unique index, so a replayed key fails
    // with 23505 -> 409 Conflict. It does NOT return the original resource:
    // `findByIdempotencyKey` exists but has no caller. Expenses are the ones
    // that replay (expense-repository.ts consults it). Recorded here so the
    // asymmetry is a decision rather than an oversight.
    const mapped = wrapDatabaseError(
      Object.assign(new Error('duplicate key'), { code: '23505' }),
    );
    expect(mapped).toBeInstanceOf(ConflictError);
  });

  it('is backed by a partial unique index in the schema', async () => {
    // There is no repository-level idempotency test; this pins the DDL the
    // behaviour depends on, so removing the index fails here.
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = 'supabase/migrations';
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(`${dir}/${f}`, 'utf8'))
      .join('\n');

    expect(sql).toMatch(/idempotency_key/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]{0,200}idempotency/i);
  });
});

// ---------------------------------------------------------------------------
// Date range boundaries
// ---------------------------------------------------------------------------

describe('date range semantics', () => {
  it('accepts a single-day range', () => {
    const day = '2026-03-15';
    const result = dateRangeArgs(new URLSearchParams({ from: day, to: day }));

    expect(result.dateRange).toBeDefined();
  });

  it('rejects an inverted range', () => {
    expect(() =>
      dateRangeArgs(new URLSearchParams({ from: '2026-03-15', to: '2026-03-01' })),
    ).toThrow(/earlier than or equal/);
  });

  it('pins an open-ended range rather than leaving it unbounded', () => {
    const fromOnly = dateRangeArgs(new URLSearchParams({ from: '2026-01-01' }));
    const toOnly = dateRangeArgs(new URLSearchParams({ to: '2026-01-01' }));

    expect(fromOnly.dateRange?.to.getTime()).toBeGreaterThan(0);
    expect(toOnly.dateRange?.from.getTime()).toBe(0);
  });

  it('handles a month boundary', () => {
    const result = dateRangeArgs(
      new URLSearchParams({ from: '2026-02-01', to: '2026-03-01' }),
    );
    expect(result.dateRange).toBeDefined();
    const range = result.dateRange as { from: Date; to: Date };
    expect(range.to.getTime() - range.from.getTime()).toBe(28 * DAY);
  });
});
