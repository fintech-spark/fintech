import type { Metadata } from "next";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { PageHeader } from "@/components/common/page-header";
import { getActions } from "@/lib/api/endpoints";
import { settle } from "@/lib/api/settle";
import { ActionsClient } from "@/components/actions/actions-client";

export const metadata: Metadata = { title: "Action Center" };

export default async function ActionsPage() {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  const businessId = context.activeBusinessId;
  const actionsSettled = await settle(getActions(businessId));
  const initialActions = actionsSettled.ok ? actionsSettled.value : [];

  return (
    <>
      <PageHeader
        context={context.activeBusiness.name}
        title="Action Center"
        description="Review, authorize, and execute prepared operational actions. Nothing executes without explicit approval."
        backHref="/overview"
        backLabel="Overview"
      />
      <ActionsClient businessId={businessId} initialActions={initialActions} />
    </>
  );
}
