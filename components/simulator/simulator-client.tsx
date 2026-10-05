"use client";

import { useState } from "react";
import { Calculator, TrendingUp, TrendingDown, AlertCircle, Play, History, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { EmptyPanel } from "@/components/common/data-state";
import type { WireScenario } from "@/lib/api/contracts";
import { formatMoney } from "@/lib/format/money";
import { formatDate } from "@/lib/format/dates";
import type { CurrencyCode } from "@/lib/types";

const PARAMETER_TYPES = [
  { value: "price_change", label: "Selling Price Adjustment (%)" },
  { value: "quantity_change", label: "Sales Volume / Demand Shift (%)" },
  { value: "cost_change", label: "Supplier Cost Shift (%)" },
  { value: "expense_change", label: "Operating Overhead Change (%)" },
] as const;

export function SimulatorClient({
  businessId,
  initialScenarios,
}: {
  readonly businessId: string;
  readonly initialScenarios: readonly WireScenario[];
}) {
  const [scenarios, setScenarios] = useState<readonly WireScenario[]>(initialScenarios);
  const [activeScenario, setActiveScenario] = useState<WireScenario | null>(
    initialScenarios[0] ?? null,
  );

  // Form inputs
  const [name, setName] = useState("5% Price Optimization");
  const [paramType, setParamType] = useState<string>("price_change");
  const [percentDelta, setPercentDelta] = useState<string>("5"); // 5%
  const [calculating, setCalculating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCalculating(true);
    setErrorMsg(null);

    const deltaNum = parseFloat(percentDelta) || 0;
    const bps = Math.round(deltaNum * 100); // 5% -> 500 bps

    try {
      const res = await fetch(`/api/businesses/${encodeURIComponent(businessId)}/simulator/scenarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim() || `${deltaNum > 0 ? "+" : ""}${deltaNum}% ${paramType.replace("_", " ")}`,
          description: `Hypothetical ${deltaNum}% adjustment applied across product baseline.`,
          parameters: [
            {
              type: paramType,
              currentValue: 0,
              newValue: bps,
              value: bps,
              unit: "percentage",
            },
          ],
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const rawErr =
          data.error?.message ||
          data.message ||
          (typeof data.error === "string" ? data.error : null) ||
          `Failed to calculate simulation (${res.status})`;
        throw new Error(typeof rawErr === "string" ? rawErr : JSON.stringify(rawErr));
      }

      const json = await res.json();
      const scenario = (json.data ?? json) as WireScenario;
      setScenarios((prev) => [scenario, ...prev]);
      setActiveScenario(scenario);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg === "[object Object]" ? "Failed to calculate simulation. Please check your connection and parameters." : msg);
    } finally {
      setCalculating(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Simulation Builder Form */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Calculator className="size-4 text-primary" aria-hidden="true" />
            <span>Scenario Builder</span>
          </CardTitle>
          <CardDescription className="text-xs">
            Model the outcome of a business decision before acting. All arithmetic is deterministic and pure.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSimulate} className="flex flex-col gap-4">
            {errorMsg && (
              <p className="rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                {errorMsg}
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="sc-name" className="text-xs">Scenario Name</Label>
                <Input
                  id="sc-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. 5% Price Increase"
                  className="h-9 text-xs"
                  required
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="sc-type" className="text-xs">Variable to Alter</Label>
                <Select value={paramType} onValueChange={setParamType}>
                  <SelectTrigger id="sc-type" className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PARAMETER_TYPES.map((p) => (
                      <SelectItem key={p.value} value={p.value} className="text-xs">
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="sc-delta" className="text-xs">Percentage Change (%)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="sc-delta"
                    type="number"
                    step="0.5"
                    value={percentDelta}
                    onChange={(e) => setPercentDelta(e.target.value)}
                    className="h-9 text-xs"
                    required
                  />
                  <Button type="submit" size="sm" disabled={calculating} className="h-9 shrink-0 gap-1.5">
                    <Play className="size-3.5 fill-current" aria-hidden="true" />
                    <span>{calculating ? "Calculating..." : "Run"}</span>
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Active Scenario Results */}
      {activeScenario ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm">Outcome: {activeScenario.name}</h3>
              <Badge
                variant={activeScenario.comparison.adverse ? "destructive" : "default"}
                className="text-xs capitalize"
              >
                {activeScenario.comparison.direction === "increase" ? (
                  <TrendingUp className="size-3 mr-1" />
                ) : (
                  <TrendingDown className="size-3 mr-1" />
                )}
                {activeScenario.comparison.adverse ? "Adverse Impact" : "Profitable Impact"}
              </Badge>
            </div>
            <span className="text-xs text-muted-foreground">
              Calculated on {formatDate(activeScenario.calculatedAt)}
            </span>
          </div>

          {/* Side-by-side Baseline vs Projected */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="bg-card">
              <CardHeader className="pb-2">
                <span className="text-xs text-muted-foreground font-medium">Net Profit Delta</span>
                <CardTitle className="text-xl font-bold tabular-nums">
                  {formatMoney({
                    amount: Math.abs(activeScenario.comparison.profitDelta),
                    currency: (activeScenario.currency as CurrencyCode) || "INR",
                  })}
                  <span className={`text-xs ml-1 font-semibold ${activeScenario.comparison.profitDelta >= 0 ? "text-positive-foreground" : "text-destructive"}`}>
                    {activeScenario.comparison.profitDelta >= 0 ? "(+)" : "(-)"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Baseline: {formatMoney({ amount: activeScenario.baseline.netProfit, currency: (activeScenario.currency as CurrencyCode) || "INR" })} → Projected: {formatMoney({ amount: activeScenario.projected.netProfit, currency: (activeScenario.currency as CurrencyCode) || "INR" })}
              </CardContent>
            </Card>

            <Card className="bg-card">
              <CardHeader className="pb-2">
                <span className="text-xs text-muted-foreground font-medium">Revenue Shift</span>
                <CardTitle className="text-xl font-bold tabular-nums">
                  {formatMoney({
                    amount: Math.abs(activeScenario.comparison.revenueDelta),
                    currency: (activeScenario.currency as CurrencyCode) || "INR",
                  })}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Baseline: {formatMoney({ amount: activeScenario.baseline.revenue, currency: (activeScenario.currency as CurrencyCode) || "INR" })} → Projected: {formatMoney({ amount: activeScenario.projected.revenue, currency: (activeScenario.currency as CurrencyCode) || "INR" })}
              </CardContent>
            </Card>

            <Card className="bg-card">
              <CardHeader className="pb-2">
                <span className="text-xs text-muted-foreground font-medium">Margin Shift</span>
                <CardTitle className="text-xl font-bold tabular-nums">
                  {(activeScenario.comparison.marginDeltaBps / 100).toFixed(2)}%
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Baseline: {(activeScenario.baseline.netMarginBps / 100).toFixed(2)}% → Projected: {(activeScenario.projected.netMarginBps / 100).toFixed(2)}%
              </CardContent>
            </Card>
          </div>

          {/* Model Assumptions & Disclaimers */}
          <div className="rounded-lg border border-border bg-muted/20 p-4 text-xs flex flex-col gap-2">
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              <AlertCircle className="size-3.5 text-caution-foreground" aria-hidden="true" />
              Scenario Assumptions & Boundaries:
            </span>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              {activeScenario.assumptions.map((asm) => (
                <li key={asm.id}>
                  <strong>{asm.statement}</strong> — {asm.limitation}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <EmptyPanel
          icon={<Calculator className="size-8 text-muted-foreground" aria-hidden="true" />}
          title="No simulation run yet"
          description="Use the builder above to model price, volume, or overhead adjustments."
        />
      )}

      {/* Stored Scenarios List */}
      {scenarios.length > 1 && (
        <div className="flex flex-col gap-3 mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <History className="size-3.5" aria-hidden="true" />
            Previous Calculations
          </h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {scenarios.map((sc) => (
              <div
                key={sc.id}
                onClick={() => setActiveScenario(sc)}
                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                  activeScenario?.id === sc.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/40"
                }`}
              >
                <div className="flex flex-col">
                  <span className="font-medium text-xs text-foreground">{sc.name}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(sc.calculatedAt)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold ${sc.comparison.profitDelta >= 0 ? "text-positive-foreground" : "text-destructive"}`}>
                    {sc.comparison.profitDelta >= 0 ? "+" : ""}
                    {formatMoney({ amount: sc.comparison.profitDelta, currency: (sc.currency as CurrencyCode) || "INR" })}
                  </span>
                  {activeScenario?.id === sc.id && <Check className="size-3.5 text-primary" />}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
