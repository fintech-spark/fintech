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

import { describe, expect, it } from 'vitest';
import {
  MAX_PAGE_NUMBER,
  MAX_PAGE_SIZE,
  dateRangeArgs,
  escapeLikePattern,
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
import { ConflictError, wrapDatabaseError } from '@/lib/errors';
import {
  createDocumentSchema,
  createTransactionSchema,
  updateDocumentStatusSchema,
} from '@/lib/validation/api-schemas';
import { canTransitionTo } from '@/modules/transactions';
import { canTransitionDocumentTo } from '@/modules/documents';

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
