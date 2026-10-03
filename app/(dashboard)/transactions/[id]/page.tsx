import type { Metadata } from "next";
import { ArrowLeft, Receipt } from "lucide-react";
import Link from "next/link";

import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { getTransaction } from "@/lib/api/endpoints";
import { settle } from "@/lib/api/settle";
import { notFound } from "next/navigation";
import { ErrorPanel } from "@/components/common/data-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { describeStatus, TRANSACTION_STATUS, TRANSACTION_TYPE } from "@/lib/format/status";
import { formatMoney } from "@/lib/format/money";
import { formatDate } from "@/lib/format/dates";
import { safeLabel } from "@/lib/format/labels";

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  return { title: `Transaction ${params.id.slice(0, 8)}` };
}

export default async function TransactionDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  const businessId = context.activeBusinessId;
  const transactionId = params.id;
  const request = settle(getTransaction(businessId, transactionId));
  const [result] = await Promise.all([request]);

  if (!result.ok) {
    if (result.error.isNotFound) notFound();
    return (
      <div className="grid gap-4">
        <PageHeader
          title="Transaction"
          description="Could not load this transaction."
          toolbar={
            <Link
              href="/transactions"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" /> All transactions
            </Link>
          }
        />
        <ErrorPanel error={result.error} variant="card" />
      </div>
    );
  }

  const t = result.value;
  const status = describeStatus(TRANSACTION_STATUS, t.status);
  const type = describeStatus(TRANSACTION_TYPE, t.type);

  return (
    <>
      <PageHeader
        title="Transaction"
        description={safeLabel(t.reference) || `${type.label}`}
        toolbar={
          <div className="flex items-center gap-2">
            <Link
              href="/transactions"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" /> All transactions
            </Link>
            <Badge variant="outline" className="gap-1.5">
              <Receipt aria-hidden="true" className="size-3" />
              {t.id.slice(0, 8)}
            </Badge>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Details
              <StatusBadge descriptor={status} size="sm" />
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Type</span>
              <span>{type.label}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Total</span>
              <span className="text-lg font-semibold">{formatMoney(t.total)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatMoney(t.subtotal)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Discount</span>
              <span>{formatMoney(t.discount)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Tax</span>
              <span>{formatMoney(t.tax)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Counterparty</span>
              <span>
                {t.counterpartyType} <span className="text-muted-foreground">{t.counterpartyId.slice(0, 8)}</span>
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Payment method</span>
              <span>{t.paymentMethod ? safeLabel(t.paymentMethod) : "—"}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Reference</span>
              <span>{safeLabel(t.reference) || "—"}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Date</span>
              <span>{formatDate(t.transactionDate)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Created</span>
              <span>{formatDate(t.createdAt)}</span>
            </div>
            {t.notes && (
              <div className="pt-2 text-muted-foreground">{t.notes}</div>
            )}
            {t.items.length > 0 && (
              <div className="pt-2">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Items</h3>
                <ul className="flex flex-col gap-2">
                  {t.items.map((item, i) => (
                    <li key={i} className="rounded-md border border-border bg-muted/40 p-2 text-xs">
                      <div className="font-medium">{item.productName || item.productId}</div>
                      <div className="text-muted-foreground">Product ID: {item.productId}</div>
                    </li>
                  ))}
                </ul>
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
                <span className="text-muted-foreground">Type</span>{" "}
                <span className="font-medium">{type.label}</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
