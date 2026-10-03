import type { Metadata } from "next";
import { FreshnessLine } from "@/components/common/freshness";
import { MetricCard } from "@/components/common/metric-card";
import { PageHeader, SectionHeader } from "@/components/common/page-header";
import { ExpensesTable } from "@/components/expenses/expenses-table";
import {
  PARAM,
  readEnum,
  readPageNumber,
  readPageSize,
  type RawSearchParams,
} from "@/components/data/params";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { listExpenses } from "@/lib/api/endpoints";
import { settle } from "@/lib/api/settle";
import { formatMoney, formatCount } from "@/lib/format/money";

export const metadata: Metadata = { title: "Expenses" };

export default async function ExpensesPage({
  searchParams,
}: {
  readonly searchParams: Promise<RawSearchParams>;
}) {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  const params = await searchParams;
  const page = readPageNumber(params);
  const limit = readPageSize(params);
  const category = params[PARAM.category] as string | undefined;
  const status = readEnum(params, PARAM.status, ["pending", "approved", "rejected", "paid"] as const);

  const businessId = context.activeBusinessId;
  const loadedAt = new Date();

  const expensesResult = await settle(
    listExpenses(businessId, { page, limit, category, status }),
  );

  let totalExpenseMinor = 0;
  let pendingCount = 0;

  if (expensesResult.ok) {
    for (const exp of expensesResult.value.items) {
      if (exp.status !== "rejected") {
        totalExpenseMinor += exp.amount.amount;
      }
      if (exp.status === "pending") {
        pendingCount += 1;
      }
    }
  }

  return (
    <>
      <PageHeader
        context={context.activeBusiness.name}
        title="Expenses"
        description="Operating costs, overheads and supplies recorded for your business."
        toolbar={<FreshnessLine updatedAt={loadedAt} />}
      />

      <section aria-labelledby="expenses-summary" className="flex flex-col gap-3">
        <h2 id="expenses-summary" className="sr-only">
          Expenses summary
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard
            label="Total Expenses"
            tone="default"
            value={
              expensesResult.ok
                ? formatMoney({ amount: totalExpenseMinor, currency: "INR" })
                : "—"
            }
            hint="Sum of non-rejected expenses in current view."
          />
          <MetricCard
            label="Expense Records"
            value={expensesResult.ok ? formatCount(expensesResult.value.total, "expense") : "—"}
            hint="Total expenses registered on the ledger."
          />
          <MetricCard
            label="Pending Approval"
            tone={pendingCount > 0 ? "caution" : "positive"}
            value={expensesResult.ok ? `${pendingCount}` : "—"}
            hint="Awaiting manager or owner confirmation."
          />
        </div>
      </section>

      <section aria-labelledby="expenses-list" className="flex flex-col gap-3">
        <SectionHeader
          id="expenses-list"
          title="Expense Ledger"
          description="Filter by category or approval status. Click Record Expense to add a new receipt or bill."
        />
        <ExpensesTable
          result={expensesResult}
          businessId={businessId}
        />
      </section>
    </>
  );
}
