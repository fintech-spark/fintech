import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CircleDollarSign } from "lucide-react";

import { FreshnessLine } from "@/components/common/freshness";
import { MetricCard } from "@/components/common/metric-card";
import { PageHeader, SectionHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SuppliersTable } from "@/components/suppliers/suppliers-table";
import {
  PARAM,
  PARTNER_STATUS_VALUES,
  readEnum,
  readPageNumber,
  readPageSize,
  readParam,
  type RawSearchParams,
} from "@/components/data/params";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { getPayableTotals, listSuppliers } from "@/lib/api/endpoints";
import { settle } from "@/lib/api/settle";
import { formatMoney } from "@/lib/format/money";
import type { CurrencyCode } from "@/lib/types";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage({
  searchParams,
}: {
  readonly searchParams: Promise<RawSearchParams>;
}) {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  const params = await searchParams;
  const page = readPageNumber(params);
  const limit = readPageSize(params);
  const search = readParam(params, PARAM.search, 80);
  const status = readEnum(params, PARAM.status, PARTNER_STATUS_VALUES);

  const businessId = context.activeBusinessId;
  const loadedAt = new Date();
  const currency: CurrencyCode = "INR";

  const suppliersRequest = settle(
    listSuppliers(businessId, { page, limit, search, status }),
  );
  const totalsRequest = settle(getPayableTotals(businessId));
  const [suppliers, totals] = await Promise.all([suppliersRequest, totalsRequest]);

  return (
    <>
      <PageHeader
        context={context.activeBusiness.name}
        title="Suppliers"
        description="Who you buy from, what you have bought in total, and what you still owe."
        toolbar={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <FreshnessLine updatedAt={loadedAt} />
            <Button variant="outline" size="sm" asChild>
              <Link href="/suppliers/payables">
                <CircleDollarSign data-icon="inline-start" />
                Open money you owe
              </Link>
            </Button>
          </div>
        }
      />

      <section aria-labelledby="supplier-position" className="flex flex-col gap-3">
        <h2 id="supplier-position" className="sr-only">
          Money you owe
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <MetricCard
            label="Total you owe"
            value={totals.ok ? formatMoney({ amount: totals.value.total, currency }) : "—"}
            hint="Every unpaid bill across all suppliers, whether due or not."
            href="/suppliers/payables"
            linkLabel="See the bills"
          />
          <MetricCard
            label="Past its due date"
            tone={totals.ok && totals.value.overdue > 0 ? "negative" : "positive"}
            value={totals.ok ? formatMoney({ amount: totals.value.overdue, currency }) : "—"}
            hint="Bills that have gone past their date and are not yet settled."
            href="/suppliers/payables?status=overdue"
            linkLabel="See what is late"
          />
        </div>
      </section>

      <section aria-labelledby="supplier-list" className="flex flex-col gap-3">
        <SectionHeader
          id="supplier-list"
          title="All suppliers"
          description="Search by name or contact. The amount shown is what you still owe that supplier."
        />
        <SuppliersTable
          search={search}
          status={status}
          result={suppliers}
        />
      </section>

      <section aria-labelledby="supplier-intelligence" className="flex flex-col gap-3">
        <SectionHeader
          id="supplier-intelligence"
          title="Supplier Price & Profit Leak Intelligence"
          description="Identify supplier price creep, unexpected invoice surcharges, and procurement variances."
        />
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base font-medium">Supplier Price Increase Monitoring</CardTitle>
                <CardDescription>
                  Continuous detection monitors purchase order pricing against historical baselines.
                </CardDescription>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link href="/profit-leaks">
                  Inspect Supplier Leaks <ArrowRight className="ml-1.5 size-4" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Merchant Brain automatically compares line items across repeat invoices from suppliers to surface cost increases before they reduce gross margins.
            </p>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
