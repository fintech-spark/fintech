import type { Metadata } from "next";
import { Receipt, ArrowLeft } from "lucide-react";
import Link from "next/link";

import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { getExpense } from "@/lib/api/endpoints";
import { settle } from "@/lib/api/settle";
import { notFound } from "next/navigation";
import { ErrorPanel } from "@/components/common/data-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { describeStatus, EXPENSE_STATUS, EXPENSE_CATEGORY } from "@/lib/format/status";
import { formatMoney } from "@/lib/format/money";
import { formatDate } from "@/lib/format/dates";
import { safeLabel } from "@/lib/format/labels";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `Expense ${id.slice(0, 8)}` };
}

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  const { id: expenseId } = await params;
  const businessId = context.activeBusinessId;
  const request = settle(getExpense(businessId, expenseId));
  const [result] = await Promise.all([request]);

  if (!result.ok) {
    if (result.error.isNotFound) notFound();
    return (
      <div className="grid gap-4">
        <PageHeader
          title="Expense"
          description="Could not load this expense."
          toolbar={
            <Link
              href="/expenses"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" /> Back
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

  return (
    <>
      <PageHeader
        title="Expense"
        description={safeLabel(e.description) || "Expense detail"}
        toolbar={
          <div className="flex items-center gap-2">
            <Link
              href="/expenses"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" /> All expenses
            </Link>
            <Badge variant="outline" className="gap-1.5">
              <Receipt aria-hidden="true" className="size-3" />
              {e.id.slice(0, 8)}
            </Badge>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span>Details</span>
              <StatusBadge descriptor={status} size="sm" />
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Amount</span>
              <span className="text-lg font-semibold">{formatMoney(e.amount)}</span>
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
              <span className="text-muted-foreground">Reference</span>
              <span>{safeLabel(e.reference) || "—"}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Created</span>
              <span>{formatDate(e.createdAt)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Updated</span>
              <span>{formatDate(e.updatedAt)}</span>
            </div>
            {e.isRecurring && e.recurringConfig && (
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                Recurring: {e.recurringConfig.frequency}, next due{" "}
                {formatDate(e.recurringConfig.nextDueDate)}
                {e.recurringConfig.endDate ? `, ends ${formatDate(e.recurringConfig.endDate)}` : ""}
              </div>
            )}
            {e.description && (
              <div className="pt-2 text-muted-foreground">
                {e.description}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">State</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <ul className="flex flex-col gap-2">
              <li>
                <span className="text-muted-foreground">Status</span>{" "}
                <span className="font-medium">{status.label}</span>
              </li>
              <li>
                <span className="text-muted-foreground">Approval</span>{" "}
                <span className="font-medium">{e.status === "approved" || e.status === "paid" ? "Confirmed" : "Pending"}</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
