import type { Metadata } from "next";

import { CapabilityPanel } from "@/components/common/data-state";
import { FreshnessLine } from "@/components/common/freshness";
import { MetricCard } from "@/components/common/metric-card";
import { PageHeader, SectionHeader } from "@/components/common/page-header";
import { PayablesTable } from "@/components/suppliers/payables-table";
import {
  PARAM,
  PAYABLE_STATUS_VALUES,
  readEnum,
  readPageNumber,
  readPageSize,
  type RawSearchParams,
} from "@/components/data/params";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { getPayableTotals, listPayables, listSuppliers } from "@/lib/api/endpoints";
import { pendingCapability } from "@/lib/api/pending";
import { settle } from "@/lib/api/settle";
import { safeLabel } from "@/lib/format/labels";
import { formatMoney } from "@/lib/format/money";
import type { CurrencyCode } from "@/lib/types";

export const metadata: Metadata = { title: "Money you owe" };

export default async function PayablesPage({
  searchParams,
}: {
  readonly searchParams: Promise<RawSearchParams>;
}) {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  const params = await searchParams;
  const page = readPageNumber(params);
  const limit = readPageSize(params);
  const status = readEnum(params, PARAM.status, PAYABLE_STATUS_VALUES);

  const businessId = context.activeBusinessId;
  const loadedAt = new Date();
  const currency: CurrencyCode = "INR";

  const payablesRequest = settle(listPayables(businessId, { page, limit, status }));
  const totalsRequest = settle(getPayableTotals(businessId));
  const namesRequest = settle(listSuppliers(businessId, { page: 1, limit: 100 }));

  const [payables, totals, names] = await Promise.all([
    payablesRequest,
    totalsRequest,
    namesRequest,
  ]);

  const supplierNames = new Map<string, string>(
    (names.ok ? names.value.items : []).map((supplier) => [
      supplier.id,
      safeLabel(supplier.name),
    ]),
  );

  return (
    <>
      <PageHeader
        context={context.activeBusiness.name}
        title="Money you owe"
        description="Every unpaid bill, when it was due, and whether it is late. Totals come from your records."
        toolbar={<FreshnessLine updatedAt={loadedAt} />}
      />

      <section aria-labelledby="payable-totals" className="flex flex-col gap-3">
        <h2 id="payable-totals" className="sr-only">
          Totals
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <MetricCard
            label="Total outstanding"
            value={totals.ok ? formatMoney({ amount: totals.value.total, currency }) : "—"}
            hint="Everything you owe, whether due or not."
          />
          <MetricCard
            label="Past its due date"
            tone={totals.ok && totals.value.overdue > 0 ? "negative" : "positive"}
            value={totals.ok ? formatMoney({ amount: totals.value.overdue, currency }) : "—"}
            hint="Bills that need paying now."
          />
        </div>
      </section>

      <section aria-labelledby="payable-list" className="flex flex-col gap-3">
        <SectionHeader
          id="payable-list"
          title="Bills"
          description="Use the tabs to focus on what is overdue before anything else."
        />
        <PayablesTable result={payables} currency={currency} supplierNames={supplierNames} />
      </section>

      <CapabilityPanel capability={pendingCapability("cashFlow")} />
    </>
  );
}
