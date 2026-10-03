import type { Metadata } from "next";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { PageHeader } from "@/components/common/page-header";
import { getCashFlowForecast } from "@/lib/api/endpoints";
import { settle } from "@/lib/api/settle";
import { CashFlowView } from "@/components/cash-flow/cash-flow-view";

export const metadata: Metadata = { title: "Cash Flow" };

export default async function CashFlowPage() {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  const businessId = context.activeBusinessId;
  const forecastSettled = await settle(getCashFlowForecast(businessId));
  const forecast = forecastSettled.ok ? forecastSettled.value : null;

  return (
    <>
      <PageHeader
        context={context.activeBusiness.name}
        title="Cash Flow & Horizon Forecast"
        description="Monitor current ledger cash, expected receivables inflows, and scheduled supplier payables over the next 30 days."
        backHref="/overview"
        backLabel="Overview"
      />
      <CashFlowView forecast={forecast} businessId={businessId} />
    </>
  );
}
