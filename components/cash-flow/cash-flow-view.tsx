import * as React from "react";
import Link from "next/link";
import {
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  AlertTriangle,
  Calendar,
  Building2,
  Users,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMinorUnits } from "@/lib/format/money";
import type { CurrencyCode } from "@/lib/types";
import type { WireCashFlowForecast } from "@/lib/api/contracts";

interface CashFlowViewProps {
  readonly forecast: WireCashFlowForecast | null;
  readonly businessId: string;
}

export function CashFlowView({ forecast }: CashFlowViewProps) {
  if (!forecast) {
    return (
      <Card className="border-dashed border-border py-12 text-center">
        <CardHeader>
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
            <Wallet className="size-6 text-muted-foreground" />
          </div>
          <CardTitle className="mt-3 text-base">Cash Flow Forecast Initializing</CardTitle>
          <CardDescription className="max-w-md mx-auto">
            A 30-day forecast is generated as your transactions, receivables, and payables are recorded.
            Check your current customer balances and supplier bills to review immediate obligations.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center gap-3">
          <Button variant="outline" asChild>
            <Link href="/customers/receivables">View Receivables</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/suppliers/payables">View Payables</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const netCashFlowAmount = forecast.endingCash.amount - forecast.startingCash.amount;
  const isNetPositive = netCashFlowAmount >= 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Top Meta Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 shadow-xs">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Calendar className="size-4" />
          <span>Calculated: {new Date(forecast.calculatedAt).toLocaleDateString()}</span>
          <span>•</span>
          <span>Forecast Model: 30-Day Forward Rolling Horizon</span>
        </div>
        <div>
          <Badge variant="outline" className="border-positive-border bg-positive-subtle text-positive-foreground">
            Active Projection
          </Badge>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid gap-4 sm:grid-cols-3">
        {/* Starting Cash */}
        <Card className="border-border bg-card shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription className="text-xs font-medium uppercase tracking-wider">
              Starting Cash Balance
            </CardDescription>
            <Wallet className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-foreground">
              {formatMinorUnits(forecast.startingCash.amount, (forecast.startingCash.currency as CurrencyCode) || "INR")}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Opening ledger cash position</p>
          </CardContent>
        </Card>

        {/* Projected Ending Cash */}
        <Card className="border-border bg-card shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription className="text-xs font-medium uppercase tracking-wider">
              Projected Ending Cash
            </CardDescription>
            <TrendingUp className="size-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-foreground">
              {formatMinorUnits(forecast.endingCash.amount, (forecast.endingCash.currency as CurrencyCode) || "INR")}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Forecasted balance at end of horizon
            </p>
          </CardContent>
        </Card>

        {/* Net Drift */}
        <Card className="border-border bg-card shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription className="text-xs font-medium uppercase tracking-wider">
              Net 30-Day Drift
            </CardDescription>
            {isNetPositive ? (
              <ArrowDownRight className="size-4 text-positive-foreground" />
            ) : (
              <ArrowUpRight className="size-4 text-destructive" />
            )}
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold font-mono ${
                isNetPositive ? "text-positive-foreground" : "text-destructive"
              }`}
            >
              {isNetPositive ? "+" : "-"}
              {formatMinorUnits(Math.abs(netCashFlowAmount), (forecast.endingCash.currency as CurrencyCode) || "INR")}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {isNetPositive ? "Net cash generation" : "Net cash drawdown"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Identified Risks & Points */}
      {forecast.risks && forecast.risks.length > 0 && (
        <Card className="border-caution-border bg-caution-subtle">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-caution-foreground" />
              <CardTitle className="text-base font-semibold text-caution-foreground">
                Key Cash Flow Observations
              </CardTitle>
            </div>
            <CardDescription className="text-caution-foreground">
              Identified commitments and potential liquidity constraints
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {forecast.risks.map((risk, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm text-foreground">
                  <span className="mt-1.5 size-1.5 rounded-full bg-chart-3 shrink-0" />
                  <span>{typeof risk === "string" ? risk : JSON.stringify(risk)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Navigation Panels */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-border bg-card">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="size-5 text-primary" />
              <CardTitle className="text-sm font-semibold">Receivables Schedule</CardTitle>
            </div>
            <CardDescription>
              Review customer invoices and overdue amounts driving your expected inflows.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" asChild>
              <Link href="/customers/receivables">Inspect Customer Receivables</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="size-5 text-primary" />
              <CardTitle className="text-sm font-semibold">Payables Commitments</CardTitle>
            </div>
            <CardDescription>
              Review upcoming supplier bills and payment deadlines to prevent cash crunches.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" asChild>
              <Link href="/suppliers/payables">Inspect Supplier Payables</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
