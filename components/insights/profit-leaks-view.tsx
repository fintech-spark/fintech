"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Sparkles, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyPanel } from "@/components/common/data-state";
import { MoneyValue } from "@/components/common/money";
import type { WireProfitLeak } from "@/lib/api/contracts";
import { formatDate } from "@/lib/format/dates";

export function ProfitLeaksView({
  businessId,
  initialLeaks,
}: {
  readonly businessId: string;
  readonly initialLeaks: readonly WireProfitLeak[];
}) {
  const [leaks, setLeaks] = useState<readonly WireProfitLeak[]>(initialLeaks);
  const [detecting, setDetecting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>("all");

  const handleRunDetection = async () => {
    setDetecting(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/profit-leaks/detect`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || `Failed to run leak detection (${res.status})`);
      }
      const data = await res.json();
      setLeaks(data.detected || []);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to run leak detection");
    } finally {
      setDetecting(false);
    }
  };

  const filteredLeaks = leaks.filter((leak) => {
    if (severityFilter !== "all" && leak.severity !== severityFilter) return false;
    return true;
  });

  const severityBadgeTone = (sev: string) => {
    switch (sev) {
      case "critical":
        return "destructive";
      case "high":
        return "destructive";
      case "medium":
        return "outline";
      default:
        return "secondary";
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">Automated Margin & Leak Diagnostics</h3>
          <p className="text-xs text-muted-foreground">
            Scans price hikes, dead inventory, and margin erosion with deterministic formulas.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>Filter:</span>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="rounded border border-input bg-background px-2 py-1 text-xs"
            >
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <Button
            size="sm"
            onClick={handleRunDetection}
            disabled={detecting}
            className="gap-1.5"
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
            <span>{detecting ? "Analyzing ledger..." : "Run Leak Analysis"}</span>
          </Button>
        </div>
      </div>

      {filteredLeaks.length === 0 ? (
        <EmptyPanel
          icon={<CheckCircle2 className="size-8 text-positive-foreground" aria-hidden="true" />}
          title="No profit leaks detected"
          description="Your current operating margins, supplier invoices, and inventory turnover show no anomalous variance."
          action={
            <Button size="sm" variant="outline" onClick={handleRunDetection} disabled={detecting}>
              <Activity className="size-3.5 mr-1" aria-hidden="true" />
              Re-run analysis now
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {filteredLeaks.map((leak) => {
              const isExpanded = expandedId === leak.id;
              return (
                <Card key={leak.id} className="transition-all hover:border-foreground/20">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <Badge variant={severityBadgeTone(leak.severity)} className="capitalize text-xs">
                            {leak.severity}
                          </Badge>
                          <span className="text-xs font-mono uppercase text-muted-foreground">
                            {leak.category.replace(/_/g, " ")}
                          </span>
                        </div>
                        <CardTitle className="text-base font-semibold leading-tight mt-1">
                          {leak.title}
                        </CardTitle>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-xs text-muted-foreground">Est. Impact</span>
                        <span className="text-base font-bold tabular-nums text-destructive">
                          <MoneyValue value={leak.impact} />
                        </span>
                      </div>
                    </div>
                    <CardDescription className="text-xs mt-2 line-clamp-2">
                      {leak.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0 flex flex-col gap-3">
                    {leak.suggestedInvestigation && (
                      <div className="rounded border border-border/60 bg-muted/30 p-2.5 text-xs text-foreground">
                        <span className="font-semibold block mb-0.5">Recommended Check:</span>
                        {leak.suggestedInvestigation}
                      </div>
                    )}

                    {isExpanded && (
                      <div className="flex flex-col gap-2.5 pt-2 border-t border-border text-xs">
                        <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                          <div>
                            <span className="font-medium text-foreground">Period:</span> {leak.impactPeriod}
                          </div>
                          <div>
                            <span className="font-medium text-foreground">Detected:</span> {formatDate(leak.detectedAt)}
                          </div>
                        </div>

                        {leak.evidence.length > 0 && (
                          <div className="flex flex-col gap-1 mt-1">
                            <span className="font-semibold text-foreground">Evidence Records:</span>
                            <div className="space-y-1">
                              {leak.evidence.map((ev, i) => (
                                <div key={i} className="flex items-center justify-between rounded bg-surface-sunken p-1.5 font-mono text-xs">
                                  <span>{ev.description}</span>
                                  <span className="text-muted-foreground">{ev.type}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedId(isExpanded ? null : leak.id)}
                      className="w-full h-8 text-xs text-muted-foreground justify-between mt-1"
                    >
                      <span>{isExpanded ? "Hide calculation & evidence" : "View calculation details"}</span>
                      {isExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
