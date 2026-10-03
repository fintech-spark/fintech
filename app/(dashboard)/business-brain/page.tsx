import type { Metadata } from "next";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { PageHeader } from "@/components/common/page-header";
import { BusinessBrainClient } from "@/components/ai/business-brain-client";

export const metadata: Metadata = { title: "Ask Merchant Brain" };

export default async function BusinessBrainPage() {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  return (
    <>
      <PageHeader
        context={context.activeBusiness.name}
        title="Ask Merchant Brain"
        description="Ask questions about your business in plain language. Answers are computed deterministically from your invoices, sales, expenses, and ledger facts."
        backHref="/overview"
        backLabel="Overview"
      />
      <BusinessBrainClient
        businessId={context.activeBusinessId}
        businessName={context.activeBusiness.name}
      />
    </>
  );
}
