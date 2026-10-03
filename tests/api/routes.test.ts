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
import { MAX_PAGE_NUMBER, MAX_PAGE_SIZE } from '@/lib/http/params';
import { POSTGREST_MAX_ROWS } from '@/lib/bounded-scan';
import {
  createDocumentSchema,
  createExpenseSchema,
  createTransactionSchema,
  recordMovementSchema,
} from '@/lib/validation/api-schemas';

// ---------------------------------------------------------------------------
// Fixture ids
// ---------------------------------------------------------------------------

const BIZ_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BIZ_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TXN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CUSTOMER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const PRODUCT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

/**
 * A product owned by BIZ_A. POST /transactions rejects a line item whose
 * productId resolves to nothing in this tenant, because `transaction_items` has
 * no business_id column and its foreign key is global.
 */
const PRODUCT_ROW = {
  id: PRODUCT_ID,
  business_id: BIZ_A,
  name: 'Basmati Rice 5kg',
  sku: 'RICE-5',
  category: 'grain',
  unit: 'box',
  cost_price_minor: 40000,
  selling_price_minor: 50000,
  currency: 'INR',
  current_stock: 100,
  reorder_point: 10,
  reorder_quantity: 50,
  status: 'active',
};



// ---------------------------------------------------------------------------
// Fake PostgREST client
// ---------------------------------------------------------------------------

type Filter = { column: string; value: unknown; op?: 'eq' | 'in' };

interface QueryLog {
  table: string;
  filters: Filter[];
}

const queries: QueryLog[] = [];
const writes: Array<{ table: string; operation: string; payload: unknown }> = [];
let rowsByTable: Record<string, unknown[]> = {};

/** Payloads actually written to `table`, so persistence can be asserted. */
function insertPayloads(table: string): Array<Record<string, unknown>> {
  return writes
    .filter((w) => w.table === table && w.operation === 'insert')
    .flatMap((w) => (Array.isArray(w.payload) ? w.payload : [w.payload])) as Array<
    Record<string, unknown>
  >;
}

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
    // `insert`/`update`/`upsert` record their payload so a test can assert what
    // was actually persisted — a fake that only answered reads could not tell a
    // tenant-scoped write from a mass-assigned one.
    builder[method] = vi.fn((payload?: unknown) => {
      if (payload !== undefined) {
        writes.push({ table, operation: method, payload });
      }
      return builder;
    });
  }

  for (const method of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is', 'ilike', 'or', 'not']) {
    builder[method] = vi.fn((column: string, value: unknown) => {
      log.filters.push({ column, value, op: 'eq' });
      return builder;
    });
  }

  // `.in()` is a membership test. Comparing the array to the row value made
  // every `in` query match nothing, which silently turned ownership checks
  // into "not found" rejections.
  builder.in = vi.fn((column: string, value: unknown) => {
    log.filters.push({ column, value, op: 'in' });
    return builder;
  });

  builder.order = vi.fn(() => builder);

  // PostgREST maps `.range(from, to)` to `limit = to - from + 1`, then clamps
  // that to the server's `max_rows`. Reproducing both is what makes a bounded
  // scan observable: a test can ask for more rows than the server will serve
  // and assert the repository notices.
  let rangeFrom = 0;
  let rangeTo = Number.MAX_SAFE_INTEGER;

  const serverMaxRows = POSTGREST_MAX_ROWS;

  builder.range = vi.fn((from: number, to: number) => {
    rangeFrom = from;
    rangeTo = to;
    return builder;
  });

  builder.limit = vi.fn((count: number) => {
    rangeFrom = 0;
    rangeTo = count - 1;
    return builder;
  });

  builder.offset = vi.fn((count: number) => {
    rangeFrom = count;
    return builder;
  });

  const rows = () => {
    const all = rowsByTable[table] ?? [];
    // Apply every recorded `eq` filter the way PostgREST would.
    //
    // `business_id` used to be exempt here, which meant the fake returned rows
    // from every tenant and the cross-tenant tests proved nothing: they
    // manufactured a 404 by emptying the table instead of by scoping. Enforcing
    // it is what makes "Business A cannot read Business B's transaction" an
    // actual assertion about the repository's tenant predicate rather than a
    // claim about the fixture.
    const matched = all.filter((row) =>
      log.filters.every((f) => {
        const actual = (row as Record<string, unknown>)[f.column];
        return f.op === 'in'
          ? Array.isArray(f.value) && f.value.includes(actual as never)
          : actual === f.value;
      }),
    );

    const requested = Math.min(rangeTo - rangeFrom + 1, serverMaxRows);
    return matched.slice(rangeFrom, rangeFrom + Math.max(0, requested));
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
  writes.length = 0;
  rowsByTable = {
    businesses: [BUSINESS_ROW],
    business_members: [membership('owner')],
    transactions: [TXN_ROW],
    transaction_items: [],
    // POST /transactions verifies each line item references a product owned by
    // this tenant, so the fixture must contain one.
    products: [PRODUCT_ROW],
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
// List query shape — the N+1 regression
// ---------------------------------------------------------------------------

describe('transaction list query shape', () => {
  function countQueriesFor(table: string): number {
    return queries.filter((q) => q.table === table).length;
  }

  function seedTransactions(count: number) {
    rowsByTable.transactions = Array.from({ length: count }, (_unused, index) => ({
      ...TXN_ROW,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }));
  }

  function seedItemsFor(count: number) {
    rowsByTable.transaction_items = Array.from({ length: count }, (_unused, index) => ({
      id: `item-${index}`,
      transaction_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      product_id: PRODUCT_ID,
      product_name: 'Test product',
      quantity: 1,
      unit_price_minor: 10000,
      discount_minor: 0,
      tax_minor: 1800,
      total_minor: 11800,
    }));
  }

  it('does not issue one line-item query per transaction', async () => {
    seedTransactions(40);
    seedItemsFor(40);

    const { GET } = await import('@/app/api/businesses/[businessId]/transactions/route');
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_A}/transactions?limit=100`),
      params(BIZ_A),
    );

    expect(res.status).toBe(200);
    // The old implementation issued 40 extra queries here. The batched loader
    // bounds them by the response cap instead of by the page size.
    expect(countQueriesFor('transaction_items')).toBeLessThan(10);
  });

  it('still returns every line item after batching', async () => {
    seedTransactions(12);
    seedItemsFor(12);

    const { GET } = await import('@/app/api/businesses/[businessId]/transactions/route');
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_A}/transactions?limit=100`),
      params(BIZ_A),
    );

    const body = (await res.json()) as { data: Array<{ items: unknown[] }> };
    expect(body.data).toHaveLength(12);
    // Truncation is the failure mode a naive `.in()` would introduce.
    for (const transaction of body.data) {
      expect(transaction.items).toHaveLength(1);
    }
  });

  it('costs a bounded number of item queries, not one per transaction', async () => {
    const { GET } = await import('@/app/api/businesses/[businessId]/transactions/route');

    // Item batches are sized against the server's row cap, so the count is
    // ceil(rows / ITEM_BATCH_SIZE) rather than rows. The point of the assertion
    // is that it is bounded by the cap and not by the page size.
    const batchSize = Math.floor(POSTGREST_MAX_ROWS / 200);
    expect(batchSize).toBeGreaterThan(1);

    seedTransactions(100);
    seedItemsFor(100);
    queries.length = 0;
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_A}/transactions?limit=100`),
      params(BIZ_A),
    );
    expect(res.status).toBe(200);

    expect(countQueriesFor('transaction_items')).toBe(Math.ceil(100 / batchSize));
    expect(countQueriesFor('transaction_items')).toBeLessThan(100);
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

    expect(res.status).toBe(201);
    expect(businessIdFilters()).not.toContain(BIZ_B);
    expect(businessIdFilters()).toContain(BIZ_A);
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant record access
// ---------------------------------------------------------------------------

describe('cross-tenant record access', () => {
  it('returns the caller their own record', async () => {
    const { GET } = await import('@/app/api/businesses/[businessId]/transactions/[id]/route');
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_A}/transactions/${TXN_ID}`),
      params(BIZ_A, { id: TXN_ID }),
    );

    // Positive control: without it, the negative case below could pass simply
    // because the fixture was empty.
    expect(res.status).toBe(200);
  });

  it('returns 404, not 403, when the record belongs to another tenant', async () => {
    // The row EXISTS — it is owned by BIZ_B. The only reason it must be
    // invisible is the repository's tenant predicate.
    rowsByTable.transactions = [{ ...TXN_ROW, business_id: BIZ_B }];

    const { GET } = await import('@/app/api/businesses/[businessId]/transactions/[id]/route');
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_A}/transactions/${TXN_ID}`),
      params(BIZ_A, { id: TXN_ID }),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.statusCode).toBe(404);
    // 404 rather than 403 so existence is not disclosed.
    expect(body.error.code).toBe('NOT_FOUND');
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
    expect(txnQuery?.filters).toContainEqual({ column: 'business_id', value: BIZ_A, op: 'eq' });
    expect(txnQuery?.filters).toContainEqual({ column: 'id', value: TXN_ID, op: 'eq' });
  });
});

// ---------------------------------------------------------------------------
// Mass assignment — the tripwire
// ---------------------------------------------------------------------------

describe('mass assignment tripwire', () => {
  /** Every field a client must never be able to set directly. */
  const SERVER_OWNED = ['businessId', 'business_id', 'createdBy', 'created_by', 'status', 'id'];

  function writeSchemas() {
    return [
      ['createTransactionSchema', createTransactionSchema, {
        type: 'sale',
        counterpartyType: 'customer',
        counterpartyId: 'cust-1',
        transactionDate: '2026-01-15T00:00:00.000Z',
        items: [{ productId: PRODUCT_ID, quantity: 1, unitPrice: 100 }],
      }],
      ['createExpenseSchema', createExpenseSchema, {
        category: 'rent',
        amount: 100,
        description: 'Rent',
        expenseDate: '2026-01-15T00:00:00.000Z',
      }],
      ['createDocumentSchema', createDocumentSchema, {
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
        fileSize: 1000,
        sourceType: 'invoice',
        storagePath: `${BIZ_A}/u/a.pdf`,
      }],
      ['recordMovementSchema', recordMovementSchema, {
        productId: PRODUCT_ID,
        type: 'sale',
        quantity: 1,
      }],
    ] as const;
  }

  it('strips every server-owned field a client adds to a write body', () => {
    // Zod strips unknown keys by default. That default is the only thing
    // preventing a caller from choosing its own tenant, author or status, and it
    // is one `.passthrough()` away from silently disappearing — so it is
    // asserted for every write schema rather than assumed.
    for (const [name, schema, valid] of writeSchemas()) {
      for (const field of SERVER_OWNED) {
        const parsed = schema.safeParse({ ...valid, [field]: 'attacker-supplied' });
        expect(parsed.success, `${name} rejected a body containing only valid fields plus ${field}`).toBe(true);
        if (parsed.success) {
          expect(
            Object.prototype.hasOwnProperty.call(parsed.data, field),
            `${name} let a client set ${field}`,
          ).toBe(false);
        }
      }
    }
  });

  it('never writes a client-supplied business id to the row', async () => {
    const { POST } = await import('@/app/api/businesses/[businessId]/transactions/route');

    const res = await POST(
      request(`https://api.test/api/businesses/${BIZ_A}/transactions`, {
        method: 'POST',
        body: {
          type: 'sale',
          counterpartyType: 'customer',
          counterpartyId: 'cust-1',
          transactionDate: '2026-01-15T00:00:00.000Z',
          items: [{ productId: PRODUCT_ID, quantity: 1, unitPrice: 100 }],
          businessId: BIZ_B,
          business_id: BIZ_B,
          createdBy: 'forged-user',
          status: 'completed',
        },
      }),
      params(BIZ_A),
    );

    // The request is well-formed, so it is accepted — the point is what is
    // persisted, not whether it is rejected.
    expect(res.status).toBe(201);

    const inserted = insertPayloads('transactions');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.business_id).toBe(BIZ_A);
    expect(inserted[0]!.status).toBe('draft');
  });
});

// ---------------------------------------------------------------------------
// State transitions at the HTTP boundary
// ---------------------------------------------------------------------------

describe('state transition routes', () => {
  function seedTransaction(status: string) {
    rowsByTable.transactions = [{ ...TXN_ROW, status }];
  }

  function seedDocument(status: string) {
    rowsByTable.documents = [
      {
        id: TXN_ID,
        business_id: BIZ_A,
        source_type: 'invoice',
        file_name: 'a.pdf',
        mime_type: 'application/pdf',
        file_size: 1000,
        storage_path: `${BIZ_A}/u/a.pdf`,
        status,
        original_name: 'a.pdf',
        content_hash: null,
        page_count: null,
        language: null,
        extraction_id: null,
        rejection_reason: null,
        tags: null,
        uploaded_by: USER_ID,
        uploaded_at: '2026-01-15T00:00:00.000Z',
        processed_at: null,
        updated_at: '2026-01-15T00:00:00.000Z',
      },
    ];
  }

  async function patchTransactionStatus(status: string) {
    const { PATCH } = await import('@/app/api/businesses/[businessId]/transactions/[id]/status/route');
    return PATCH(
      request(`https://api.test/api/businesses/${BIZ_A}/transactions/${TXN_ID}/status`, {
        method: 'PATCH',
        body: { status },
      }),
      params(BIZ_A, { id: TXN_ID }),
    );
  }

  it('applies a legal transaction transition', async () => {
    seedTransaction('draft');
    const res = await patchTransactionStatus('confirmed');
    expect(res.status).toBe(200);
  });

  it('refuses an illegal transaction transition as 422', async () => {
    seedTransaction('completed');
    const res = await patchTransactionStatus('draft');
    expect(res.status).toBe(422);
  });

  it('refuses to revive a voided transaction', async () => {
    seedTransaction('voided');
    const res = await patchTransactionStatus('confirmed');
    expect(res.status).toBe(422);
  });

  it('does not mutate a transaction owned by another tenant', async () => {
    rowsByTable.transactions = [{ ...TXN_ROW, business_id: BIZ_B }];
    const res = await patchTransactionStatus('confirmed');
    expect(res.status).toBe(404);
  });

  it('rejects an unknown status value at the boundary', async () => {
    seedTransaction('draft');
    const res = await patchTransactionStatus('archived');
    expect(res.status).toBe(400);
  });

  it('applies a legal document approval', async () => {
    seedDocument('review_required');
    const { POST } = await import('@/app/api/businesses/[businessId]/documents/[id]/approve/route');
    const res = await POST(
      request(`https://api.test/api/businesses/${BIZ_A}/documents/${TXN_ID}/approve`, { method: 'POST' }),
      params(BIZ_A, { id: TXN_ID }),
    );
    expect(res.status).toBe(200);
  });

  it('refuses to approve an already-rejected document', async () => {
    seedDocument('rejected');
    const { POST } = await import('@/app/api/businesses/[businessId]/documents/[id]/approve/route');
    const res = await POST(
      request(`https://api.test/api/businesses/${BIZ_A}/documents/${TXN_ID}/approve`, { method: 'POST' }),
      params(BIZ_A, { id: TXN_ID }),
    );
    expect(res.status).toBe(422);
  });

  it('requires a reason when rejecting a document', async () => {
    seedDocument('review_required');
    const { POST } = await import('@/app/api/businesses/[businessId]/documents/[id]/reject/route');

    const missing = await POST(
      request(`https://api.test/api/businesses/${BIZ_A}/documents/${TXN_ID}/reject`, {
        method: 'POST',
        body: {},
      }),
      params(BIZ_A, { id: TXN_ID }),
    );
    expect(missing.status).toBe(400);

    const supplied = await POST(
      request(`https://api.test/api/businesses/${BIZ_A}/documents/${TXN_ID}/reject`, {
        method: 'POST',
        body: { reason: 'illegible' },
      }),
      params(BIZ_A, { id: TXN_ID }),
    );
    expect(supplied.status).toBe(200);
  });

  it('does not approve a document owned by another tenant', async () => {
    seedDocument('review_required');
    rowsByTable.documents = [{ ...(rowsByTable.documents[0] as Record<string, unknown>), business_id: BIZ_B }];
    const { POST } = await import('@/app/api/businesses/[businessId]/documents/[id]/approve/route');
    const res = await POST(
      request(`https://api.test/api/businesses/${BIZ_A}/documents/${TXN_ID}/approve`, { method: 'POST' }),
      params(BIZ_A, { id: TXN_ID }),
    );
    expect(res.status).toBe(404);
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

// ---------------------------------------------------------------------------
// Business record and roster are administrative, not member-wide
// ---------------------------------------------------------------------------

describe('administrative reads', () => {
  it('refuses the business record — which carries PAN and GSTIN — from staff', async () => {
    setMembership('staff');
    const { GET } = await import('@/app/api/businesses/[businessId]/route');
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_A}`),
      params(BIZ_A),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
    // The tax identifiers must not appear anywhere in the refusal.
    expect(JSON.stringify(body)).not.toContain('gstin');
    expect(JSON.stringify(body)).not.toContain('pan');
  });

  it('refuses the membership roster from staff', async () => {
    setMembership('staff');
    const { GET } = await import('@/app/api/businesses/[businessId]/members/route');
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_A}/members`),
      params(BIZ_A),
    );

    expect(res.status).toBe(403);
  });

  it('refuses both from a manager, who holds no settings permission', async () => {
    setMembership('manager');

    const business = await import('@/app/api/businesses/[businessId]/route');
    const members = await import('@/app/api/businesses/[businessId]/members/route');

    const a = await business.GET(request(`https://api.test/api/businesses/${BIZ_A}`), params(BIZ_A));
    const b = await members.GET(
      request(`https://api.test/api/businesses/${BIZ_A}/members`),
      params(BIZ_A),
    );

    expect(a.status).toBe(403);
    expect(b.status).toBe(403);
  });

  it('allows an owner to read both', async () => {
    setMembership('owner');

    const business = await import('@/app/api/businesses/[businessId]/route');
    const members = await import('@/app/api/businesses/[businessId]/members/route');

    const a = await business.GET(request(`https://api.test/api/businesses/${BIZ_A}`), params(BIZ_A));
    const b = await members.GET(
      request(`https://api.test/api/businesses/${BIZ_A}/members`),
      params(BIZ_A),
    );

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });

  it('lists the caller their own businesses without exposing tax identifiers', async () => {
    const { GET } = await import('@/app/api/businesses/route');
    const res = await GET(request('https://api.test/api/businesses'), params(undefined));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    // This list runs BEFORE a tenant is chosen, so it must be projected down.
    for (const entry of body.data) {
      expect(Object.keys(entry).sort()).toEqual(['id', 'name', 'status', 'type']);
    }
  });
});

// ---------------------------------------------------------------------------
// Bounded scans
// ---------------------------------------------------------------------------

describe('bounded scan overflow', () => {
  it('refuses to value an inventory catalogue larger than the scan limit', async () => {
    // `max_rows` is 1000. Overflow must be reported rather than producing a
    // total computed from whatever the server happened to return.
    rowsByTable.products = Array.from({ length: POSTGREST_MAX_ROWS + 50 }, (_, i) => ({
      ...PRODUCT_ROW,
      id: `ffffffff-ffff-4fff-8fff-${String(i).padStart(12, '0')}`,
    }));

    const { GET } = await import('@/app/api/businesses/[businessId]/inventory/value/route');
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_A}/inventory/value`),
      params(BIZ_A),
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(body.error.details.truncated).toBe(true);
  });

  it('still returns a valuation when the catalogue fits', async () => {
    rowsByTable.products = [PRODUCT_ROW];

    const { GET } = await import('@/app/api/businesses/[businessId]/inventory/value/route');
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_A}/inventory/value`),
      params(BIZ_A),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    // Positive control: without it the 422 above could pass on a broken route.
    expect(body.data.productCount).toBe(1);
  });
});

describe('pagination hardening', () => {
  it('clamps an oversized limit to the maximum page size', async () => {
    const { GET } = await import('@/app/api/businesses/[businessId]/transactions/route');
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_A}/transactions?limit=9999`),
      params(BIZ_A),
    );

    expect(res.status).toBe(200);
    // The old assertion was `status === 200`, which the clamp being deleted
    // entirely would still satisfy.
    const body = await res.json();
    expect(body.meta.limit).toBe(MAX_PAGE_SIZE);
  });

  it('clamps an absurd page number so the offset scan stays bounded', async () => {
    const { GET } = await import('@/app/api/businesses/[businessId]/transactions/route');
    const res = await GET(
      request(`https://api.test/api/businesses/${BIZ_A}/transactions?page=999999999&limit=100`),
      params(BIZ_A),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.page).toBe(MAX_PAGE_NUMBER);
    expect(body.meta.page).toBeLessThan(999999999);
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