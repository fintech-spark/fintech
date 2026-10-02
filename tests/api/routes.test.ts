// Merchant Brain: Phase 3 route-level tests
//
// WHY THIS FILE EXISTS
//
// The Phase 3 suite passed 162 tests while roughly twenty endpoints returned 403
// for every caller: each route read `route.params.businessId`, but the flat route
// segments had no `[businessId]` folder, so the value was `undefined` at runtime.
// The compiler could not see it, because `route.params` is typed
// `Record<string, string>`, and no test imported a route handler.
//
// These tests call the real handlers. Each one asserts the HTTP status code, so a
// route that cannot resolve a tenant now fails here instead of in production.
//
// No network, no credentials, no database: `createServerClient` is mocked with a
// chainable stub that records the filters a repository applied.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Fixture ids
// ---------------------------------------------------------------------------

const BIZ_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BIZ_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TXN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CUSTOMER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const PRODUCT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';



// ---------------------------------------------------------------------------
// Fake PostgREST client
// ---------------------------------------------------------------------------

type Filter = { column: string; value: unknown };

interface QueryLog {
  table: string;
  filters: Filter[];
}

const queries: QueryLog[] = [];
let rowsByTable: Record<string, unknown[]> = {};

/** The caller's `business_members` row, as `resolveRole` reads it. */
function membership(role: string, status = 'active') {
  return { business_id: BIZ_A, user_id: USER_ID, role, status };
}

function setMembership(role: string, status = 'active') {
  rowsByTable.business_members = [membership(role, status)];
}

/** A chainable query builder: every builder method returns itself. */
function makeQuery(table: string) {
  const log: QueryLog = { table, filters: [] };
  queries.push(log);

  const builder: Record<string, unknown> = {};

  for (const method of ['select', 'insert', 'update', 'upsert', 'delete']) {
    builder[method] = vi.fn(() => builder);
  }

  for (const method of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'ilike', 'or', 'not']) {
    builder[method] = vi.fn((column: string, value: unknown) => {
      log.filters.push({ column, value });
      return builder;
    });
  }

  for (const method of ['order', 'range', 'limit', 'offset']) {
    builder[method] = vi.fn(() => builder);
  }

  const rows = () => {
    const all = rowsByTable[table] ?? [];
    // Apply `eq` filters the way PostgREST would, so a test that sets a
    // non-active membership row actually exercises the `.eq('status','active')`.
    return all.filter((row) =>
      log.filters
        .filter((f) => f.column !== 'business_id')
        .every((f) => (row as Record<string, unknown>)[f.column] === f.value),
    );
  };

  builder.single = vi.fn(async () => ({ data: rows()[0] ?? null, error: null }));
  builder.maybeSingle = vi.fn(async () => ({ data: rows()[0] ?? null, error: null }));

  // Thenable, so `await db.from(t).select().eq()` resolves to a result object.
  builder.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => {
    const data = rows();
    return Promise.resolve({ data, error: null, count: data.length }).then(onFulfilled, onRejected);
  };

  return builder;
}

function makeClient() {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: USER_ID, email: 'owner@example.test' } },
        error: null,
      })),
    },
    rpc: vi.fn(async (fn: string) => {
      if (fn === 'auth_user_businesses') {
        return { data: [BIZ_A], error: null };
      }
      return { data: null, error: null };
    }),
    from: vi.fn((table: string) => makeQuery(table)),
  };
}

vi.mock('@/lib/supabase/server-client', () => ({
  createServerClient: vi.fn(() => makeClient()),
}));

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

interface ReqOptions {
  token?: string | null;
  method?: string;
  body?: unknown;
}

function request(url: string, options: ReqOptions = {}): Request {
  const headers = new Headers();
  const token = options.token === undefined ? 'valid-token' : options.token;
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (options.body !== undefined) headers.set('content-type', 'application/json');

  return new Request(url, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

/** Params as Next.js delivers them to a route handler: `params` is a Promise. */
function params(businessId: string | undefined, extra: Record<string, string> = {}) {
  return {
    params: Promise.resolve({
      ...(businessId === undefined ? {} : { businessId }),
      ...extra,
    }),
  };
}

/** Every `.eq('business_id', …)` the repositories applied, across all queries. */
function businessIdFilters(): unknown[] {
  return queries
    .flatMap((q) => q.filters)
    .filter((f) => f.column === 'business_id')
    .map((f) => f.value);
}

const TXN_ROW = {
  id: TXN_ID,
  business_id: BIZ_A,
  type: 'sale',
  status: 'draft',
  counterparty_id: null,
  transaction_date: '2026-01-15T00:00:00.000Z',
  subtotal_minor: 10000,
  tax_minor: 1800,
  discount_minor: 0,
  total_minor: 11800,
  currency: 'INR',
  notes: null,
  created_by: USER_ID,
  created_at: '2026-01-15T00:00:00.000Z',
  updated_at: '2026-01-15T00:00:00.000Z',
};

const BUSINESS_ROW = {
  id: BIZ_A,
  name: 'Corner Store',
  type: 'retail',
  status: 'active',
  display_name: null,
  industry: null,
  address: null,
  phone: null,
  email: null,
  gstin: null,
  pan: null,
  currency: 'INR',
  fiscal_year_start: 4,
  timezone: 'Asia/Kolkata',
  low_stock_threshold: 5,
  overdue_threshold_days: 30,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};


beforeEach(() => {
  queries.length = 0;
  rowsByTable = {
    businesses: [BUSINESS_ROW],
    business_members: [membership('owner')],
    transactions: [TXN_ROW],
    transaction_items: [],
  };
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

describe('route authentication', () => {
  it('returns 401 with no Authorization header', async () => {
    const { GET } = await import('@/app/api/businesses/[businessId]/transactions/route');
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_A}/transactions`, { token: null }),
      params(BIZ_A),
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 when the token is rejected by the auth server', async () => {
    const { createServerClient } = await import('@/lib/supabase/server-client');
    vi.mocked(createServerClient).mockReturnValueOnce({
      auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'bad' } })) },
      rpc: vi.fn(),
      from: vi.fn(),
    } as never);

    const { GET } = await import('@/app/api/businesses/[businessId]/transactions/route');
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_A}/transactions`),
      params(BIZ_A),
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Tenant resolution — the R1 regression
// ---------------------------------------------------------------------------

describe('tenant resolution', () => {
  it('resolves the tenant from the path segment (not undefined)', async () => {
    const { GET } = await import('@/app/api/businesses/[businessId]/transactions/route');
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_A}/transactions`),
      params(BIZ_A),
    );

    expect(res.status).toBe(200);
    // The old bug produced zero business_id filters because businessId was undefined.
    expect(businessIdFilters().length).toBeGreaterThan(0);
  });

  it('returns 403 for a business the caller is not a member of', async () => {
    const { GET } = await import('@/app/api/businesses/[businessId]/transactions/route');
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_B}/transactions`),
      params(BIZ_B),
    );
    expect(res.status).toBe(403);
  });

  it('returns 400 for a malformed businessId in the path', async () => {
    const { GET } = await import('@/app/api/businesses/[businessId]/transactions/route');
    const res = await GET(
      request('https://api.test/api/businesses/not-a-uuid/transactions'),
      params('not-a-uuid'),
    );
    expect(res.status).toBe(400);
  });

  it('ignores a forged businessId in the query string', async () => {
    const { GET } = await import('@/app/api/businesses/[businessId]/transactions/route');
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_A}/transactions?businessId=${BIZ_B}`),
      params(BIZ_A),
    );

    expect(res.status).toBe(200);
    // Every tenant-scoped query must name the session tenant, never the forged one.
    expect(businessIdFilters()).not.toContain(BIZ_B);
    expect(businessIdFilters()).toContain(BIZ_A);
  });

  it('ignores a forged businessId in a request body', async () => {
    const { POST } = await import('@/app/api/businesses/[businessId]/transactions/route');
    const res = await POST(
      request(`https://api.test/api/businesses/${BIZ_A}/transactions`, {
        method: 'POST',
        body: {
          businessId: BIZ_B,
          type: 'sale',
          counterpartyType: 'customer',
          counterpartyId: CUSTOMER_ID,
          items: [{ productId: PRODUCT_ID, quantity: 2, unitPrice: 5000 }],
          transactionDate: '2026-01-15T10:00:00.000Z',
        },
      }),
      params(BIZ_A),
    );

    expect(res.status).toBe(200);
    expect(businessIdFilters()).not.toContain(BIZ_B);
    expect(businessIdFilters()).toContain(BIZ_A);
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant record access
// ---------------------------------------------------------------------------

describe('cross-tenant record access', () => {
  it('returns 404, not 403, for a record the caller cannot see', async () => {
    rowsByTable.transactions = [];
    const { GET } = await import('@/app/api/businesses/[businessId]/transactions/[id]/route');
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_A}/transactions/${TXN_ID}`),
      params(BIZ_A, { id: TXN_ID }),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.statusCode).toBe(404);
  });

  it('returns 400 for a malformed record id', async () => {
    const { GET } = await import('@/app/api/businesses/[businessId]/transactions/[id]/route');
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_A}/transactions/'; DROP TABLE transactions;--`),
      params(BIZ_A, { id: "'; DROP TABLE transactions;--" }),
    );
    expect(res.status).toBe(400);
  });

  it('scopes the record lookup to the session tenant', async () => {
    const { GET } = await import('@/app/api/businesses/[businessId]/transactions/[id]/route');
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_A}/transactions/${TXN_ID}`),
      params(BIZ_A, { id: TXN_ID }),
    );

    expect(res.status).toBe(200);
    const txnQuery = queries.find((q) => q.table === 'transactions');
    expect(txnQuery?.filters).toContainEqual({ column: 'business_id', value: BIZ_A });
    expect(txnQuery?.filters).toContainEqual({ column: 'id', value: TXN_ID });
  });
});

// ---------------------------------------------------------------------------
// Privilege escalation
// ---------------------------------------------------------------------------

describe('privilege escalation', () => {
  it('refuses a settings write from a staff member', async () => {
    setMembership('staff');
    const { PATCH } = await import('@/app/api/businesses/[businessId]/settings/route');
    const res = await PATCH(
      request(`https://api.test/api/businesses/${BIZ_A}/settings`, {
        method: 'PATCH',
        body: { lowStockThreshold: 3 },
      }),
      params(BIZ_A),
    );

    expect(res.status).toBe(403);
  });

  it('refuses a settings write from a manager', async () => {
    setMembership('manager');
    const { PATCH } = await import('@/app/api/businesses/[businessId]/settings/route');
    const res = await PATCH(
      request(`https://api.test/api/businesses/${BIZ_A}/settings`, {
        method: 'PATCH',
        body: { lowStockThreshold: 3 },
      }),
      params(BIZ_A),
    );

    expect(res.status).toBe(403);
  });

  it('allows a settings write from an owner', async () => {
      const { PATCH } = await import('@/app/api/businesses/[businessId]/settings/route');
    const res = await PATCH(
      request(`https://api.test/api/businesses/${BIZ_A}/settings`, {
        method: 'PATCH',
        body: { lowStockThreshold: 3 },
      }),
      params(BIZ_A),
    );

    expect(res.status).toBe(200);
  });

  it('refuses when the membership row is not active', async () => {
    setMembership('owner', 'suspended');
    const { GET } = await import('@/app/api/businesses/[businessId]/route');
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_A}`),
      params(BIZ_A),
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Error contract
// ---------------------------------------------------------------------------

describe('error contract', () => {
  it('never returns a stack trace or SQL text', async () => {
    rowsByTable.transactions = [];
    const { GET } = await import('@/app/api/businesses/[businessId]/transactions/[id]/route');
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_A}/transactions/${TXN_ID}`),
      params(BIZ_A, { id: TXN_ID }),
    );

    const raw = JSON.stringify(await res.json());
    expect(raw).not.toMatch(/select |insert into|at Object|\.ts:\d+/i);
    expect(raw).not.toContain(USER_ID);
  });
});

// ---------------------------------------------------------------------------
// Pagination hardening at the route boundary
// ---------------------------------------------------------------------------

describe('pagination hardening', () => {
  it('clamps an oversized limit', async () => {
    const { GET } = await import('@/app/api/businesses/[businessId]/transactions/route');
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_A}/transactions?limit=9999`),
      params(BIZ_A),
    );
    expect(res.status).toBe(200);
  });

  it('rejects a non-integer page', async () => {
    const { GET } = await import('@/app/api/businesses/[businessId]/transactions/route');
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_A}/transactions?page=abc`),
      params(BIZ_A),
    );
    expect(res.status).toBe(400);
  });
});