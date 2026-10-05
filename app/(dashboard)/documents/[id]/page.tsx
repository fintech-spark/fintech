import { CardHeading } from "@/components/common/card-heading";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";

import { FreshnessLine } from "@/components/common/freshness";
import { PageHeader, SectionHeader } from "@/components/common/page-header";
import { DocumentReview } from "@/components/documents/document-review";
import { DocumentStageRail } from "@/components/documents/document-stage-rail";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { getDocument } from "@/lib/api/endpoints";
import { formatDateTime } from "@/lib/format/dates";
import { safeLabel, shortReference } from "@/lib/format/labels";
import { describeStatus, DOCUMENT_SOURCE_TYPE } from "@/lib/format/status";
import { formatFileSize } from "@/lib/format/money";

export const metadata: Metadata = { title: "Document" };

export default async function DocumentPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  const { id } = await params;
  const businessId = context.activeBusinessId;

  let document: Awaited<ReturnType<typeof getDocument>>;
  try {
    document = await getDocument(businessId, id);
  } catch {
    // 404 covers "gone" and "another business's record" identically.
    notFound();
  }

  return (
    <>
      <PageHeader
        context={context.activeBusiness.name}
        title={safeLabel(document.metadata.originalName)}
        description={describeStatus(DOCUMENT_SOURCE_TYPE, document.sourceType).description}
        backHref="/documents"
        backLabel="All documents"
        toolbar={<FreshnessLine updatedAt={document.uploadedAt} prefix="Uploaded" />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardHeading>Where this document is</CardHeading>
              <CardDescription>
                Every document moves through the same steps. Nothing reaches your
                numbers until you confirm it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DocumentStageRail status={document.status} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardHeading>Your decision</CardHeading>
              <CardDescription>
                Confirming tells Merchant Brain the details were read correctly.
                Rejecting keeps them out of your records and asks for a reason.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DocumentReview businessId={businessId} document={document} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardHeading>Document</CardHeading>
            <CardDescription>What was received.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-3">
              <Row label="Type">
                {describeStatus(DOCUMENT_SOURCE_TYPE, document.sourceType).label}
              </Row>
              <Row label="Size">{formatFileSize(document.fileSize)}</Row>
              <Row label="Uploaded">{formatDateTime(document.uploadedAt)}</Row>
              <Row label="Read at">{formatDateTime(document.processedAt)}</Row>
              {document.metadata.language ? (
                <Row label="Language">{document.metadata.language}</Row>
              ) : null}
              {document.metadata.pageCount ? (
                <Row label="Pages">{document.metadata.pageCount}</Row>
              ) : null}
              <Row label="Reference">
                <span className="font-mono text-xs" title={document.id}>
                  {shortReference(document.id)}
                </span>
              </Row>
              {document.metadata.rejectionReason ? (
                <Row label="Reason given">{document.metadata.rejectionReason}</Row>
              ) : null}
            </dl>

            <p className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-surface-sunken p-3 text-xs text-muted-foreground">
              <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                The original file is not shown in this app yet — only what was
                read out of it. You will be able to compare the two before
                confirming once document storage is connected.
              </span>
            </p>
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="document-audit" className="flex flex-col gap-3">
        <SectionHeader
          id="document-audit"
          title="Document Verification & Extraction Audit"
          description="Verification guarantees and ledger immutability for processed documents."
        />
        <div className="grid gap-3 md:grid-cols-2">
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Extraction Integrity</CardTitle>
              <CardDescription>
                AI and OCR extraction boundaries
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Document line items and totals are validated with strict schema checks before being presented for merchant approval.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Audit Immutability</CardTitle>
              <CardDescription>
                Immutable ledger recording
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Every confirmed invoice or receipt creates an append-only ledger transaction with full actor provenance and timestamp.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </>
  );
}

function Row({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-sm">{children}</dd>
    </div>
  );
}
