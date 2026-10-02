import { withApi } from '@/lib/http/handler';
import { parseJsonBody } from '@/lib/http/params';
import { resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';
import { createExpenseSchema } from '@/lib/validation/api-schemas';

/**
 * POST /api/expenses — integer minor units only.
 */
export const POST = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  const { expenses } = wireClient(db as never);
  const body = await parseJsonBody(request, createExpenseSchema);
  return {
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
