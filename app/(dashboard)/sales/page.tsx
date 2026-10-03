import type { Metadata } from "next";
import { FreshnessLine } from "@/components/common/freshness";
import { MetricCard } from "@/components/common/metric-card";
import { PageHeader, SectionHeader } from "@/components/common/page-header";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import {
  PARAM,
  readEnum,
  readPageNumber,
  readPageSize,
  type RawSearchParams,
} from "@/components/data/params";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { listTransactions } from "@/lib/api/endpoints";
import { settle } from "@/lib/api/settle";
import { formatMoney, formatCount } from "@/lib/format/money";

export const metadata: Metadata = { title: "Sales" };

export default async function SalesPage({
  searchParams,
}: {
  readonly searchParams: Promise<RawSearchParams>;
}) {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  const params = await searchParams;
  const page = readPageNumber(params);
  const limit = readPageSize(params);
  const type = readEnum(params, "type", ["sale", "purchase", "payment", "refund"] as const);
  const status = readEnum(params, PARAM.status, ["draft", "confirmed", "completed", "voided"] as const);

  const businessId = context.activeBusinessId;
  const loadedAt = new Date();

  const transactionsResult = await settle(
    listTransactions(businessId, { page, limit, type, status }),
  );

  let totalRevenueMinor = 0;
  let salesCount = 0;

  if (transactionsResult.ok) {
    for (const tx of transactionsResult.value.items) {
      if (tx.type === "sale" && tx.status !== "voided") {
        totalRevenueMinor += tx.total.amount;
        salesCount += 1;
      }
    }
  }

  const avgOrderValueMinor = salesCount > 0 ? Math.round(totalRevenueMinor / salesCount) : 0;

  return (
    <>
      <PageHeader
        context={context.activeBusiness.name}
        title="Sales & Transactions"
        description="Every sale, purchase and transaction recorded on your ledger, with deterministic arithmetic."
        toolbar={<FreshnessLine updatedAt={loadedAt} />}
      />

      <section aria-labelledby="sales-summary" className="flex flex-col gap-3">
        <h2 id="sales-summary" className="sr-only">
          Sales summary
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard
            label="Total Sales Volume"
            tone="positive"
            value={
              transactionsResult.ok
                ? formatMoney({ amount: totalRevenueMinor, currency: "INR" })
                : "—"
            }
            hint="Recorded sale transactions in the current view."
          />
          <MetricCard
            label="Transactions Count"
            value={transactionsResult.ok ? formatCount(transactionsResult.value.total, "transaction") : "—"}
            hint="Total records matching current criteria."
          />
          <MetricCard
            label="Average Order Value"
            value={
              salesCount > 0
                ? formatMoney({ amount: avgOrderValueMinor, currency: "INR" })
                : "—"
            }
            hint="Mean value of completed sales."
          />
        </div>
      </section>

      <section aria-labelledby="sales-list" className="flex flex-col gap-3">
        <SectionHeader
          id="sales-list"
          title="Ledger"
          description="Filter by type or status. Click Record Sale to add a transaction directly."
        />
        <TransactionsTable
          result={transactionsResult}
          businessId={businessId}
        />
      </section>
    </>
  );
}
