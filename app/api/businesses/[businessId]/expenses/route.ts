import { withApi } from '@/lib/http/handler';
import { parseJsonBody, parsePagination, parseEnum, dateRangeArgs } from '@/lib/http/params';
import { assertPermission, resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';
import { createExpenseSchema } from '@/lib/validation/api-schemas';

const EXPENSE_CATEGORIES = [
  'rent',
  'utilities',
  'salaries',
  'supplies',
  'marketing',
  'transportation',
  'insurance',
  'maintenance',
  'taxes',
  'fees',
  'other',
] as const;

const EXPENSE_STATUSES = ['pending', 'approved', 'rejected', 'paid'] as const;

/**
 * POST /api/expenses — integer minor units only.
 */
export const POST = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'expenses:write');
  const { expenses } = wireClient(db);
  const body = await parseJsonBody(request, createExpenseSchema);
  return {
    status: 201,
    data: await expenses.create(ctx, {
      category: body.category,
      amount: body.amount,
      currency: body.currency,
      description: body.description,
      vendor: body.vendor,
      reference: body.reference,
      expenseDate: new Date(body.expenseDate),
      isRecurring: body.isRecurring,
      recurringFrequency: body.recurringFrequency,
      recurringNextDueDate: body.recurringNextDueDate ? new Date(body.recurringNextDueDate) : undefined,
    } as never),
  };
});

/**
 * GET /api/expenses — one page of the tenant's expenses.
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'expenses:read');
  const { expenses } = wireClient(db);
  const sp = new URL(request.url).searchParams;
  const pagination = parsePagination(sp);

  const category = parseEnum(sp.get('category'), EXPENSE_CATEGORIES, 'category');
  const status = parseEnum(sp.get('status'), EXPENSE_STATUSES, 'status');

  const result = await expenses.list(ctx, {
    page: pagination.page,
    limit: pagination.limit,
    ...(category ? { category } : {}),
    ...(status ? { status } : {}),
    ...dateRangeArgs(sp),
  });

  return {
    data: result.items,
    meta: {
      total: result.total,
      page: result.page,
      limit: result.limit,
      hasMore: result.hasMore,
    },
  };
});
