import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FreshnessLine } from "@/components/common/freshness";
import { MetricCard } from "@/components/common/metric-card";
import { PageHeader, SectionHeader } from "@/components/common/page-header";
import { ReceivablesTable } from "@/components/customers/receivables-table";
import {
  PARAM,
  RECEIVABLE_STATUS_VALUES,
  readEnum,
  readPageNumber,
  readPageSize,
  type RawSearchParams,
} from "@/components/data/params";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { getReceivableTotals, listCustomers, listReceivables } from "@/lib/api/endpoints";
import { settle } from "@/lib/api/settle";
import { safeLabel } from "@/lib/format/labels";
import { formatMoney } from "@/lib/format/money";
import type { CurrencyCode } from "@/lib/types";

export const metadata: Metadata = { title: "Money owed to you" };

/**
 * Money owed to the merchant, invoice by invoice.
 *
 * Customer names are resolved alongside the ledger so the table shows
 * "ABC Traders" rather than a UUID. Names are a presentation convenience only;
 * no balance, total or status is computed here.
 */
export default async function ReceivablesPage({
  searchParams,
}: {
  readonly searchParams: Promise<RawSearchParams>;
}) {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  const params = await searchParams;
  const page = readPageNumber(params);
  const limit = readPageSize(params);
  const status = readEnum(params, PARAM.status, RECEIVABLE_STATUS_VALUES);

  const businessId = context.activeBusinessId;
  const loadedAt = new Date();
  const currency: CurrencyCode = "INR";

  const receivablesRequest = settle(listReceivables(businessId, { page, limit, status }));
  const totalsRequest = settle(getReceivableTotals(businessId));
  // Names are a nicety; if this page of customers does not cover every
  // receivable, the table falls back to the id rather than blocking the page.
  const namesRequest = settle(listCustomers(businessId, { page: 1, limit: 100 }));

  const [receivables, totals, names] = await Promise.all([
    receivablesRequest,
    totalsRequest,
    namesRequest,
  ]);

  const customerNames = new Map<string, string>(
    (names.ok ? names.value.items : []).map((customer) => [
      customer.id,
      safeLabel(customer.name),
    ]),
  );

  return (
    <>
      <PageHeader
        context={context.activeBusiness.name}
        title="Money owed to you"
        description="Every unpaid balance, when it was due, and how late it is. Totals are calculated from your records, not estimated."
        toolbar={<FreshnessLine updatedAt={loadedAt} />}
      />

      <section aria-labelledby="receivable-totals" className="flex flex-col gap-3">
        <h2 id="receivable-totals" className="sr-only">
          Totals
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <MetricCard
            label="Total outstanding"
            value={totals.ok ? formatMoney({ amount: totals.value.total, currency }) : "—"}
            hint="Everything you are owed, whether due or not."
          />
          <MetricCard
            label="Overdue"
            tone={totals.ok && totals.value.overdue > 0 ? "negative" : "positive"}
            value={totals.ok ? formatMoney({ amount: totals.value.overdue, currency }) : "—"}
            hint="Past its due date."
          />
        </div>
      </section>

      <section aria-labelledby="receivable-list" className="flex flex-col gap-3">
        <SectionHeader
          id="receivable-list"
          title="Balances"
          description="Newest due date first within each status. Use the tabs to focus on what is overdue."
        />
        <ReceivablesTable
          result={receivables}
          currency={currency}
          customerNames={customerNames}
        />
      </section>

      <section aria-labelledby="receivables-actions" className="flex flex-col gap-3">
        <SectionHeader
          id="receivables-actions"
          title="Operational Action Center"
          description="Prepare and execute payment reminders, customer statements, or credit term reviews with dual approval."
        />
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base font-medium">Overdue Balance Collection Actions</CardTitle>
                <CardDescription>
                  Actions move through draft, approval, execution, and audit trail on the server.
                </CardDescription>
              </div>
              <Button asChild size="sm">
                <Link href="/actions">
                  Open Action Center <ArrowRight className="ml-1.5 size-4" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {totals.ok && totals.value.overdue > 0
                ? `${formatMoney({ amount: totals.value.overdue, currency })} is currently overdue across customer balances. Review proposed collection workflows or draft custom actions in the Action Center.`
                : "All receivables are currently within terms. You can review scheduled reminder templates or draft credit actions in the Action Center."}
            </p>
          </CardContent>
        </Card>
      </section>
    </>
  );
}