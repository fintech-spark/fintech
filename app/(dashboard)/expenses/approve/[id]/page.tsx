import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { getExpense } from "@/lib/api/endpoints";
import { settle } from "@/lib/api/settle";
import { notFound } from "next/navigation";
import { ErrorPanel } from "@/components/common/data-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { describeStatus, EXPENSE_STATUS, EXPENSE_CATEGORY } from "@/lib/format/status";
import { formatMoney } from "@/lib/format/money";
import { formatDate } from "@/lib/format/dates";
import { safeLabel } from "@/lib/format/labels";
import { ExpenseApproveForm } from "@/components/expenses/expense-approve-form";

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  return { title: `Approve expense ${params.id.slice(0, 8)}` };
}

export default async function ExpenseApprovePage({
  params,
}: {
  params: { id: string };
}) {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  const businessId = context.activeBusinessId;
  const expenseId = params.id;
  const request = settle(getExpense(businessId, expenseId));
  const [result] = await Promise.all([request]);

  if (!result.ok) {
    if (result.error.isNotFound) notFound();
    return (
      <div className="grid gap-4">
        <PageHeader
          title="Approve expense"
          description="Could not load the expense to approve."
          toolbar={
            <Link
              href="/expenses"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" /> All expenses
            </Link>
          }
        />
        <ErrorPanel error={result.error} variant="card" />
      </div>
    );
  }

  const e = result.value;
  const status = describeStatus(EXPENSE_STATUS, e.status);
  const category = describeStatus(EXPENSE_CATEGORY, e.category);
  const canApprove = e.status === "pending" || e.status === "approved";

  return (
    <>
      <PageHeader
        title="Approve expense"
        description={safeLabel(e.description) || "Confirm this expense."}
        toolbar={
          <Link
            href={`/expenses/${e.id}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Details
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Expense</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Amount</span>
              <span className="text-xl font-semibold">{formatMoney(e.amount)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Category</span>
              <span>{category.label}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Vendor</span>
              <span>{safeLabel(e.vendor) || "—"}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Date</span>
              <span>{formatDate(e.expenseDate)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Status</span>
              <StatusBadge descriptor={status} size="sm" />
            </div>
            {e.description && (
              <div className="pt-2 text-muted-foreground">{e.description}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Confirmation</CardTitle>
          </CardHeader>
          <CardContent>
            <ExpenseApproveForm
              businessId={businessId}
              expenseId={e.id}
              canApprove={canApprove}
              currentStatusLabel={status.label}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
