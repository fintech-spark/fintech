import type { Metadata } from "next";
import { FreshnessLine } from "@/components/common/freshness";
import { MetricCard } from "@/components/common/metric-card";
import { PageHeader } from "@/components/common/page-header";
import { ProfitLeaksView } from "@/components/insights/profit-leaks-view";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { listProfitLeaks } from "@/lib/api/endpoints";
import { settle } from "@/lib/api/settle";
import { formatMoney, formatCount } from "@/lib/format/money";

export const metadata: Metadata = { title: "Profit Leaks" };

export default async function ProfitLeaksPage() {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  const businessId = context.activeBusinessId;
  const loadedAt = new Date();

  const leaksResult = await settle(listProfitLeaks(businessId));
  const leaks = leaksResult.ok ? leaksResult.value : [];

  let totalImpactMinor = 0;
  let criticalCount = 0;

  for (const leak of leaks) {
    totalImpactMinor += leak.impact.amount;
    if (leak.severity === "critical" || leak.severity === "high") {
      criticalCount += 1;
    }
  }

  return (
    <>
      <PageHeader
        context={context.activeBusiness.name}
        title="Profit Leaks"
        description="Measured discrepancies where money is slipping away — backed by evidence, never guessed."
        toolbar={<FreshnessLine updatedAt={loadedAt} />}
      />

      <section aria-labelledby="leaks-summary" className="flex flex-col gap-3">
        <h2 id="leaks-summary" className="sr-only">
          Profit leaks summary
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard
            label="Total Measured Leak Impact"
            tone={totalImpactMinor > 0 ? "negative" : "positive"}
            value={
              leaksResult.ok
                ? formatMoney({ amount: totalImpactMinor, currency: "INR" })
                : "—"
            }
            hint="Estimated financial erosion across all active detector findings."
          />
          <MetricCard
            label="Active Leaks"
            tone={leaks.length > 0 ? "caution" : "positive"}
            value={leaksResult.ok ? formatCount(leaks.length, "leak") : "—"}
            hint="Areas requiring price adjustments, inventory clearance, or vendor renegotiation."
          />
          <MetricCard
            label="Critical / High Severity"
            tone={criticalCount > 0 ? "negative" : "positive"}
            value={leaksResult.ok ? `${criticalCount}` : "—"}
            hint="Immediate operational priorities."
          />
        </div>
      </section>

      <section aria-labelledby="leaks-diagnostics" className="flex flex-col gap-3">
        <ProfitLeaksView businessId={businessId} initialLeaks={leaks} />
      </section>
    </>
  );
}
