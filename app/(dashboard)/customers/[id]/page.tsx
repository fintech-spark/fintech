import { CardHeading } from "@/components/common/card-heading";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FreshnessLine } from "@/components/common/freshness";
import { MoneyValue } from "@/components/common/money";
import { PageHeader, SectionHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { ReceivablesTable } from "@/components/customers/receivables-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { getCustomer, getCustomerBalance, listReceivables } from "@/lib/api/endpoints";
import { settle } from "@/lib/api/settle";
import { formatDate } from "@/lib/format/dates";
import { safeLabel } from "@/lib/format/labels";
import { formatMoney } from "@/lib/format/money";
import { describeStatus, PARTNER_STATUS } from "@/lib/format/status";
import type { CurrencyCode } from "@/lib/types";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  const { id } = await params;
  const businessId = context.activeBusinessId;

  let customer: Awaited<ReturnType<typeof getCustomer>>;
  try {
    customer = await getCustomer(businessId, id);
  } catch {
    // The backend answers 404 for both "gone" and "another business's record",
    // deliberately. This screen must not reveal which.
    notFound();
  }

  const balanceRequest = settle(getCustomerBalance(businessId, id));
  const receivablesRequest = settle(listReceivables(businessId, { customerId: id, limit: 25 }));
  const [balance, receivables] = await Promise.all([
    balanceRequest,
    receivablesRequest,
  ]);

  const currency: CurrencyCode = "INR";
  const names = new Map([[customer.id, safeLabel(customer.name)]]);

  return (
    <>
      <PageHeader
        context={context.activeBusiness.name}
        title={safeLabel(customer.name)}
        description={customer.email ?? customer.phone ?? undefined}
        backHref="/customers"
        backLabel="All customers"
        toolbar={<FreshnessLine updatedAt={customer.updatedAt} prefix="Customer last changed" />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardHeading>Money</CardHeading>
            <CardDescription>
              Totals calculated from your records. Nothing here is estimated.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <dt className="text-sm text-muted-foreground">Still owes you</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {balance.ok
                    ? formatMoney({ amount: balance.value.outstanding, currency })
                    : "—"}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-sm text-muted-foreground">Of that, overdue</dt>
                <dd
                  className={
                    balance.ok && balance.value.overdue > 0
                      ? "text-2xl font-semibold tabular-nums text-negative-foreground"
                      : "text-2xl font-semibold tabular-nums"
                  }
                >
                  {balance.ok ? formatMoney({ amount: balance.value.overdue, currency }) : "—"}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-sm text-muted-foreground">Bought in total</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  <MoneyValue value={{ ...customer.totalPurchases, currency }} />
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
              <Row label="Status">
                <StatusBadge
                  descriptor={describeStatus(PARTNER_STATUS, customer.status)}
                  showIcon={false}
                  size="sm"
                />
              </Row>
              <Row label="Phone">{safeLabel(customer.phone)}</Row>
              <Row label="Email">{safeLabel(customer.email)}</Row>
              <Row label="Last order">{formatDate(customer.lastTransactionDate)}</Row>
              <Row label="Customer since">{formatDate(customer.createdAt)}</Row>
            </dl>
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="customer-balances" className="flex flex-col gap-3">
        <SectionHeader
          id="customer-balances"
          title="Unpaid balances"
          description="Every invoice from this customer that is not yet settled."
        />
        <ReceivablesTable
          result={receivables}
          currency={currency}
          customerNames={names}
        />
      </section>

      <section aria-labelledby="customer-actions" className="flex flex-col gap-3">
        <SectionHeader
          id="customer-actions"
          title="Customer Actions"
          description="Prepare and execute statements, reminder notices, and account actions."
        />
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base font-medium">Customer Action Workflow</CardTitle>
                <CardDescription>
                  Actions move through proposal, dual approval, execution, and audit log.
                </CardDescription>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link href="/actions">
                  Open Action Center <ArrowRight className="ml-1.5 size-4" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Review and approve automated payment reminder notices, WhatsApp drafts, or custom payment agreements for this customer in the Action Center.
            </p>
          </CardContent>
        </Card>
      </section>
    </>
  );
}

function Row({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-sm">{children}</dd>
    </div>
  );
}
