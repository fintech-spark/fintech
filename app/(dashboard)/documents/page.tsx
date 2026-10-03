import type { Metadata } from "next";

import { CapabilityPanel } from "@/components/common/data-state";
import { FreshnessLine } from "@/components/common/freshness";
import { MetricCard } from "@/components/common/metric-card";
import { PageHeader, SectionHeader } from "@/components/common/page-header";
import { DocumentsTable } from "@/components/documents/documents-table";
import {
  PARAM,
  DOCUMENT_STATUS_VALUES,
  readEnum,
  readPageNumber,
  readPageSize,
  readParam,
  type RawSearchParams,
} from "@/components/data/params";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { listDocuments } from "@/lib/api/endpoints";
import { pendingCapability } from "@/lib/api/pending";
import { settle } from "@/lib/api/settle";
import { formatCount } from "@/lib/format/money";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage({
  searchParams,
}: {
  readonly searchParams: Promise<RawSearchParams>;
}) {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  const params = await searchParams;
  const page = readPageNumber(params);
  const limit = readPageSize(params);
  const search = readParam(params, PARAM.search, 80);
  const status = readEnum(params, PARAM.status, DOCUMENT_STATUS_VALUES);
  const sourceType = readEnum(params, PARAM.sourceType, [
    "invoice",
    "receipt",
    "upi_screenshot",
    "pdf",
    "audio",
    "csv",
    "excel",
    "whatsapp_export",
    "text",
    "image",
    "other",
  ] as const);

  const businessId = context.activeBusinessId;
  const loadedAt = new Date();

  const documentsRequest = settle(
    listDocuments(businessId, { page, limit, search, status, sourceType }),
  );
  // The waiting count is a separate query so the summary stays correct even when
  // the current tab is filtered to something else.
  const waitingRequest = settle(
    listDocuments(businessId, { status: "review_required", limit: 1 }),
  );

  const [documents, waiting] = await Promise.all([documentsRequest, waitingRequest]);

  return (
    <>
      <PageHeader
        context={context.activeBusiness.name}
        title="Documents"
        description="Invoices, receipts and files you have added. Each one is read, then checked by you before it counts."
        toolbar={<FreshnessLine updatedAt={loadedAt} />}
      />

      <section aria-labelledby="document-summary" className="flex flex-col gap-3">
        <h2 id="document-summary" className="sr-only">
          Document summary
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <MetricCard
            label="Waiting for your confirmation"
            tone={waiting.ok && waiting.value.total > 0 ? "caution" : "positive"}
            value={waiting.ok ? formatCount(waiting.value.total, "document") : "—"}
            hint="Read successfully but not yet confirmed. These do not affect your numbers until you confirm them."
          />
          <MetricCard
            label="Showing"
            value={documents.ok ? formatCount(documents.value.total, "document") : "—"}
            hint="Matches your current search and filters. Narrow the list with the tabs above."
          />
        </div>
      </section>

      <section aria-labelledby="document-list" className="flex flex-col gap-3">
        <SectionHeader
          id="document-list"
          title="All documents"
          description="The state column tells you where each document is: received, being read, waiting for you, or confirmed."
        />
        <DocumentsTable
          search={search}
          status={status}
          sourceType={sourceType}
          result={documents}
        />
      </section>

      <CapabilityPanel capability={pendingCapability("documentUpload")} />
    </>
  );
}
