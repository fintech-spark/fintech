# File upload security rules

Merchant Brain may eventually accept images, PDFs, audio, CSV, and Excel files. Upload handling is not implemented in the setup slice. These are default guardrails to validate with product/security owners before implementation.

## Intake policy

- Accept only an explicit allowlist of extensions and MIME types: common JPEG/PNG/WebP images, PDF, supported audio formats, CSV, and approved Excel formats.
- Validate extension, declared MIME, and magic bytes independently. Do not trust the filename or browser-provided MIME.
- Sanitize filenames to generated opaque IDs; never use user filenames as storage paths or executable names.
- Set per-file and per-request limits. Initial defaults to review: images 10 MB, PDFs 25 MB, audio 25 MB, CSV/XLSX 10 MB, and 50 MB total request size.
- Reject encrypted/password-protected or malformed files unless an explicit safe processing path exists.
- Normalize image dimensions, PDF page count, spreadsheet row/column counts, and audio duration before expensive processing.

## Isolation and processing

- Store files outside the web root with tenant-scoped, non-guessable object keys and short-lived access URLs.
- Keep original bytes immutable; write derived/OCR/transcript artifacts to separate versioned records.
- Scan files with an approved malware scanner/sandbox where available. Quarantine failures and do not send untrusted content to every downstream service.
- Never execute uploaded files, macros, embedded scripts, HTML, or formulas. Treat spreadsheets as data; neutralize formula injection on export.
- Apply CPU, memory, page, row, duration, network, and wall-clock timeouts. Use asynchronous jobs with bounded retries and cancellation.
- Enforce authorization on download, processing, and derived artifacts; verify tenant scope at every step.

## AI-specific handling

- OCR text, metadata, alt text, transcripts, and spreadsheet cells are untrusted data and may contain prompt injection.
- Delimit source content and instruct models to treat it as data, never as policy or tool instructions.
- Strip or quarantine hidden instructions, suspicious links, and embedded commands where appropriate; retain an evidence reference without executing them.
- Do not include secrets, unrelated tenant records, or unnecessary raw documents in model context.
- Validate extraction output with Zod and deterministic business rules before persistence or display.

## User experience and audit

Tell users why a file was rejected without exposing scanner internals. Provide safe retry guidance and a support/reference ID. Record file hash, type, size, scanner/parser versions, processing state, and redacted failure category. Apply retention/deletion policies and support user-initiated deletion.
