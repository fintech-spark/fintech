import { CardHeading } from "@/components/common/card-heading";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CapabilityPanel } from "@/components/common/data-state";
import { FreshnessLine } from "@/components/common/freshness";
import { MoneyValue } from "@/components/common/money";
import { PageHeader, SectionHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { PayablesTable } from "@/components/suppliers/payables-table";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { getSupplier, getSupplierPricing, listPayables } from "@/lib/api/endpoints";
import { pendingCapability } from "@/lib/api/pending";
import { settle } from "@/lib/api/settle";
import { formatDate } from "@/lib/format/dates";
import { safeLabel, shortReference } from "@/lib/format/labels";
import { describeStatus, PARTNER_STATUS } from "@/lib/format/status";
import type { CurrencyCode } from "@/lib/types";

export const metadata: Metadata = { title: "Supplier" };

export default async function SupplierPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  const { id } = await params;
  const businessId = context.activeBusinessId;

  let supplier: Awaited<ReturnType<typeof getSupplier>>;
  try {
    supplier = await getSupplier(businessId, id);
  } catch {
    // 404 means either gone or another business's record. Never distinguish.
    notFound();
  }

  const pricingRequest = settle(getSupplierPricing(businessId, id));
  const payablesRequest = settle(listPayables(businessId, { supplierId: id, limit: 25 }));
  const [pricing, payables] = await Promise.all([pricingRequest, payablesRequest]);

  const currency: CurrencyCode = "INR";
  const names = new Map([[supplier.id, safeLabel(supplier.name)]]);

  return (
    <>
      <PageHeader
        context={context.activeBusiness.name}
        title={safeLabel(supplier.name)}
        description={supplier.contactName ?? supplier.email ?? undefined}
        backHref="/suppliers"
        backLabel="All suppliers"
        toolbar={
          <FreshnessLine updatedAt={supplier.updatedAt} prefix="Supplier last changed" />
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardHeading>Money</CardHeading>
            <CardDescription>Totals from your purchase records.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <dt className="text-sm text-muted-foreground">You still owe</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  <MoneyValue value={{ ...supplier.outstandingPayable, currency }} />
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-sm text-muted-foreground">Bought in total</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  <MoneyValue value={{ ...supplier.totalPurchases, currency }} />
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardHeading>Details</CardHeading>
            <CardDescription>Contact and record information.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-muted-foreground">Status</dt>
                <dd>
                  <StatusBadge
                    descriptor={describeStatus(PARTNER_STATUS, supplier.status)}
                    showIcon={false}
                    size="sm"
                  />
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-muted-foreground">Phone</dt>
                <dd className="min-w-0 truncate text-sm">{safeLabel(supplier.phone)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-muted-foreground">Last purchase</dt>
                <dd className="text-sm">{formatDate(supplier.lastTransactionDate)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="supplier-pricing" className="flex flex-col gap-3">
        <SectionHeader
          id="supplier-pricing"
          title="Current prices"
          description="What this supplier charges per product right now, as last recorded."
        />
        {pricing.ok && pricing.value.length > 0 ? (
          <Card>
            <CardContent>
              <ul className="flex flex-col divide-y divide-border">
                {pricing.value.map((entry) => (
                  <li
                    key={`${entry.supplierId}-${entry.productId}`}
                    className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span className="min-w-0 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">
                        Product{" "}
                        <span className="font-mono text-xs text-muted-foreground">
                          {shortReference(entry.productId)}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Recorded {formatDate(entry.lastUpdated)}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium tabular-nums">
                      <MoneyValue value={{ ...entry.unitPrice, currency }} />
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted-foreground">
                Only the latest price is available. Merchant Brain cannot yet tell
                you whether a price has gone up, because that needs the price
                history the backend does not expose.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {pricing.ok
                  ? "No prices have been recorded for this supplier yet."
                  : "Supplier pricing could not be loaded just now."}
              </p>
            </CardContent>
          </Card>
        )}
      </section>

      <section aria-labelledby="supplier-bills" className="flex flex-col gap-3">
        <SectionHeader
          id="supplier-bills"
          title="Unpaid bills"
          description="Everything you still owe this supplier."
        />
        <PayablesTable result={payables} currency={currency} supplierNames={names} />
      </section>

      <CapabilityPanel capability={pendingCapability("profitLeaks")} />
    </>
  );
}
