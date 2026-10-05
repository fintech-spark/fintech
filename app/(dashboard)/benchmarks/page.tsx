import type { Metadata } from "next";
import {
  Activity,
  BarChart3,
  Building2,
  CheckCircle2,
  CreditCard,
  Info,
  MapPin,
  TrendingUp,
  Users,
} from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { FreshnessLine } from "@/components/common/freshness";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { getPulseBenchmarks } from "@/lib/api/endpoints";
import { settle } from "@/lib/api/settle";
import { formatPercent } from "@/lib/format/money";
import { toneSurfaceClasses, toneTextClasses } from "@/lib/format/status";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Market Benchmarks — PhonePe Pulse",
  description: "National UPI payment volumes and state benchmarks from official PhonePe Pulse data.",
};

function formatInteger(val: number): string {
  return new Intl.NumberFormat("en-IN").format(val);
}

function formatIndianNumber(val: number): string {
  if (val >= 10_000_000_000) {
    return `${(val / 1_000_000_000).toFixed(2)}B`;
  }
  if (val >= 10_000_000) {
    return `${(val / 10_000_000).toFixed(2)} Cr`;
  }
  if (val >= 100_000) {
    return `${(val / 100_000).toFixed(2)} Lakh`;
  }
  return formatInteger(val);
}

function formatRupeeAmount(val: number | null): string {
  if (val === null || val === undefined) return "—";
  if (val >= 100_000_000_000_000) {
    return `₹${(val / 100_000_000_000_000).toFixed(2)} Lakh Cr`;
  }
  if (val >= 10_000_000_000_000) {
    return `₹${(val / 10_000_000_000_000).toFixed(2)} Trillion`;
  }
  if (val >= 10_000_000) {
    return `₹${(val / 10_000_000).toFixed(2)} Cr`;
  }
  return `₹${formatInteger(Math.round(val))}`;
}

function capitalizeWords(str: string): string {
  return str
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function getShareWidthClass(sharePct: number): string {
  if (sharePct >= 90) return "w-full";
  if (sharePct >= 75) return "w-3/4";
  if (sharePct >= 60) return "w-2/3";
  if (sharePct >= 50) return "w-1/2";
  if (sharePct >= 33) return "w-1/3";
  if (sharePct >= 25) return "w-1/4";
  if (sharePct >= 15) return "w-1/6";
  return "w-1/12";
}

import { wireBenchmarks } from "@/lib/http/wiring";

export default async function BenchmarksPage() {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  const loadedAt = new Date();
  let benchmarkResult = await settle(getPulseBenchmarks());

  if (!benchmarkResult.ok) {
    try {
      const { pulse } = wireBenchmarks();
      const summary = await pulse.getBenchmarkSummary();
      benchmarkResult = { ok: true, value: summary as never };
    } catch {
      // fallback failed, will show error banner
    }
  }

  if (!benchmarkResult.ok) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader
          context="Market Intelligence"
          title="Market Benchmarks"
          description="Macroeconomic UPI transaction data and state benchmarks from PhonePe Pulse."
        />
        <Alert variant="destructive">
          <Info className="h-4 w-4" />
          <AlertTitle>Benchmark Service Offline</AlertTitle>
          <AlertDescription>
            Could not retrieve PhonePe Pulse benchmark records. Please verify database connectivity or try again later.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const benchmark = benchmarkResult.value;
  const { period, nationalMetrics, comparisons, categoryBreakdown, topStates, nationalTrend } = benchmark;

  const qoq = comparisons.quarterOverQuarter;
  const yoy = comparisons.yearOverYear;

  // Recent 6 quarters for trend table
  const recentTrends = [...nationalTrend].slice(-6).reverse();

  return (
    <div className="space-y-8 p-4 md:p-8 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-xs uppercase tracking-wider text-muted-foreground">
              National Reference Dataset
            </Badge>
            <Badge variant="secondary" className={cn("text-xs", toneSurfaceClasses("positive"))}>
              <CheckCircle2 className="h-3 w-3 mr-1" /> Verified 119k Records
            </Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Market Benchmarks</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Official PhonePe Pulse payment trends (Q1 2018 – Q2 2026). Public national benchmarks for market context.
          </p>
        </div>
        <FreshnessLine updatedAt={loadedAt} />
      </div>

      {/* Attribution & Provenance Banner */}
      <Alert className="bg-primary/5 border-primary/20">
        <Info className="h-4 w-4 text-primary" />
        <AlertTitle className="text-sm font-semibold">Public National Benchmark Provenance</AlertTitle>
        <AlertDescription className="text-xs text-muted-foreground mt-1 leading-relaxed">
          This data reflects aggregated public UPI payments across India published by PhonePe Pulse. It provides macroeconomic context on consumer payment adoption, state velocity, and merchant digitization. Per system isolation rules, national benchmark metrics are strictly read-only and never mixed into your tenant ledger.
        </AlertDescription>
      </Alert>

      {/* Top Level Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Quarterly Transactions */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">National Transactions</CardTitle>
            <CreditCard className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight">
              {formatIndianNumber(nationalMetrics.transactionCount)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Q{period.quarter} {period.year} ({formatInteger(nationalMetrics.transactionCount)} total)
            </p>
            {qoq && (
              <div className="flex items-center gap-2 mt-3 pt-3 border-t text-xs">
                <span className={cn("inline-flex items-center font-medium", qoq.change >= 0 ? toneTextClasses("positive") : "text-destructive")}>
                  <TrendingUp className="h-3 w-3 mr-0.5" />
                  {qoq.changePct !== null ? `${qoq.changePct > 0 ? "+" : ""}${qoq.changePct}%` : "—"}
                </span>
                <span className="text-muted-foreground">vs previous quarter</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Total Rupee Value */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">National Volume</CardTitle>
            <BarChart3 className="h-4 w-4 text-chart-2" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight">
              {formatRupeeAmount(nationalMetrics.transactionAmount)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              State-reported payments in Q{period.quarter} {period.year}
            </p>
            {yoy && (
              <div className="flex items-center gap-2 mt-3 pt-3 border-t text-xs">
                <span className={cn("font-medium", toneTextClasses("positive"))}>
                  {yoy.changePct !== null ? `+${yoy.changePct}%` : "—"}
                </span>
                <span className="text-muted-foreground">YoY volume expansion</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Registered Users */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Registered Users</CardTitle>
            <Users className="h-4 w-4 text-chart-3" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight">
              {nationalMetrics.registeredUsers ? formatIndianNumber(nationalMetrics.registeredUsers) : "—"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {nationalMetrics.registeredUsers ? `${formatInteger(nationalMetrics.registeredUsers)} active accounts` : "National adoption"}
            </p>
            <div className="flex items-center gap-2 mt-3 pt-3 border-t text-xs text-muted-foreground">
              <span className="text-foreground font-medium">India-wide</span> digital identity reach
            </div>
          </CardContent>
        </Card>

        {/* Snapshot Active Period */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Benchmark Period</CardTitle>
            <Activity className="h-4 w-4 text-chart-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight">
              Q{period.quarter} {period.year}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Latest available reporting quarter
            </p>
            <div className="flex items-center gap-2 mt-3 pt-3 border-t text-xs text-muted-foreground">
              <span>{nationalTrend.length} quarters tracked</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Two Column Layout: Categories & Top States */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Payment Categories (1 col) */}
        <Card className="lg:col-span-1 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" /> Payment Breakdown
            </CardTitle>
            <CardDescription className="text-xs">
              National payment channels by transaction volume in Q{period.quarter} {period.year}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {categoryBreakdown.length === 0 ? (
              <p className="text-xs text-muted-foreground">No category breakdown available.</p>
            ) : (
              categoryBreakdown.map((cat) => (
                <div key={cat.category} className="space-y-1.5 p-3 rounded-lg bg-muted/40 border">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground capitalize">
                      {cat.category === "retail" ? "Merchant Payments (P2M)" : cat.category === "p2p" ? "Peer to Peer (P2P)" : cat.category === "utility" ? "Recharge & Utilities" : cat.category}
                    </span>
                    <span className="font-semibold text-foreground">{formatPercent(cat.sharePct)}</span>
                  </div>
                  <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                    <div
                      className={cn("bg-primary h-full rounded-full transition-all duration-500", getShareWidthClass(cat.sharePct))}
                    />
                  </div>
                  <div className="flex justify-between items-center text-xs text-muted-foreground">
                    <span>{formatIndianNumber(cat.transactionCount)} transactions</span>
                    <span>{formatInteger(cat.transactionCount)}</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Top States Table (2 cols) */}
        <Card className="lg:col-span-2 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" /> State Volume Rankings
            </CardTitle>
            <CardDescription className="text-xs">
              Top states by transaction volume and digital commerce velocity in Q{period.quarter} {period.year}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 text-xs">
                    <TableHead className="w-12 text-center">#</TableHead>
                    <TableHead>State / UT</TableHead>
                    <TableHead className="text-right">Transactions</TableHead>
                    <TableHead className="text-right">Total Amount</TableHead>
                    <TableHead className="text-right">Share of Top 10</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="text-xs">
                  {topStates.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                        No state rankings recorded for this quarter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    topStates.map((state, idx) => {
                      const totalTopCount = topStates.reduce((acc, s) => acc + s.count, 0);
                      const stateShare = totalTopCount > 0 ? (state.count / totalTopCount) * 100 : 0;
                      return (
                        <TableRow key={state.name} className="hover:bg-muted/30">
                          <TableCell className="text-center font-medium text-muted-foreground">
                            {idx + 1}
                          </TableCell>
                          <TableCell className="font-semibold text-foreground">
                            {capitalizeWords(state.name)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatIndianNumber(state.count)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">
                            {formatRupeeAmount(state.amount)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant="outline" className="font-mono text-xs">
                              {stateShare.toFixed(1)}%
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Historical Trend Table */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" /> Recent Quarterly Velocity Trajectory
          </CardTitle>
          <CardDescription className="text-xs">
            National aggregate UPI transactions over recent quarters.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 text-xs">
                  <TableHead>Quarter</TableHead>
                  <TableHead className="text-right">Transaction Count</TableHead>
                  <TableHead className="text-right">Indian Scale</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="text-xs">
                {recentTrends.map((point) => (
                  <TableRow key={`${point.year}-Q${point.quarter}`}>
                    <TableCell className="font-semibold text-foreground">
                      Q{point.quarter} {point.year}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatInteger(point.transactionCount)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {formatIndianNumber(point.transactionCount)}
                    </TableCell>
                    <TableCell className="text-right">
                      {point.year === period.year && point.quarter === period.quarter ? (
                        <Badge variant="secondary" className="text-xs bg-primary/10 text-primary">
                          Current Quarter
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Recorded</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
