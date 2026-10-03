"use client";

// Merchant Brain: documents table — the ingestion pipeline as a merchant sees it.
//
// A document is a thing that moves through a visible pipeline: uploaded,
// checked, read, waiting for you, confirmed. The status column carries the
// label AND the meaning, so the state never depends on colour.

import { useCallback } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";

import { DataTable, RecordCard, TableFrame, type DataColumn } from "@/components/data/data-table";
import { FilterBar, StatusTabs } from "@/components/data/filter-bar";
import { SearchInput } from "@/components/data/search-input";
import { TablePagination } from "@/components/data/table-pagination";
import { useUrlState } from "@/components/data/url-state";
import { EmptyPanel, ErrorPanel } from "@/components/common/data-state";
import { StatusBadge } from "@/components/common/status-badge";
import type { Page } from "@/lib/api/client";
import type { WireDocument } from "@/lib/api/contracts";
import type { Settled } from "@/lib/api/settle";
import { formatDateTime } from "@/lib/format/dates";
import { safeLabel } from "@/lib/format/labels";
import { formatFileSize } from "@/lib/format/money";
import { describeStatus, DOCUMENT_SOURCE_TYPE, DOCUMENT_STATUS } from "@/lib/format/status";

const STATUS_TABS = [
  { value: "review_required", label: "Needs review" },
  { value: "processing", label: "Being read" },
  { value: "approved", label: "Confirmed" },
  { value: "rejected", label: "Rejected" },
  { value: "failed", label: "Failed" },
] as const;

const SOURCE_OPTIONS = [
  { value: "invoice", label: "Invoice" },
  { value: "receipt", label: "Receipt" },
  { value: "upi_screenshot", label: "UPI screenshot" },
  { value: "csv", label: "CSV file" },
  { value: "excel", label: "Excel file" },
  { value: "whatsapp_export", label: "WhatsApp export" },
  { value: "audio", label: "Voice note" },
  { value: "image", label: "Image" },
  { value: "pdf", label: "PDF" },
] as const;

export function DocumentsTable({
  search,
  status,
  sourceType,
  result,
}: {
  readonly search?: string;
  readonly status?: string;
  readonly sourceType?: string;
  readonly result: Settled<Page<WireDocument>>;
}) {
  const url = useUrlState();
  const setPage = useCallback((next: number) => url.set("page", String(next)), [url]);

  if (!result.ok) {
    return <ErrorPanel error={result.error} variant="card" />;
  }

  const documents = result.value;

  const columns: readonly DataColumn<WireDocument>[] = [
    {
      key: "file",
      header: "Document",
      cell: (document) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <Link
            href={`/documents/${encodeURIComponent(document.id)}`}
            className="truncate font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {safeLabel(document.metadata.originalName)}
          </Link>
          <span className="truncate text-xs text-muted-foreground">
            {describeStatus(DOCUMENT_SOURCE_TYPE, document.sourceType).label} ·{" "}
            {formatFileSize(document.fileSize)}
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: "State",
      cell: (document) => (
        <StatusBadge
          descriptor={describeStatus(DOCUMENT_STATUS, document.status)}
          showIcon={false}
          size="sm"
        />
      ),
    },
    {
      key: "uploaded",
      header: "Uploaded",
      hideBelow: "md",
      cell: (document) => (
        <span className="text-muted-foreground">{formatDateTime(document.uploadedAt)}</span>
      ),
    },
    {
      key: "processed",
      header: "Read at",
      hideBelow: "lg",
      cell: (document) => (
        <span className="text-muted-foreground">
          {formatDateTime(document.processedAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <StatusTabs param="status" tabs={STATUS_TABS} allLabel="All documents" />

      <FilterBar
        isPending={url.isPending}
        search={
          <SearchInput
            label="Search documents"
            placeholder="File name…"
            value={search ?? ""}
            onValueChange={(next) => url.setMany({ search: next || null, page: null })}
          />
        }
        selects={[
          {
            param: "sourceType",
            label: "Document type",
            allLabel: "All types",
            options: SOURCE_OPTIONS,
          },
        ]}
      />

      {documents.items.length === 0 ? (
        <EmptyPanel
          variant="card"
          icon={<FileText aria-hidden={true} className="size-5 text-muted-foreground" />}
          title={
            search || status || sourceType ? "No documents match" : "No documents yet"
          }
          description={
            search || status || sourceType
              ? "Nothing matches this search and filter. Try a shorter search term, or clear the filters."
              : "When an invoice, receipt or spreadsheet is added to Merchant Brain it appears here, along with where it is in the reading process."
          }
        />
      ) : (
        <TableFrame>
          <DataTable
            caption="Documents"
            captionDescription="Each document, its type, and where it is in the reading process."
            columns={columns}
            rows={documents.items}
            rowKey={(document) => document.id}
            renderMobileCard={(document) => (
              <RecordCard
                href={`/documents/${encodeURIComponent(document.id)}`}
                title={safeLabel(document.metadata.originalName)}
                subtitle={`${describeStatus(DOCUMENT_SOURCE_TYPE, document.sourceType).label} · uploaded ${formatDateTime(document.uploadedAt)}`}
                status={
                  <StatusBadge
                    descriptor={describeStatus(DOCUMENT_STATUS, document.status)}
                    showIcon={false}
                    size="sm"
                  />
                }
              />
            )}
            footer={
              <TablePagination
                page={documents}
                itemName="document"
                onPageChange={setPage}
                onLimitChange={(next) => url.setMany({ limit: String(next), page: null })}
              />
            }
          />
        </TableFrame>
      )}
    </div>
  );
}
