// Merchant Brain: extraction pipeline
//
// FLOW (no step may be skipped, no step may be reordered)
//
//   validate bytes (deterministic, no AI)
//     → authorise tenant            (before retrieval, before any provider call)
//     → load document                (tenant-scoped)
//     → mark processing
//     → build prompt                (untrusted content wrapped)
//     → provider.complete           (multimodal, bounded timeout, bounded retry)
//     → guardJSON                   (parse)
//     → guardOutput                 (Zod validate against the family schema)
//     → classify confidence         (deterministic, Phase 1 thresholds)
//     → persist as CANDIDATE data    (never an authoritative business record)
//     → mark completed
//
// HARD BOUNDARIES
// ---------------
// * The model never receives database credentials and never executes SQL. It
//   has no tools at all — CompletionRequest.tools is deliberately unset.
// * Extraction output is persisted to document_extractions only. It never
//   creates transactions, expenses, customers, suppliers or inventory rows.
//   Business truth is Phase 6's job.
// * Non-transient failures are never retried: unsupported file, schema failure,
//   auth failure. Retrying those burns money and cannot succeed.

import type { TenantContext, BusinessId, DocumentId } from '@/lib/types';
import { asDocumentId } from '@/lib/types';
import {
  AIValidationError,
  BusinessRuleError,
  NotFoundError,
  StorageError,
} from '@/lib/errors';
import {
  guardJSON,
  guardOutput,
  type AIProviderAdapter,
  type CompletionRequest,
  type ModelConfig,
} from '@/lib/ai';
import {
  ExpenseExtractionSchema,
  InvoiceExtractionSchema,
  OrderExtractionSchema,
  type EvidenceRef,
} from '@/lib/ai/schemas';
import type { Document, DocumentStatus } from '@/modules/documents/domain/types';
import type { ExtractionResult, ExtractionField, ConfidenceLevel } from '../domain/types';
import { classifyConfidence } from '../domain/types';
import {
  schemaFamilyForSource,
  validateExtractionInput,
  type ExtractionSchemaFamily,
  type ValidatedFile,
} from '../infrastructure/file-validation';
import {
  EXTRACTION_PROMPT_VERSION,
  buildExtractionSystemPrompt,
  closeUntrustedAttachment,
  openUntrustedAttachment,
  wrapUntrustedContent,
} from './prompt-builder';
import type { ExtractionService } from './service';

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** Tenant-scoped document access. Implementations MUST filter by business id. */
export interface DocumentSource {
  findById(businessId: BusinessId, id: DocumentId): Promise<Document | null>;
  updateStatus(businessId: BusinessId, id: DocumentId, status: DocumentStatus): Promise<void>;
}

/** Candidate-extraction persistence. Never writes authoritative business rows. */
export interface ExtractionRepository {
  findByDocument(businessId: BusinessId, documentId: DocumentId): Promise<ExtractionResult | null>;
  save(result: ExtractionResult): Promise<ExtractionResult>;
}

/** Supplies the raw bytes for a stored document, tenant-scoped. */
export interface DocumentContentLoader {
  load(businessId: BusinessId, storagePath: string): Promise<Buffer>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ExtractionConfig {
  readonly model: ModelConfig;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  /** Deterministic confidence cutoffs come from Phase 1, not from here. */
  readonly persistRawOutput: boolean;
}

export const DEFAULT_EXTRACTION_CONFIG: ExtractionConfig = {
  model: { provider: 'google', modelId: '', role: 'multimodal' },
  timeoutMs: 45_000,
  maxAttempts: 3,
  persistRawOutput: true,
};

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

export interface ExtractionTelemetry {
  record(event: {
    documentId: string;
    status: 'completed' | 'failed';
    provider: string;
    modelId: string;
    durationMs: number;
    attempts: number;
    failureCategory?: string;
    promptTokens?: number;
    completionTokens?: number;
  }): void;
}

const noopTelemetry: ExtractionTelemetry = { record: () => {} };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Validates against the schema for `family`.
 *
 * The three schemas describe different document types, so each is checked in its
 * own branch rather than through a union — a union would force a permissive
 * "any of these" shape and weaken validation.
 */
function validateAgainstFamily(
  family: ExtractionSchemaFamily,
  data: unknown,
  evidence: readonly EvidenceRef[],
): readonly ExtractionField[] {
  if (family === 'invoice') {
    const result = guardOutput(InvoiceExtractionSchema, data);
    if (!result.passed) throw new SchemaMismatch(result.reason);
    return toExtractionFields(result.data, 'invoice', evidence);
  }

  if (family === 'expense') {
    const result = guardOutput(ExpenseExtractionSchema, data);
    if (!result.passed) throw new SchemaMismatch(result.reason);
    return toExtractionFields(result.data, 'expense', evidence);
  }

  const result = guardOutput(OrderExtractionSchema, data);
  if (!result.passed) throw new SchemaMismatch(result.reason);
  return toExtractionFields(result.data, 'order', evidence);
}

/** Failure categories. Only transient ones are retried. */
export type FailureCategory =
  | 'unsupported_input'
  | 'schema_mismatch'
  | 'timeout'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'auth_failed'
  | 'empty_output'
  | 'not_found';

const TRANSIENT: ReadonlySet<FailureCategory> = new Set<FailureCategory>([
  'timeout',
  'rate_limited',
  'provider_unavailable',
]);

export class DefaultExtractionService implements ExtractionService {
  constructor(
    private readonly deps: {
      provider: AIProviderAdapter;
      documents: DocumentSource;
      content: DocumentContentLoader;
      repository: ExtractionRepository;
      config?: Partial<ExtractionConfig>;
      telemetry?: ExtractionTelemetry;
    },
  ) {}

  private get config(): ExtractionConfig {
    return { ...DEFAULT_EXTRACTION_CONFIG, ...this.deps.config };
  }

  async extract(ctx: TenantContext, documentId: DocumentId): Promise<ExtractionResult> {
    const startedAt = Date.now();
    const { documents, content, repository, provider } = this.deps;

    // 1. Authorisation precedes retrieval. businessId comes from TenantContext,
    //    which is resolved from the session — never from the request.
    const document = await documents.findById(ctx.businessId, documentId);
    if (!document) {
      throw new NotFoundError('Document', documentId);
    }

    // Idempotency: one extraction per document. A retry reuses the record
    // rather than creating a second one.
    const existing = await repository.findByDocument(ctx.businessId, documentId);
    if (existing && existing.status !== 'failed') {
      return existing;
    }

    const family = schemaFamilyForSource(document.sourceType);
    if (!family) {
      throw new BusinessRuleError(
        `Extraction is not supported for source type "${document.sourceType}".`,
      );
    }

    // 2. Load bytes through the tenant-scoped loader, then validate locally.
    const bytes = await content.load(ctx.businessId, document.storagePath);

    let file: ValidatedFile;
    try {
      file = validateExtractionInput({
        bytes,
        fileName: document.fileName,
        declaredMimeType: document.mimeType,
      });
    } catch {
      await documents.updateStatus(ctx.businessId, documentId, 'failed');
      throw new BusinessRuleError(
        'The document failed file validation and was not sent to any AI provider.',
      );
    }

    await documents.updateStatus(ctx.businessId, documentId, 'processing');

    // 3. Build the request. No tools are attached — the model cannot act.
    const request = this.buildRequest(document, file, bytes, family);

    let attempts = 0;
    let lastCategory: FailureCategory = 'provider_unavailable';

    while (attempts < this.config.maxAttempts) {
      attempts += 1;
      try {
        const response = await this.completeWithTimeout(request);
        const result = this.persist(ctx, document, family, response.content, response.usage);

        await documents.updateStatus(ctx.businessId, documentId, 'extracted');
        this.telemetry().record({
          documentId,
          status: 'completed',
          provider: provider.provider,
          modelId: this.config.model.modelId,
          durationMs: Date.now() - startedAt,
          attempts,
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
        });

        return result;
      } catch (error) {
        lastCategory = categorise(error);

        // Schema failures and unsupported input are permanent. Retrying them
        // costs money and cannot succeed.
        if (!TRANSIENT.has(lastCategory)) break;
      }
    }

    await documents.updateStatus(ctx.businessId, documentId, 'failed');
    this.telemetry().record({
      documentId,
      status: 'failed',
      provider: provider.provider,
      modelId: this.config.model.modelId,
      durationMs: Date.now() - startedAt,
      attempts,
      failureCategory: lastCategory,
    });

    throw new AIValidationError(
      `Extraction failed after ${attempts} attempt(s) (${lastCategory}).`,
      { documentId, category: lastCategory },
    );
  }

  async getResult(ctx: TenantContext, extractionId: string): Promise<ExtractionResult | null> {
    return this.deps.repository.findByDocument(ctx.businessId, extractionId as DocumentId);
  }

  /** Phase 6 owns business-truth validation. Phase 5 does not approve records. */
  async validate(ctx: TenantContext, extractionId: string): Promise<ExtractionResult> {
    void ctx;
    void extractionId;
    throw new BusinessRuleError(
      'Validation is Phase 6 scope. Extraction results remain candidate data.',
    );
  }

  async getByDocumentId(ctx: TenantContext, documentId: DocumentId): Promise<readonly ExtractionResult[]> {
    const result = await this.deps.repository.findByDocument(ctx.businessId, documentId);
    return result ? [result] : [];
  }

  // -------------------------------------------------------------------------

  private telemetry(): ExtractionTelemetry {
    return this.deps.telemetry ?? noopTelemetry;
  }

  private buildRequest(
    document: Document,
    file: ValidatedFile,
    bytes: Buffer,
    family: ExtractionSchemaFamily,
  ): CompletionRequest {
    const systemPrompt = buildExtractionSystemPrompt(document.sourceType);
    const schema =
      family === 'invoice'
        ? InvoiceExtractionSchema
        : family === 'expense'
          ? ExpenseExtractionSchema
          : OrderExtractionSchema;

    // Text-like inputs go as text; images and PDFs go to the multimodal path so
    // visual documents are not degraded through lossy OCR. The attachment is
    // bracketed by the untrusted markers so text visible *inside* a scan is
    // covered by the wrapper, not floating free of it.
    const userContent = file.multimodal
      ? [
          {
            type: 'text' as const,
            text: openUntrustedAttachment({
              kind: file.kind,
              mediaType: file.detectedMimeType,
            }),
          },
          {
            type: 'file' as const,
            data: bytes.toString('base64'),
            mediaType: file.detectedMimeType,
          },
          { type: 'text' as const, text: closeUntrustedAttachment() },
        ]
      : wrapUntrustedContent(bytes.toString('utf8'));

    return {
      model: this.config.model,
      systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      schema,
      responseFormat: 'json',
    };
  }

  /** Enforces a bounded wall-clock limit so no request hangs indefinitely. */
  private async completeWithTimeout(request: CompletionRequest) {
    const { provider } = this.deps;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new ExtractionTimeout(this.config.timeoutMs));
      }, this.config.timeoutMs);
    });

    try {
      return await Promise.race([provider.complete(request), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Validates the model output and maps it onto the Phase 1 domain type. */
  private persist(
    ctx: TenantContext,
    document: Document,
    family: ExtractionSchemaFamily,
    content: string,
    usage: { promptTokens: number; completionTokens: number },
  ): Promise<ExtractionResult> {
    void usage;
    const json = guardJSON(content);
    if (!json.passed) {
      throw new SchemaMismatch('Model output was not valid JSON.');
    }

    // Evidence is parsed from the validated payload and carried onto the
    // result. It is the input to the confidence grade, not decoration: without
    // it every field would be graded on the model's word alone.
    const evidence = evidenceOf(json.data);
    const fields = validateAgainstFamily(family, json.data, evidence);
    const overallConfidence = deriveOverallConfidence(fields, {
      needsReview: needsReviewOf(json.data),
    });

    const candidate: ExtractionResult = {
      id: crypto.randomUUID(),
      businessId: ctx.businessId,
      documentId: asDocumentId(document.id) as DocumentId,
      status: 'completed',
      fields,
      evidence,
      overallConfidence,
      modelUsed: `${this.config.model.provider}:${this.config.model.modelId}#${EXTRACTION_PROMPT_VERSION}`,
      ...(this.config.persistRawOutput ? { rawOutput: content } : {}),
      extractedAt: new Date(),
    };

    return this.deps.repository.save(candidate);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class ExtractionTimeout extends Error {
  constructor(ms: number) {
    super(`Provider request exceeded ${ms}ms.`);
    this.name = 'ExtractionTimeout';
  }
}

class SchemaMismatch extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'SchemaMismatch';
  }
}

function categorise(error: unknown): FailureCategory {
  if (error instanceof ExtractionTimeout) return 'timeout';
  if (error instanceof SchemaMismatch) return 'schema_mismatch';

  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('rate') || message.includes('429')) return 'rate_limited';
  if (message.includes('401') || message.includes('403') || message.includes('unauthorized')) {
    return 'auth_failed';
  }
  if (message.includes('503') || message.includes('unavailable') || message.includes('502')) {
    return 'provider_unavailable';
  }
  if (error instanceof StorageError) return 'not_found';

  return 'provider_unavailable';
}

/**
 * The evidence references the model supplied for this extraction.
 *
 * Parsed from the already Zod-validated payload, so a reference that reached
 * here has passed `EvidenceRefSchema`. Absent evidence yields an empty list —
 * never a synthesised one.
 */
export function evidenceOf(parsed: unknown): readonly EvidenceRef[] {
  const record = parsed as { evidence?: unknown };
  return Array.isArray(record.evidence) ? (record.evidence as EvidenceRef[]) : [];
}

/** True when the model explicitly asked for human review. */
export function needsReviewOf(parsed: unknown): boolean {
  const record = parsed as { needsReview?: unknown };
  return record.needsReview === true;
}

/**
 * Flattens a validated extraction into the Phase 1 `ExtractionField[]` shape.
 *
 * Only fields the schema actually produced are emitted. A null value becomes a
 * field with value null so that "absent" is preserved rather than dropped —
 * which is what lets a human or Phase 6 see what is missing.
 *
 * Confidence is earned from evidence, never from the fact that extraction
 * returned successfully:
 *
 *   absent                                → low    (nothing was read)
 *   present, no citation for that field   → medium (the model's assertion alone)
 *   cited, but no excerpt                 → low    (a citation that cites nothing)
 *   cited, excerpt does not contain value → low    (the passage does not support
 *                                                   the claim: AI_CONTEXT §10.4)
 *   cited, excerpt contains the value     → high
 */
export function toExtractionFields(
  parsed: unknown,
  family: ExtractionSchemaFamily,
  evidence: readonly EvidenceRef[] = [],
): readonly ExtractionField[] {
  const record = parsed as Record<string, unknown>;
  const fields: ExtractionField[] = [];

  for (const [name, value] of Object.entries(record)) {
    if (name === 'evidence' || name === 'needsReview') continue;

    if (value === null || value === undefined) {
      fields.push({
        name,
        value: null,
        type: inferType(value, family, name),
        // Absence is not a confident extraction. Phase 1 thresholds apply.
        confidence: 'low',
        source: 'absent',
      });
      continue;
    }

    const verdict = corroborate(name, value, evidence);
    fields.push({
      name,
      value,
      type: inferType(value, family, name),
      confidence: verdict.confidence,
      source: verdict.source,
    });
  }

  return fields;
}

/**
 * Grades one present field against the evidence the model cited for it.
 *
 * `evidence` has already been through `EvidenceRefSchema`, so a citation that
 * reaches this function is structurally valid — but structural validity is not
 * support, which is why the excerpt is checked against the value.
 */
function corroborate(
  name: string,
  value: unknown,
  evidence: readonly EvidenceRef[],
): { readonly confidence: ConfidenceLevel; readonly source: string } {
  const citation = evidence.find((ref) => ref.field === name);

  // Uncited: the model asserted it. That is worth no more than medium.
  if (!citation) return { confidence: 'medium', source: 'model' };

  const excerpt = citation.excerpt?.trim() ?? '';
  if (excerpt.length === 0) {
    return { confidence: 'low', source: 'evidence_missing_excerpt' };
  }

  if (!excerptContains(excerpt, value)) {
    return { confidence: 'low', source: 'evidence_contradicts' };
  }

  return { confidence: 'high', source: 'evidence' };
}

/**
 * Whether the cited passage actually shows the extracted value.
 *
 * Scalars are compared as text. Structured values are not: the document writes
 * "₹500.00" while the payload carries `{ amountMinor: 50000, currency: 'INR' }`,
 * and matching their digits would mean doing arithmetic on the model's behalf —
 * the one thing this layer must never do. For those, a non-empty excerpt is the
 * strongest check available here; Phase 6 owns the rest.
 */
function excerptContains(excerpt: string, value: unknown): boolean {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return true;
  }
  return excerpt.toLowerCase().includes(String(value).toLowerCase());
}

function inferType(value: unknown, family: ExtractionSchemaFamily, name: string): ExtractionField['type'] {
  if (name === 'lineItems' || name === 'items') return 'array';
  if (value === null || value === undefined) return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return family === 'invoice' || family === 'expense' ? 'money' : 'number';
  if (typeof value === 'object') return name === 'total' || name === 'amount' ? 'money' : 'string';
  if (name === 'issueDate' || name === 'dueDate' || name === 'occurredOn' || name === 'orderedOn') {
    return 'date';
  }
  return 'string';
}

/**
 * Overall confidence is the LOWEST field confidence, not an average.
 *
 * An average would let a confidently-read vendor name mask a guessed total.
 * One low-confidence field makes the whole result low-confidence, which is the
 * safe direction.
 *
 * `needsReview` is the model's own doubt. It may lower the result and may never
 * raise it.
 */
export function deriveOverallConfidence(
  fields: readonly ExtractionField[],
  options: { readonly needsReview?: boolean } = {},
): ConfidenceLevel {
  let level: ConfidenceLevel = 'medium';
  if (fields.length === 0) level = 'low';
  else if (fields.some((f) => f.confidence === 'low')) level = 'low';
  else if (fields.some((f) => f.confidence === 'medium')) level = 'medium';
  else level = classifyConfidence(1);

  if (options.needsReview && level === 'high') return 'medium';
  return level;
}
