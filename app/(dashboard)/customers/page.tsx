import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CircleDollarSign } from "lucide-react";

import { FreshnessLine } from "@/components/common/freshness";
import { MetricCard } from "@/components/common/metric-card";
import { PageHeader, SectionHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CustomersTable } from "@/components/customers/customers-table";
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
import { getReceivableTotals, listCustomers } from "@/lib/api/endpoints";
import { settle } from "@/lib/api/settle";
import { formatMoney } from "@/lib/format/money";
import type { CurrencyCode } from "@/lib/types";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  readonly searchParams: Promise<RawSearchParams>;
}) {
  const context = await resolveMerchantContext();
  // The shell owns the signed-out and offline states; this keeps the page
  // type-safe without duplicating that UI.
  if (!isAuthenticated(context)) return null;

  const params = await searchParams;
  const page = readPageNumber(params);
  const limit = readPageSize(params);
  const search = readParam(params, PARAM.search, 80);
  const status = readEnum(params, PARAM.status, PARTNER_STATUS_VALUES);

  const businessId = context.activeBusinessId;
  const loadedAt = new Date();
  const currency: CurrencyCode = "INR";

  const customersRequest = settle(
    listCustomers(businessId, { page, limit, search, status }),
  );
  const totalsRequest = settle(getReceivableTotals(businessId));
  const [customers, totals] = await Promise.all([customersRequest, totalsRequest]);

  return (
    <>
      <PageHeader
        context={context.activeBusiness.name}
        title="Customers"
        description="Who buys from you, what they have bought in total, and what they still owe you."
        toolbar={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <FreshnessLine updatedAt={loadedAt} />
            <Button variant="outline" size="sm" asChild>
              <Link href="/customers/receivables">
                <CircleDollarSign data-icon="inline-start" />
                Open money owed to you
              </Link>
            </Button>
          </div>
        }
      />

      <section aria-labelledby="customer-position" className="flex flex-col gap-3">
        <h2 id="customer-position" className="sr-only">
          Money owed to you
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <MetricCard
            label="Total owed to you"
            value={totals.ok ? formatMoney({ amount: totals.value.total, currency }) : "—"}
            hint="Across every customer, whether or not it is due yet."
            href="/customers/receivables"
            linkLabel="See the balances"
          />
          <MetricCard
            label="Overdue"
            tone={totals.ok && totals.value.overdue > 0 ? "negative" : "positive"}
            value={totals.ok ? formatMoney({ amount: totals.value.overdue, currency }) : "—"}
            hint="Past its due date. This is usually the hardest money to collect."
            href="/customers/receivables?status=overdue"
            linkLabel="See who is late"
          />
        </div>
      </section>

      <section aria-labelledby="customer-list" className="flex flex-col gap-3">
        <SectionHeader
          id="customer-list"
          title="All customers"
          description="Search by name, phone or email. The amount shown is what that customer still owes you."
        />
        <CustomersTable
          search={search}
          status={status}
          result={customers}
        />
      </section>

      <section aria-labelledby="customer-intelligence" className="flex flex-col gap-3">
        <SectionHeader
          id="customer-intelligence"
          title="Customer & Receivables Intelligence"
          description="Use Business Brain to analyze customer buying frequency, overdue risk, and debt collection."
        />
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base font-medium">Ask Merchant Brain About Customers</CardTitle>
                <CardDescription>
                  Natural-language synthesis grounded in your invoices and counterparty transaction records.
                </CardDescription>
              </div>
              <Button asChild size="sm">
                <Link href="/business-brain">
                  Ask Business Brain <ArrowRight className="ml-1.5 size-4" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Try asking questions like &ldquo;Which customers have the highest overdue balance?&rdquo; or &ldquo;Who stopped buying this month?&rdquo; to receive deterministic answers with full evidence citations.
            </p>
          </CardContent>
        </Card>
      </section>
    </>
  );
}