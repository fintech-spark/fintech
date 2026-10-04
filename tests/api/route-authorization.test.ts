// Security regression: route-level authorization on the customer, supplier,
// expense, transaction, inventory and settings routes.
//
// These handlers previously called `resolveTenantContext` (membership check)
// but never `assertPermission`, so ANY active member of the tenant could reach
// them. Under the authoritative matrix in `lib/http/auth-context.ts` `staff` is
// read-only and holds no `expenses:write`, `transactions:write`,
// `inventory:write` or `settings:write`, and no `customers:read` or
// `suppliers:read`. That made it a vertical-privilege-escalation gap: a staff
// account could create expenses and transactions, approve an expense, change a
// transaction status and rewrite business settings.
//
// The tests assert real HTTP status codes through the real `withApi` pipeline,
// so they fail if a guard is deleted, weakened or moved after data access.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const BIZ_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BIZ_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PRODUCT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ENTITY_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

let currentMemberRole = 'owner';
let membershipBusinesses = [BIZ_A];

vi.mock('@/lib/supabase/server-client', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: USER_ID, email: 'user@example.test' } },
        error: null,
      })),
    },
    rpc: vi.fn(async (fn: string) =>
      fn === 'auth_user_businesses'
        ? { data: membershipBusinesses, error: null }
        : { data: null, error: null },
    ),
    from: vi.fn((table: string) => {
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'insert', 'update', 'delete']) builder[m] = vi.fn(() => builder);
      for (const m of ['eq', 'neq', 'in', 'order', 'range', 'limit']) builder[m] = vi.fn(() => builder);
      const member = { business_id: BIZ_A, user_id: USER_ID, role: currentMemberRole, status: 'active' };
      builder.single = vi.fn(async () => ({ data: table === 'business_members' ? member : null, error: null }));
      builder.maybeSingle = vi.fn(async () => ({ data: table === 'business_members' ? member : null, error: null }));
      builder.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data: table === 'business_members' ? [member] : [],
          error: null,
        }).then(resolve);
      return builder;
    }),
  })),
}));

// Wire every domain service the guarded routes reach. Authorization is asserted
// before these run, so a 403 must never touch them; the counters below prove it.
const calls = {
  expenseCreate: 0,
  expenseApprove: 0,
  transactionCreate: 0,
  transactionStatus: 0,
  inventoryMovement: 0,
  settingsUpdate: 0,
  customerList: 0,
  supplierList: 0,
};

const paginated = { items: [], total: 0, page: 1, limit: 20, hasMore: false };

vi.mock('@/lib/http/wiring', () => ({
  wireClient: vi.fn(() => ({
    db: {},
    transactions: {
      create: vi.fn(async () => {
        calls.transactionCreate += 1;
        return { id: 'tx-1', businessId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
      }),
      list: vi.fn(async () => paginated),
      getById: vi.fn(async () => ({ id: 'tx-1' })),
      updateStatus: vi.fn(async () => {
        calls.transactionStatus += 1;
        return { id: 'tx-1', status: 'completed' };
      }),
      checkDuplicate: vi.fn(async () => null),
    },
    expenses: {
      create: vi.fn(async () => {
        calls.expenseCreate += 1;
        return { id: 'ex-1' };
      }),
      list: vi.fn(async () => paginated),
      getById: vi.fn(async () => ({ id: 'ex-1' })),
      approve: vi.fn(async () => {
        calls.expenseApprove += 1;
        return { id: 'ex-1', status: 'approved' };
      }),
    },
    inventory: {
      recordMovement: vi.fn(async () => {
        calls.inventoryMovement += 1;
        return { id: 'mv-1' };
      }),
      listProducts: vi.fn(async () => paginated),
      getProduct: vi.fn(async () => ({ id: PRODUCT_ID })),
      getLowStockProducts: vi.fn(async () => []),
      getInventoryValue: vi.fn(async () => ({ valueMinor: 0, currency: 'INR' })),
    },
    customers: {
      list: vi.fn(async () => {
        calls.customerList += 1;
        return paginated;
      }),
      getById: vi.fn(async () => ({ id: ENTITY_ID })),
      getBalance: vi.fn(async () => ({ outstandingMinor: 0, currency: 'INR' })),
      getReceivables: vi.fn(async () => []),
      getTotalReceivables: vi.fn(async () => ({ totalMinor: 0, currency: 'INR' })),
    },
    suppliers: {
      list: vi.fn(async () => {
        calls.supplierList += 1;
        return paginated;
      }),
      getById: vi.fn(async () => ({ id: ENTITY_ID })),
      getPricing: vi.fn(async () => []),
      getPayables: vi.fn(async () => []),
      getTotalPayables: vi.fn(async () => ({ totalMinor: 0, currency: 'INR' })),
    },
    documents: {},
    businesses: {
      updateSettings: vi.fn(async () => {
        calls.settingsUpdate += 1;
        return { currency: 'INR' };
      }),
    },
  })),
  wireIntelligence: vi.fn(() => ({})),
}));

import { POST as postExpense } from '@/app/api/businesses/[businessId]/expenses/route';
import { GET as getExpenses } from '@/app/api/businesses/[businessId]/expenses/route';
import { POST as approveExpense } from '@/app/api/businesses/[businessId]/expenses/[id]/approve/route';
import { POST as postTransaction } from '@/app/api/businesses/[businessId]/transactions/route';
import { PATCH as patchTransactionStatus } from '@/app/api/businesses/[businessId]/transactions/[id]/status/route';
import { POST as postMovement } from '@/app/api/businesses/[businessId]/inventory/movements/route';
import { PATCH as patchSettings } from '@/app/api/businesses/[businessId]/settings/route';
import { GET as getCustomers } from '@/app/api/businesses/[businessId]/customers/route';
import { GET as getSuppliers } from '@/app/api/businesses/[businessId]/suppliers/route';

// `withApi` resolves `route.params`, so params must be a Promise, exactly as
// Next.js supplies them. Authentication uses the same bearer header the real
// client sends; a missing token must still yield 401.
function makeReq(
  path: string,
  options: { method?: string; token?: string | null; body?: unknown } = {},
): Request {
  const headers = new Headers();
  const token = options.token === undefined ? 'valid-token' : options.token;
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`http://localhost:3000/api/businesses/${BIZ_A}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

function post(path: string, body: unknown, token?: string | null): Request {
  return makeReq(path, { method: 'POST', body, ...(token === undefined ? {} : { token }) });
}

function patch(path: string, body: unknown, token?: string | null): Request {
  return makeReq(path, { method: 'PATCH', body, ...(token === undefined ? {} : { token }) });
}

function get(path: string, token?: string | null): Request {
  return makeReq(path, { ...(token === undefined ? {} : { token }) });
}

const route = { params: Promise.resolve({ businessId: BIZ_A }) } as never;
const routeWithId = (id: string) =>
  ({ params: Promise.resolve({ businessId: BIZ_A, id }) }) as never;

const expenseBody = {
  category: 'rent',
  amount: 50000,
  description: 'Shop rent for October',
  expenseDate: '2026-10-01T00:00:00.000Z',
};

const transactionBody = {
  type: 'sale',
  counterpartyType: 'customer',
  counterpartyId: 'cust-1',
  items: [{ productId: PRODUCT_ID, quantity: 2, unitPrice: 15000 }],
  transactionDate: '2026-10-01T00:00:00.000Z',
};

const movementBody = { productId: PRODUCT_ID, type: 'adjustment', quantity: 1 };

beforeEach(() => {
  currentMemberRole = 'owner';
  membershipBusinesses = [BIZ_A];
  for (const key of Object.keys(calls) as (keyof typeof calls)[]) calls[key] = 0;
});

describe('write routes deny roles without the write permission', () => {
  it('denies staff creating an expense and never reaches the service', async () => {
    currentMemberRole = 'staff';
    const res = await postExpense(post('/expenses', expenseBody), route);
    expect(res.status).toBe(403);
    expect(calls.expenseCreate).toBe(0);
  });

  it('denies staff approving an expense and never reaches the service', async () => {
    currentMemberRole = 'staff';
    const res = await approveExpense(
      post(`/expenses/${ENTITY_ID}/approve`, {}),
      routeWithId(ENTITY_ID),
    );
    expect(res.status).toBe(403);
    expect(calls.expenseApprove).toBe(0);
  });

  it('denies staff creating a transaction and never reaches the service', async () => {
    currentMemberRole = 'staff';
    const res = await postTransaction(post('/transactions', transactionBody), route);
    expect(res.status).toBe(403);
    expect(calls.transactionCreate).toBe(0);
  });

  it('denies staff changing a transaction status and never reaches the service', async () => {
    currentMemberRole = 'staff';
    const res = await patchTransactionStatus(
      patch(`/transactions/${ENTITY_ID}/status`, { status: 'completed' }),
      routeWithId(ENTITY_ID),
    );
    expect(res.status).toBe(403);
    expect(calls.transactionStatus).toBe(0);
  });

  it('denies staff recording an inventory movement and never reaches the service', async () => {
    currentMemberRole = 'staff';
    const res = await postMovement(post('/inventory/movements', movementBody), route);
    expect(res.status).toBe(403);
    expect(calls.inventoryMovement).toBe(0);
  });

  it('denies a manager rewriting business settings (settings:write is owner/admin)', async () => {
    currentMemberRole = 'manager';
    const res = await patchSettings(patch('/settings', { currency: 'USD' }), route);
    expect(res.status).toBe(403);
    expect(calls.settingsUpdate).toBe(0);
  });
});

describe('read routes deny roles without the read permission', () => {
  it('denies staff reading customers', async () => {
    currentMemberRole = 'staff';
    const res = await getCustomers(get('/customers'), route);
    expect(res.status).toBe(403);
    expect(calls.customerList).toBe(0);
  });

  it('denies staff reading suppliers', async () => {
    currentMemberRole = 'staff';
    const res = await getSuppliers(get('/suppliers'), route);
    expect(res.status).toBe(403);
    expect(calls.supplierList).toBe(0);
  });

  it('denies staff reading expenses', async () => {
    currentMemberRole = 'staff';
    const res = await getExpenses(get('/expenses'), route);
    expect(res.status).toBe(403);
  });
});

describe('permitted roles still succeed (no over-blocking)', () => {
  it('lets the owner create an expense', async () => {
    const res = await postExpense(post('/expenses', expenseBody), route);
    expect(res.status).toBe(201);
    expect(calls.expenseCreate).toBe(1);
  });

  it('lets a manager create an expense', async () => {
    currentMemberRole = 'manager';
    const res = await postExpense(post('/expenses', expenseBody), route);
    expect(res.status).toBe(201);
  });

  it('lets an accountant create a transaction', async () => {
    currentMemberRole = 'accountant';
    const res = await postTransaction(post('/transactions', transactionBody), route);
    expect(res.status).toBe(201);
  });

  it('lets staff read transactions (matrix grants transactions:read)', async () => {
    currentMemberRole = 'staff';
    const res = await getCustomers(get('/customers'), route);
    expect(res.status).toBe(403); // sanity: customers denied
    const txRes = await (await import('@/app/api/businesses/[businessId]/transactions/route')).GET(
      get('/transactions'),
      route,
    );
    expect(txRes.status).toBe(200);
  });

  it('lets an admin rewrite settings (admin holds settings:write)', async () => {
    currentMemberRole = 'admin';
    const res = await patchSettings(patch('/settings', { currency: 'USD' }), route);
    expect(res.status).toBe(200);
    expect(calls.settingsUpdate).toBe(1);
  });
});

describe('tenant derivation still holds on guarded routes', () => {
  it('denies a member of another business with 403', async () => {
    membershipBusinesses = [BIZ_B];
    const res = await postExpense(post('/expenses', expenseBody), route);
    expect(res.status).toBe(403);
    expect(calls.expenseCreate).toBe(0);
  });

  it('denies an unauthenticated caller with 401', async () => {
    const res = await postExpense(post('/expenses', expenseBody, null), route);
    expect(res.status).toBe(401);
  });
});
