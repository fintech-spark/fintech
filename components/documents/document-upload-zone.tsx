"use client";

import { useState, useRef } from "react";
import { useRouter } from 'next/navigation';
import { UploadCloud, FileText, CheckCircle2, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024;

export function DocumentUploadZone({
  businessId,
}: {
  readonly businessId: string;
}) {
  const router = useRouter();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sourceType, setSourceType] = useState<string>("invoice");
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (file: File | null) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setSelectedFile(null);
    if (!file) return;

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setErrorMsg("File exceeds the maximum 4MB size limit.");
      return;
    }

    if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) {
      setErrorMsg("Upload an invoice or receipt as PDF, PNG, JPEG or WebP.");
      return;
    }

    // Auto-detect source type
    if (file.name.toLowerCase().includes("receipt")) {
      setSourceType("receipt");
    } else if (file.name.toLowerCase().includes("invoice")) {
      setSourceType("invoice");
    }

    setSelectedFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;

    setUploading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const form = new FormData();
    form.set("file", selectedFile);
    form.set("sourceType", sourceType);

    try {
      const res = await fetch(`/api/businesses/${businessId}/documents`, {
        method: "POST",
        body: form,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || `Upload could not be confirmed (${res.status}).`);

      setSuccessMsg(data.data.status === "failed"
        ? "File saved privately. Extraction failed; open the document to retry."
        : "File saved privately. Open the document to review extracted candidates before approval.");
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.push(`/documents/${data.data.id}`);
      router.refresh();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Upload could not be confirmed. Refresh the documents list before retrying.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <UploadCloud className="size-4 text-primary" aria-hidden="true" />
          <span>Upload Invoices & Receipts</span>
        </CardTitle>
        <CardDescription className="text-xs">
          Files are ingested into the processing pipeline for OCR and structured data extraction.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {errorMsg && (
            <div role="alert" className="flex items-center gap-2 rounded border border-destructive/50 bg-destructive/10 p-2.5 text-xs text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="flex items-center gap-2 rounded border border-positive-border bg-positive-subtle p-2.5 text-xs text-positive-foreground">
              <CheckCircle2 className="size-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-6 text-center hover:bg-muted/30 transition-colors"
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
               accept=".pdf,.png,.jpg,.jpeg,.webp"
              className="hidden"
              id="file-upload"
            />
            <FileText className="size-8 text-muted-foreground mb-2" aria-hidden="true" />
            <p className="text-sm font-medium">
              {selectedFile ? selectedFile.name : "Drag and drop your file here, or browse"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Invoice or receipt: PDF, PNG, JPEG, WebP (up to 4MB)
            </p>
            {!selectedFile ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose File
              </Button>
            ) : (
              <div className="flex items-center gap-2 mt-3">
                <span className="text-xs font-mono text-muted-foreground">
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </span>
                <Button
                  type="button"
                   variant="ghost"
                   aria-label="Remove selected file"
                  size="sm"
                  onClick={() => {
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="size-7 p-0"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            )}
          </div>

          {selectedFile && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="source-type" className="text-xs">Document Type</Label>
                <Select value={sourceType} onValueChange={setSourceType}>
                  <SelectTrigger id="source-type" className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="invoice">Invoice</SelectItem>
                    <SelectItem value="receipt">Receipt</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end">
                <Button
                  type="submit"
                  size="sm"
                  disabled={uploading}
                  className="w-full h-9"
                >
                  {uploading ? "Ingesting Document..." : "Confirm & Ingest"}
                </Button>
              </div>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
