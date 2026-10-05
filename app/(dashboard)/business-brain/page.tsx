import type { Metadata } from "next";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { PageHeader } from "@/components/common/page-header";
import { BusinessBrainClient } from "@/components/ai/business-brain-client";
import { z } from "zod";

export const metadata: Metadata = { title: "Ask Merchant Brain" };

export default async function BusinessBrainPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;
  const session = z.string().uuid().safeParse((await searchParams).session);
  const initialSessionId = session.success ? session.data : crypto.randomUUID();

  return (
    <>
      <PageHeader
        context={context.activeBusiness.name}
        title="Ask Merchant Brain"
        description="Ask questions about your business in plain language. Answers are grounded in your recorded business facts; numbers are computed deterministically."
        backHref="/overview"
        backLabel="Overview"
      />
      <BusinessBrainClient
        initialSessionId={initialSessionId}
        key={`${context.session.userId}:${context.activeBusinessId}`}
        businessId={context.activeBusinessId}
        businessName={context.activeBusiness.name}
      />
    </>
  );
}
