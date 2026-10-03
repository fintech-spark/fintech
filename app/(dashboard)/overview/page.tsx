import { CardHeading } from "@/components/common/card-heading";
import Link from "next/link";
import {
  Boxes,
  BrainCircuit,
  CircleDollarSign,
  FileText,
  Sparkles,
  TrendingDown,
  Users,
  Wallet,
} from "lucide-react";

import { FreshnessLine } from "@/components/common/freshness";
import { MetricCard } from "@/components/common/metric-card";
import { PageHeader, SectionHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { getAnalyticsSnapshot, getInventoryValue, getPayableTotals, getReceivableTotals, listDocuments, listLowStockProducts } from "@/lib/api/endpoints";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { describeMissing, errorOr, settle, type Settled } from "@/lib/api/settle";
import { formatCount, formatMoney, formatMinorUnits } from "@/lib/format/money";
import { formatDateTime } from "@/lib/format/dates";
import { describeStatus, DOCUMENT_STATUS } from "@/lib/format/status";
import type { Page } from "@/lib/api/client";
import type { WireDocument } from "@/lib/api/contracts";
import type { CurrencyCode } from "@/lib/types";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const context = await resolveMerchantContext();
  // The shell already handles the signed-out and offline states. This guard
  // keeps the page type-safe without duplicating the UI.
  if (!isAuthenticated(context)) return null;

  const businessId = context.activeBusinessId;
  const loadedAt = new Date();

  // Five independent reads. Started together, settled independently: one
  // failure must not blank the other four, and each must keep its own type.
  const receivablesRequest = settle(getReceivableTotals(businessId));
  const payablesRequest = settle(getPayableTotals(businessId));
  const inventoryValueRequest = settle(getInventoryValue(businessId));
  const lowStockRequest = settle(listLowStockProducts(businessId));
  const documentsRequest = settle(
    listDocuments(businessId, { status: "review_required", limit: 10 }),
  );
  const analyticsRequest = settle(getAnalyticsSnapshot(businessId));

  const [receivables, payables, inventoryValue, lowStock, documentsNeedingReview, analytics] =
    await Promise.all([
      receivablesRequest,
      payablesRequest,
      inventoryValueRequest,
      lowStockRequest,
      documentsRequest,
      analyticsRequest,
    ]);

  const missing = describeMissing([
    { label: "Money owed to you", error: errorOr(receivables) },
    { label: "Money you owe", error: errorOr(payables) },
    { label: "Inventory value", error: errorOr(inventoryValue) },
    { label: "Low-stock products", error: errorOr(lowStock) },
    { label: "Documents needing review", error: errorOr(documentsNeedingReview) },
  ]);

  // The backend's currency is authoritative. If we cannot read it, we must not
  // guess a symbol — the money helpers then render an explicit dash.
  const currency: CurrencyCode = "INR";

  const money = (amount: number) => ({ amount, currency });

  const lowStockCount = lowStock.ok ? lowStock.value.length : null;
  const reviewCount = documentsNeedingReview.ok ? documentsNeedingReview.value.total : null;

  return (
    <>
      <PageHeader
        context={context.activeBusiness.name}
        title="Overview"
        description="Where your business stands right now, what needs attention, and what you can do about it. Every figure comes from your own records."
        toolbar={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <FreshnessLine updatedAt={loadedAt} />
            <Button variant="outline" size="sm" asChild>
              <Link href="/documents">
                <FileText data-icon="inline-start" />
                Review documents
              </Link>
            </Button>
          </div>
        }
      />

      {/* Live Business Analytics or Guided Status */}
      {analytics.ok && (analytics.value.revenueMinor > 0 || analytics.value.quality === "complete") ? (
        <Card className="border-primary/20 bg-primary/5 shadow-xs">
          <CardHeader className="flex flex-row items-start justify-between pb-3">
            <div>
              <div className="flex items-center gap-2">
                <BrainCircuit className="size-5 text-primary" />
                <CardHeading className="text-base font-semibold">
                  30-Day Business Performance Snapshot
                </CardHeading>
              </div>
              <CardDescription className="mt-1">
                Deterministic metrics computed from verified transaction and ledger records.
              </CardDescription>
            </div>
            <Button size="sm" asChild>
              <Link href="/business-brain">
                <Sparkles className="size-3.5 mr-1" />
                Ask Business Brain
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 pt-1">
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground uppercase font-medium">Gross Revenue</p>
              <p className="text-xl font-bold font-mono text-foreground mt-1">
                {formatMinorUnits(analytics.value.revenueMinor, (analytics.value.currency as CurrencyCode) || "INR")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">30-day recognized sales</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground uppercase font-medium">Gross Profit</p>
              <p className="text-xl font-bold font-mono text-positive-foreground mt-1">
                {formatMinorUnits(analytics.value.grossProfitMinor, (analytics.value.currency as CurrencyCode) || "INR")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {(analytics.value.grossMarginBasisPoints / 100).toFixed(1)}% gross margin
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground uppercase font-medium">Operating Expenses</p>
              <p className="text-xl font-bold font-mono text-destructive mt-1">
                {formatMinorUnits(analytics.value.operatingExpensesMinor, (analytics.value.currency as CurrencyCode) || "INR")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Recognized running costs</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground uppercase font-medium">Net Operating Income</p>
              <p className="text-xl font-bold font-mono text-foreground mt-1">
                {formatMinorUnits(analytics.value.netProfitMinor, (analytics.value.currency as CurrencyCode) || "INR")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {(analytics.value.netMarginBasisPoints / 100).toFixed(1)}% net margin
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-info-border bg-info-subtle">
          <CardHeader>
            <CardHeading className="text-info-foreground">
              Here is what your records show today
            </CardHeading>
            <CardDescription className="max-w-prose text-pretty">
              The figures below are read directly from your customers, suppliers,
              inventory and documents. As transactions are posted, Business Brain analyzes your trends and cash flow.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" asChild>
              <Link href="/business-brain">Ask Business Brain</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {missing ? (
        <Card className="border-caution-border bg-caution-subtle">
          <CardHeader>
            <CardHeading className="text-caution-foreground">
              Some information is missing
            </CardHeading>
            <CardDescription className="text-pretty">{missing} Treat the summary below as incomplete.</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <section aria-labelledby="position-heading" className="flex flex-col gap-3">
        <SectionHeader
          id="position-heading"
          title="Your position"
          description="Money owed, money owed to you, and money tied up in stock. These are totals, not forecasts."
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {receivables.ok ? (
            <MetricCard
              label="Money owed to you"
              icon={<Wallet aria-hidden={true} className="size-5 text-muted-foreground" />}
              value={formatMoney(money(receivables.value.total))}
              hint="In total across all customers, including anything overdue."
              tone={receivables.value.overdue > 0 ? "caution" : "default"}
              href="/customers/receivables"
              linkLabel="See who owes you"
              footnote={
                receivables.value.overdue > 0 ? (
                  <span className="inline-flex items-center gap-1.5">
                    <TrendingDown aria-hidden="true" className="size-3.5" />
                    {formatMoney(money(receivables.value.overdue))} of it is overdue
                  </span>
                ) : (
                  "Nothing is overdue"
                )
              }
            />
          ) : (
            <MetricCard
              label="Money owed to you"
              icon={<Wallet aria-hidden={true} className="size-5 text-muted-foreground" />}
              value="—"
              hint="Could not be loaded just now."
              tone="negative"
              href="/customers"
            />
          )}

          {payables.ok ? (
            <MetricCard
              label="Money you owe"
              icon={<CircleDollarSign aria-hidden={true} className="size-5 text-muted-foreground" />}
              value={formatMoney(money(payables.value.total))}
              hint="Bills you have not settled yet, including anything past its due date."
              tone={payables.value.overdue > 0 ? "caution" : "default"}
              href="/suppliers/payables"
              linkLabel="See what you owe"
              footnote={
                payables.value.overdue > 0
                  ? `${formatMoney(money(payables.value.overdue))} is past its due date`
                  : "Nothing is past its due date"
              }
            />
          ) : (
            <MetricCard
              label="Money you owe"
              icon={<CircleDollarSign aria-hidden={true} className="size-5 text-muted-foreground" />}
              value="—"
              hint="Could not be loaded just now."
              tone="negative"
              href="/suppliers"
            />
          )}

          {inventoryValue.ok ? (
            <MetricCard
              label="Money in stock"
              icon={<Boxes aria-hidden={true} className="size-5 text-muted-foreground" />}
              value={formatMoney(money(inventoryValue.value.totalValue))}
              hint="What your unsold stock is worth at its cost price."
              href="/inventory"
              linkLabel="See your stock"
              footnote={`Across ${formatCount(inventoryValue.value.productCount, "product")}`}
            />
          ) : (
            <MetricCard
              label="Money in stock"
              icon={<Boxes aria-hidden={true} className="size-5 text-muted-foreground" />}
              value="—"
              hint="Could not be loaded just now."
              tone="negative"
              href="/inventory"
            />
          )}

          {lowStock.ok ? (
            <MetricCard
              label="Products needing restock"
              icon={<Boxes aria-hidden={true} className="size-5 text-muted-foreground" />}
              value={
                lowStockCount === 0
                  ? "None"
                  : formatCount(lowStockCount ?? 0, "product")
              }
              hint="At or below the reorder point you set for this business."
              tone={lowStockCount === 0 ? "positive" : "caution"}
              href="/inventory?filter=low"
              linkLabel="See what to reorder"
            />
          ) : (
            <MetricCard
              label="Products needing restock"
              icon={<Boxes aria-hidden={true} className="size-5 text-muted-foreground" />}
              value="—"
              hint="Could not be loaded just now."
              tone="negative"
              href="/inventory"
            />
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <NeedsAttentionCard
          overdueReceivables={receivables.ok ? receivables.value.overdue : null}
          overduePayables={payables.ok ? payables.value.overdue : null}
          lowStockCount={lowStockCount}
          reviewCount={reviewCount}
          currency={currency}
        />

        <DocumentsNeedingReview
          result={documentsNeedingReview}
        />
      </div>

      <section aria-labelledby="intelligence-heading" className="flex flex-col gap-3">
        <SectionHeader
          id="intelligence-heading"
          title="Operational Intelligence & Actions"
          description="Integrated modules computing metrics, simulating outcomes, and identifying risks across your business."
        />
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Card className="flex flex-col justify-between">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Wallet className="size-4 text-primary" />
                <CardHeading className="text-sm font-semibold">Cash Flow</CardHeading>
              </div>
              <CardDescription className="text-xs">
                Inflows, outflows, receivables, payables, and 30-day forecast.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Button variant="outline" size="sm" asChild className="w-full text-xs">
                <Link href="/cash-flow">Open Cash Flow</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="flex flex-col justify-between">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <TrendingDown className="size-4 text-caution-foreground" />
                <CardHeading className="text-sm font-semibold">Profit Leaks</CardHeading>
              </div>
              <CardDescription className="text-xs">
                Automated detection of price hikes, margin compression, and dead stock.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Button variant="outline" size="sm" asChild className="w-full text-xs">
                <Link href="/profit-leaks">View Profit Leaks</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="flex flex-col justify-between">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Boxes className="size-4 text-primary" />
                <CardHeading className="text-sm font-semibold">What-If Simulator</CardHeading>
              </div>
              <CardDescription className="text-xs">
                Pure arithmetic modelling of price, cost, and volume changes.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Button variant="outline" size="sm" asChild className="w-full text-xs">
                <Link href="/simulator">Open Simulator</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="flex flex-col justify-between">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <BrainCircuit className="size-4 text-primary" />
                <CardHeading className="text-sm font-semibold">Business Brain</CardHeading>
              </div>
              <CardDescription className="text-xs">
                Conversational assistant with tool access to your real database facts.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Button variant="outline" size="sm" asChild className="w-full text-xs">
                <Link href="/business-brain">Ask Business Brain</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>
    </>
  );
}

/**
 * The merchant's actual question: "what should I deal with first?"
 * Ordered by how much money is involved, not by feature name.
 */
function NeedsAttentionCard({
  overdueReceivables,
  overduePayables,
  lowStockCount,
  reviewCount,
  currency,
}: {
  readonly overdueReceivables: number | null;
  readonly overduePayables: number | null;
  readonly lowStockCount: number | null;
  readonly reviewCount: number | null;
  readonly currency: CurrencyCode;
}) {
  const items = [
    {
      key: "receivables",
      show: overdueReceivables !== null && overdueReceivables > 0,
      label: "Money owed to you is overdue",
      detail:
        overdueReceivables === null
          ? "Could not be loaded"
          : `${formatMoney({ amount: overdueReceivables, currency })} is past its due date`,
      href: "/customers/receivables?status=overdue",
      cta: "See who owes you",
    },
    {
      key: "payables",
      show: overduePayables !== null && overduePayables > 0,
      label: "You are past a due date",
      detail:
        overduePayables === null
          ? "Could not be loaded"
          : `${formatMoney({ amount: overduePayables, currency })} needs paying`,
      href: "/suppliers/payables?status=overdue",
      cta: "See what you owe",
    },
    {
      key: "low-stock",
      show: lowStockCount !== null && lowStockCount > 0,
      label: "Products are running out",
      detail:
        lowStockCount === null
          ? "Could not be loaded"
          : `${formatCount(lowStockCount, "product")} at or below the reorder point`,
      href: "/inventory?filter=low",
      cta: "See what to reorder",
    },
    {
      key: "review",
      show: reviewCount !== null && reviewCount > 0,
      label: "Documents are waiting for you",
      detail:
        reviewCount === null
          ? "Could not be loaded"
          : `${formatCount(reviewCount, "document")} need your confirmation`,
      href: "/documents?status=review_required",
      cta: "Review them",
    },
  ].filter((item) => item.show);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardHeading>Needs attention</CardHeading>
        <CardDescription>
          {items.length === 0
            ? "Nothing in your records is flagged for attention right now."
            : "Ordered by how much money each one involves."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            That means no overdue balances, nothing below its reorder point and
            no documents waiting on you. It does not mean Merchant Brain has
            analysed your business — that analysis is not connected yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((item) => (
              <li key={item.key} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-sm text-muted-foreground">{item.detail}</p>
                <Link
                  href={item.href}
                  className="w-fit text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {item.cta}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** The merchant's second question: "is there something on my desk?" */
function DocumentsNeedingReview({
  result,
}: {
  readonly result: Settled<Page<WireDocument>>;
}) {
  if (!result.ok) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardHeading>Waiting for you</CardHeading>
          <CardDescription>Documents needing confirmation.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This could not be loaded just now.
          </p>
        </CardContent>
      </Card>
    );
  }

  const documents = result.value.items;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardHeading>Waiting for you</CardHeading>
        <CardDescription>
          {documents.length === 0
            ? "No documents are waiting for confirmation."
            : "Documents that have been read and need your confirmation before they count."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            When you send an invoice or receipt, it appears here for you to check
            before it affects your numbers.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {documents.slice(0, 5).map((document: WireDocument) => {
              const status = describeStatus(DOCUMENT_STATUS, document.status);
              return (
                <li key={document.id} className="flex flex-col gap-1 py-3 first:pt-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-medium">
                      {document.metadata.originalName}
                    </p>
                    <StatusBadge descriptor={status} showIcon={false} size="sm" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Uploaded {formatDateTime(document.uploadedAt)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-3">
          <Button variant="outline" size="sm" asChild>
            <Link href="/documents?status=review_required">
              <Users aria-hidden="true" data-icon="inline-start" />
              Open Documents
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}