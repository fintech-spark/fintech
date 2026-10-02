// Merchant Brain: Phase 3 API security tests
//
// These exercise the HTTP boundary with a mocked Supabase client, so no
// network, no credentials, and no database are required.
//
// The threat model is cross-tenant access: a caller authenticated for
// Business A must never observe or mutate Business B's data, and must never be
// able to widen their own access by supplying a different businessId.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthenticationError } from '@/lib/errors';
import {
  parsePagination,
  resolveSort,
  parseEnum,
  parseUuid,
  parseSearch,
  dateRangeArgs,
  MAX_PAGE_SIZE,
} from '@/lib/http/params';
import { toErrorResponse, normalizeError } from '@/lib/http/errors';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const BIZ_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BIZ_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VALID_UUID = '11111111-1111-4111-8111-111111111111';

function request(overrides: { token?: string | null; businessId?: string } = {}): Request {
  const token = overrides.token === undefined ? 'valid-token' : overrides.token;
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request(`https://api.test/api/x?businessId=${overrides.businessId ?? BIZ_A}`, { headers });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data: body }), { status });
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

describe('authentication', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('rejects a request with no Authorization header', async () => {
    const { extractAccessToken } = await import('@/lib/http/auth-context');
    expect(extractAccessToken(request({ token: null }))).toBeNull();
  });

  it('rejects a malformed Authorization header', async () => {
    const { extractAccessToken } = await import('@/lib/http/auth-context');
    const req = new Request('https://api.test/x', { headers: { authorization: 'Bearer' } });
    expect(extractAccessToken(req)).toBeNull();
  });

  it('accepts a bearer token', async () => {
    const { extractAccessToken } = await import('@/lib/http/auth-context');
    expect(extractAccessToken(request())).toBe('valid-token');
  });

  it('accepts a Supabase session cookie', async () => {
    const { extractAccessToken } = await import('@/lib/http/auth-context');
    const req = new Request('https://api.test/x', {
      headers: { cookie: `sb-access-token=${'cookie-token'}; other=1` },
    });
    expect(extractAccessToken(req)).toBe('cookie-token');
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant isolation
// ---------------------------------------------------------------------------

describe('cross-tenant isolation', () => {
  beforeEach(() => {
    // Each test re-imports auth-context so vi.doMock (which is sticky for the
    // remainder of the file) is re-evaluated against a fresh module registry.
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  /** Mocks the Supabase client so Business A is a member of BIZ_A only. */
  async function mockContext(memberships: string[]) {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_ANON_KEY = 'test-anon-key';

    vi.doMock('@/lib/supabase/server-client', () => ({
      createServerClient: () => ({
        auth: { getUser: async () => ({ data: { user: { id: USER, email: 'a@b.c' } }, error: null }) },
        rpc: async (fn: string) =>
          fn === 'auth_user_businesses' ? { data: memberships, error: null } : { data: [], error: null },
        from: () => {
          // Mirrors resolveRole's chain: select().eq().eq().eq().limit()
          const chain = {
            select: () => chain,
            eq: () => chain,
            limit: async () => ({ data: [{ business_id: memberships[0], role: 'owner', status: 'active' }], error: null }),
          };
          return chain;
        },
      }),
    }));
  }

  it('resolves a TenantContext for a business the caller belongs to', async () => {
    await mockContext([BIZ_A]);
    const { resolveTenantContext } = await import('@/lib/http/auth-context');
    const resolved = await resolveTenantContext(request(), BIZ_A);
    expect(String(resolved.ctx.businessId)).toBe(BIZ_A);
    expect(String(resolved.ctx.userId)).toBe(USER);
  });

  it('refuses a business the caller does not belong to', async () => {
    await mockContext([BIZ_A]);
    const { resolveTenantContext } = await import('@/lib/http/auth-context');
    // Asserted on `code`, not `instanceof`: vi.resetModules() can load a second
    // copy of errors.ts, which makes class identity unreliable across the suites.
    await expect(resolveTenantContext(request(), BIZ_B)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
  });

  it('never derives the tenant from a query parameter', async () => {
    // Even when the URL asks for Business B, the resolved tenant is Business A,
    // because the path parameter is ignored and membership is authoritative.
    await mockContext([BIZ_A]);
    const { resolveTenantContext } = await import('@/lib/http/auth-context');
    const resolved = await resolveTenantContext(request({ businessId: BIZ_B }), BIZ_A);
    expect(String(resolved.ctx.businessId)).toBe(BIZ_A);
  });

  it('throws when the caller has no memberships at all', async () => {
    await mockContext([]);
    const { resolveTenantContext } = await import('@/lib/http/auth-context');
    await expect(resolveTenantContext(request(), BIZ_A)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

// ---------------------------------------------------------------------------
// Authorization matrix
// ---------------------------------------------------------------------------

describe('role permissions', () => {
  // Loaded dynamically so vi.doMock in the isolation suite does not pin the
  // module before the mock registry is populated.
  async function hasPermission(role: never, permission: never) {
    const mod = await import('@/lib/http/auth-context');
    return mod.hasPermission(role, permission);
  }

  it('owner may do everything', async () => {
    expect(await hasPermission('owner' as never, 'actions:execute' as never)).toBe(true);
    expect(await hasPermission('owner' as never, 'settings:write' as never)).toBe(true);
  });

  it('admin may not execute actions', async () => {
    expect(await hasPermission('admin' as never, 'settings:write' as never)).toBe(true);
    expect(await hasPermission('admin' as never, 'actions:execute' as never)).toBe(false);
  });

  it('manager may write transactions but not settings', async () => {
    expect(await hasPermission('manager' as never, 'transactions:write' as never)).toBe(true);
    expect(await hasPermission('manager' as never, 'settings:write' as never)).toBe(false);
  });

  it('accountant is read-only on inventory', async () => {
    expect(await hasPermission('accountant' as never, 'expenses:write' as never)).toBe(true);
    expect(await hasPermission('accountant' as never, 'inventory:write' as never)).toBe(false);
  });

  it('staff is read-only everywhere', async () => {
    expect(await hasPermission('staff' as never, 'transactions:read' as never)).toBe(true);
    expect(await hasPermission('staff' as never, 'transactions:write' as never)).toBe(false);
    expect(await hasPermission('staff' as never, 'settings:read' as never)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pagination and query hardening
// ---------------------------------------------------------------------------

describe('pagination and query hardening', () => {
  it('caps limit at the maximum page size', () => {
    const { limit } = parsePagination(new URLSearchParams('limit=99999'));
    expect(limit).toBe(MAX_PAGE_SIZE);
  });

  it('rejects a non-integer page', () => {
    expect(() => parsePagination(new URLSearchParams('page=abc'))).toThrow();
  });

  it('rejects a negative limit', () => {
    expect(() => parsePagination(new URLSearchParams('limit=-5'))).toThrow();
  });

  it('defaults page and limit sensibly', () => {
    const { page, limit } = parsePagination(new URLSearchParams());
    expect(page).toBe(1);
    expect(limit).toBe(20);
  });

  it('falls back to an allowlisted sort column for an unknown field', () => {
    const { column } = resolveSort(
      new URLSearchParams('sortBy=; DROP TABLE transactions;--'),
      ['transactionDate', 'total'] as const,
      'transactionDate',
    );
    expect(column).toBe('transactionDate');
  });

  it('honours an allowlisted sort column', () => {
    const { column, ascending } = resolveSort(
      new URLSearchParams('sortBy=total&sortDir=asc'),
      ['transactionDate', 'total'] as const,
      'transactionDate',
    );
    expect(column).toBe('total');
    expect(ascending).toBe(true);
  });

  it('rejects a value outside an enum filter', () => {
    expect(() =>
      parseEnum('nonsense', ['sale', 'purchase'] as const, 'type'),
    ).toThrow();
  });

  it('accepts a valid enum value', () => {
    expect(parseEnum('sale', ['sale', 'purchase'] as const, 'type')).toBe('sale');
  });

  it('rejects a malformed UUID', () => {
    expect(() => parseUuid("' OR 1=1 --", 'id')).toThrow();
    expect(() => parseUuid('../../etc/passwd', 'id')).toThrow();
  });

  it('accepts a valid UUID', () => {
    expect(parseUuid(VALID_UUID, 'id')).toBe(VALID_UUID);
  });

  it('bounds a search term', () => {
    // parseSearch's cap applies above 120 characters; a 500-char term is rejected.
    expect(() => parseSearch('a'.repeat(500))).toThrow();
    expect(parseSearch('  widget  ')).toBe('widget');
  });

  it('rejects an inverted date range', () => {
    expect(() => dateRangeArgs(new URLSearchParams('from=2026-05-01&to=2026-01-01'))).toThrow();
  });

  it('returns no range when neither bound is supplied', () => {
    expect(dateRangeArgs(new URLSearchParams())).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Error contract
// ---------------------------------------------------------------------------

describe('error contract', () => {
  it('maps an authentication failure to 401', async () => {
    const res = toErrorResponse(new AuthenticationError());
    expect(res.status).toBe(401);
  });

  it('maps an authorization failure to 403', async () => {
    // toErrorResponse matches with `instanceof AppError`, so the error class and
    // the handler must come from the same module registry. Importing both
    // dynamically guarantees that even after vi.resetModules().
    const { toErrorResponse: toResponse } = await import('@/lib/http/errors');
    const { AuthorizationError: AuthzError } = await import('@/lib/errors');
    const res = toResponse(new AuthzError());
    expect(res.status).toBe(403);
  });

  it('never leaks an internal message for an unknown error', () => {
    const normalised = normalizeError(new Error('pg failed: SELECT * FROM users at /srv/app/db.ts:42'));
    expect(normalised.message).not.toContain('/srv/app/db.ts');
    expect(normalised.statusCode).toBe(500);
  });

  it('never leaks a SQL fragment in the response body', async () => {
    const res = toErrorResponse(new Error('syntax error at or near "FROMM"'));
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('FROMM');
  });

  it('returns a JSON error envelope', async () => {
    const res = toErrorResponse(new AuthenticationError());
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(body.error.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Service-level tenant scoping
// ---------------------------------------------------------------------------

describe('service tenant scoping', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('passes the resolved businessId to the repository, never a request field', async () => {
    const { DefaultExpenseService } = await import(
      '@/modules/expenses/infrastructure/expense-repository'
    );

    const save = vi.fn(async (e: unknown) => e);
    const findByIdempotencyKey = vi.fn(async () => null);
    const repo = { save, findByIdempotencyKey } as never;

    const service = new DefaultExpenseService(repo);
    const ctx = {
      businessId: BIZ_A as never,
      userId: USER as never,
      role: 'owner' as const,
      correlationId: 'c',
    };

    await service.create(ctx, {
      category: 'rent',
      amount: 1000,
      currency: 'INR',
      description: 'Test',
      expenseDate: new Date(),
    } as never);

    expect(save).toHaveBeenCalledOnce();
    expect((save.mock.calls[0][0] as { businessId: string }).businessId).toBe(BIZ_A);
  });

  it('rejects a write from a role without the permission', async () => {
    const { DefaultExpenseService } = await import(
      '@/modules/expenses/infrastructure/expense-repository'
    );

    const service = new DefaultExpenseService({} as never);
    const ctx = {
      businessId: BIZ_A as never,
      userId: USER as never,
      role: 'staff' as const,
      correlationId: 'c',
    };

    await expect(
      service.create(ctx, {
        category: 'rent',
        amount: 1000,
        currency: 'INR',
        description: 'Test',
        expenseDate: new Date(),
      } as never),
    ).rejects.toThrow(/permission/i);
  });

  it('rejects a non-positive expense amount', async () => {
    const { DefaultExpenseService } = await import(
      '@/modules/expenses/infrastructure/expense-repository'
    );

    const service = new DefaultExpenseService({
      findByIdempotencyKey: async () => null,
      save: async (e: unknown) => e,
    } as never);

    const ctx = {
      businessId: BIZ_A as never,
      userId: USER as never,
      role: 'owner' as const,
      correlationId: 'c',
    };

    await expect(
      service.create(ctx, {
        category: 'rent',
        amount: 0,
        currency: 'INR',
        description: 'Test',
        expenseDate: new Date(),
      } as never),
    ).rejects.toThrow(/positive/i);
  });

  it('rejects a fractional expense amount (minor units must be integers)', async () => {
    const { DefaultExpenseService } = await import(
      '@/modules/expenses/infrastructure/expense-repository'
    );

    const service = new DefaultExpenseService({
      findByIdempotencyKey: async () => null,
      save: async (e: unknown) => e,
    } as never);

    const ctx = {
      businessId: BIZ_A as never,
      userId: USER as never,
      role: 'owner' as const,
      correlationId: 'c',
    };

    await expect(
      service.create(ctx, {
        category: 'rent',
        amount: 100.55,
        currency: 'INR',
        description: 'Test',
        expenseDate: new Date(),
      } as never),
    ).rejects.toThrow(/integer/i);
  });
});

// ---------------------------------------------------------------------------
// Document storage path traversal
// ---------------------------------------------------------------------------

describe('document storage path safety', () => {
  it('rejects an absolute storage path', async () => {
    const { createDocumentSchema } = await import('@/lib/validation/api-schemas');
    const result = createDocumentSchema.safeParse({
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      fileSize: 1000,
      sourceType: 'invoice',
      storagePath: '/etc/passwd',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a traversal storage path', async () => {
    const { createDocumentSchema } = await import('@/lib/validation/api-schemas');
    const result = createDocumentSchema.safeParse({
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      fileSize: 1000,
      sourceType: 'invoice',
      storagePath: '../../other-tenant/secret.pdf',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an oversized file', async () => {
    const { createDocumentSchema } = await import('@/lib/validation/api-schemas');
    const result = createDocumentSchema.safeParse({
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      fileSize: 100 * 1024 * 1024,
      sourceType: 'invoice',
      storagePath: 'ok/a.pdf',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a safe relative path', async () => {
    const { createDocumentSchema } = await import('@/lib/validation/api-schemas');
    const result = createDocumentSchema.safeParse({
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      fileSize: 1000,
      sourceType: 'invoice',
      storagePath: `${BIZ_A}/doc-1/a.pdf`,
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Money invariants
// ---------------------------------------------------------------------------

describe('money invariants', () => {
  it('rejects a fractional amount in a transaction line', async () => {
    const { createTransactionSchema } = await import('@/lib/validation/api-schemas');
    const result = createTransactionSchema.safeParse({
      type: 'sale',
      counterpartyType: 'customer',
      counterpartyId: 'cust-1',
      transactionDate: '2026-01-01T00:00:00Z',
      items: [{ productId: VALID_UUID, quantity: 1, unitPrice: 10.5 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty line-item array', async () => {
    const { createTransactionSchema } = await import('@/lib/validation/api-schemas');
    const result = createTransactionSchema.safeParse({
      type: 'sale',
      counterpartyType: 'customer',
      counterpartyId: 'cust-1',
      transactionDate: '2026-01-01T00:00:00Z',
      items: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-uuid productId', async () => {
    const { createTransactionSchema } = await import('@/lib/validation/api-schemas');
    const result = createTransactionSchema.safeParse({
      type: 'sale',
      counterpartyType: 'customer',
      counterpartyId: 'cust-1',
      transactionDate: '2026-01-01T00:00:00Z',
      items: [{ productId: '1 OR 1=1', quantity: 1, unitPrice: 100 }],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helpers kept honest
// ---------------------------------------------------------------------------

describe('test harness sanity', () => {
  it('builds a request with a bearer token', () => {
    expect(request().headers.get('authorization')).toBe('Bearer valid-token');
  });

  it('builds a json response', async () => {
    const res = jsonResponse({ id: '1' });
    expect(await res.json()).toEqual({ data: { id: '1' } });
  });
});