import type { Metadata } from "next";
import { FreshnessLine } from "@/components/common/freshness";
import { PageHeader } from "@/components/common/page-header";
import { SimulatorClient } from "@/components/simulator/simulator-client";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { listScenarios } from "@/lib/api/endpoints";
import { settle } from "@/lib/api/settle";

export const metadata: Metadata = { title: "Simulator" };

export default async function SimulatorPage() {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  const businessId = context.activeBusinessId;
  const loadedAt = new Date();

  const scenariosResult = await settle(listScenarios(businessId));
  const initialScenarios = scenariosResult.ok ? scenariosResult.value.items : [];

  return (
    <>
      <PageHeader
        context={context.activeBusiness.name}
        title="What-If Simulator"
        description="Model changes in prices, supplier costs, volume, or overheads without altering business truth."
        toolbar={<FreshnessLine updatedAt={loadedAt} />}
      />

      <section aria-labelledby="simulator-workspace" className="flex flex-col gap-3">
        <h2 id="simulator-workspace" className="sr-only">
          Simulator Workspace
        </h2>
        <SimulatorClient businessId={businessId} initialScenarios={initialScenarios} />
      </section>
    </>
  );
}
