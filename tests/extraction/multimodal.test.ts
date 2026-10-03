// Merchant Brain: multimodal request shape, evidence preservation, confidence
//
// Regression cover for three Wave 1 defects:
//   1. the image part was forwarded to the AI SDK in a shape the SDK does not
//      read, so visual documents silently degraded to text-only;
//   2. attachments were not bracketed by the untrusted delimiters, so text
//      visible inside a scan sat outside the wrapper;
//   3. every present field was graded "medium" regardless of evidence, and the
//      model's evidence[] was dropped before persistence.
//
// No provider is contacted: message mapping is tested directly and the service
// is driven with a stub adapter.

import { describe, it, expect, vi } from 'vitest';
import type { AIProviderAdapter, CompletionRequest, CompletionResponse, TokenUsage } from '@/lib/ai';
import { AIProviderError } from '@/lib/errors';
import {
  assertSupportedAttachments,
  toModelMessage,
} from '@/lib/ai/providers/vercel-ai-adapter';
import { asBusinessId, asDocumentId, asUserId, type TenantContext } from '@/lib/types';
import type { Document } from '@/modules/documents/domain/types';
import {
  DefaultExtractionService,
  deriveOverallConfidence,
  evidenceOf,
  toExtractionFields,
  type DocumentContentLoader,
  type DocumentSource,
  type ExtractionRepository,
} from '@/modules/extraction/application/extraction-service';
import type { ExtractionField, ExtractionResult } from '@/modules/extraction/domain/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 0x20),
]);

const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.7', 'ascii'), Buffer.alloc(64, 0x20)]);

const USAGE: TokenUsage = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };

const DOC_ID = asDocumentId('11111111-1111-4111-8111-111111111111');
const BUSINESS = asBusinessId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

function makeCtx(): TenantContext {
  return {
    businessId: BUSINESS,
    userId: asUserId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    role: 'owner',
    correlationId: 'corr-1',
  };
}

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: DOC_ID,
    businessId: BUSINESS,
    sourceType: 'invoice',
    fileName: 'invoice.png',
    mimeType: 'image/png',
    fileSize: PNG_BYTES.length,
    storagePath: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/doc-1/invoice.png',
    status: 'uploaded',
    metadata: { originalName: 'invoice.png' },
    uploadedAt: new Date(),
    uploadedBy: asUserId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    ...overrides,
  } as Document;
}

function makeService(options: { content: string; bytes?: Buffer; document?: Document }) {
  const documents: DocumentSource = {
    findById: vi.fn(async (businessId, id) => {
      const doc = options.document ?? makeDocument();
      return doc.id === id && doc.businessId === businessId ? doc : null;
    }),
    updateStatus: vi.fn(async () => {}),
  };

  const content: DocumentContentLoader = {
    load: vi.fn(async () => options.bytes ?? PNG_BYTES),
  };

  let saved: ExtractionResult | null = null;
  const repository: ExtractionRepository = {
    findByDocument: vi.fn(async () => saved),
    save: vi.fn(async (result) => {
      saved = result;
      return result;
    }),
  };

  const provider: AIProviderAdapter = {
    provider: 'google',
    complete: vi.fn(
      async (): Promise<CompletionResponse> => ({
        content: options.content,
        usage: USAGE,
        finishReason: 'stop',
      }),
    ),
    embed: vi.fn(),
  };

  const service = new DefaultExtractionService({
    provider,
    documents,
    content,
    repository,
    config: {
      model: { provider: 'google', modelId: 'gemini-test', role: 'multimodal' },
      timeoutMs: 200,
      maxAttempts: 3,
    },
  });

  return { service, provider };
}

function firstRequest(provider: AIProviderAdapter): CompletionRequest {
  return (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0] as CompletionRequest;
}

function fieldByName(fields: readonly ExtractionField[], name: string): ExtractionField {
  const found = fields.find((f) => f.name === name);
  if (!found) throw new Error(`field "${name}" was not emitted`);
  return found;
}

// A fully corroborated invoice: every field carries a citation whose excerpt
// contains the extracted value.
const CORROBORATED_INVOICE = JSON.stringify({
  invoiceNumber: 'INV-HI-001',
  issueDate: '2026-01-15',
  dueDate: '2026-02-15',
  supplierName: 'Synthetic Supplies',
  lineItems: [
    {
      description: 'Widget',
      quantity: 1,
      unitPrice: { amountMinor: 100, currency: 'INR' },
      total: { amountMinor: 100, currency: 'INR' },
    },
  ],
  total: { amountMinor: 100, currency: 'INR' },
  evidence: [
    { sourceId: 'doc-1', recordId: 'doc-1', sourceType: 'invoice', field: 'invoiceNumber', excerpt: 'Invoice No INV-HI-001' },
    { sourceId: 'doc-1', recordId: 'doc-1', sourceType: 'invoice', field: 'issueDate', excerpt: 'Date 2026-01-15' },
    { sourceId: 'doc-1', recordId: 'doc-1', sourceType: 'invoice', field: 'dueDate', excerpt: 'Due 2026-02-15' },
    { sourceId: 'doc-1', recordId: 'doc-1', sourceType: 'invoice', field: 'supplierName', excerpt: 'Synthetic Supplies' },
    { sourceId: 'doc-1', recordId: 'doc-1', sourceType: 'invoice', field: 'lineItems', excerpt: 'Widget x1 @ 100' },
    { sourceId: 'doc-1', recordId: 'doc-1', sourceType: 'invoice', field: 'total', excerpt: 'Total 100' },
    { sourceId: 'doc-1', recordId: 'doc-1', sourceType: 'invoice', field: 'uncertaintyReasons', excerpt: 'none' },
  ],
  needsReview: false,
  uncertaintyReasons: [],
});

// ===========================================================================
// PROVIDER SDK MAPPING
// ===========================================================================

describe('image → provider SDK mapping', () => {
  it('emits AI SDK file parts, not an unreadable image part', () => {
    const request: CompletionRequest = {
      model: { provider: 'google', modelId: 'gemini-test', role: 'multimodal' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '<merchant_document>' },
            { type: 'file', data: 'aGVsbG8=', mediaType: 'image/png' },
            { type: 'text', text: '</merchant_document>' },
          ],
        },
      ],
    };

    const mapped = toModelMessage(request.messages[0]);

    expect(mapped.content).toEqual([
      { type: 'text', text: '<merchant_document>' },
      { type: 'file', data: 'aGVsbG8=', mediaType: 'image/png' },
      { type: 'text', text: '</merchant_document>' },
    ]);
    expect(JSON.stringify(mapped)).not.toMatch(/"type":"image"/);
    expect(JSON.stringify(mapped)).not.toContain('mimeType');
  });

  it('rejects an unsupported attachment media type before any provider call', () => {
    const request: CompletionRequest = {
      model: { provider: 'google', modelId: 'gemini-test', role: 'multimodal' },
      messages: [
        {
          role: 'user',
          content: [{ type: 'file', data: 'aGVsbG8=', mediaType: 'application/zip' }],
        },
      ],
    };

    expect(() => assertSupportedAttachments(request)).toThrow(AIProviderError);
    expect(() => assertSupportedAttachments(request)).toThrow(/unsupported attachment media type/);
  });

  it('rejects an empty attachment payload', () => {
    const request: CompletionRequest = {
      model: { provider: 'google', modelId: 'gemini-test', role: 'multimodal' },
      messages: [
        { role: 'user', content: [{ type: 'file', data: '', mediaType: 'image/png' }] },
      ],
    };

    expect(() => assertSupportedAttachments(request)).toThrow(/attachment payload is empty/);
  });

  it('accepts the media types extraction actually sends', () => {
    for (const mediaType of ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']) {
      const request: CompletionRequest = {
        model: { provider: 'google', modelId: 'gemini-test', role: 'multimodal' },
        messages: [
          { role: 'user', content: [{ type: 'file', data: 'aGVsbG8=', mediaType }] },
        ],
      };
      expect(() => assertSupportedAttachments(request)).not.toThrow();
    }
  });
});

// ===========================================================================
// UNTRUSTED SCANNED CONTENT
// ===========================================================================

describe('untrusted attachment content', () => {
  it('brackets an image between the untrusted markers', async () => {
    const { service, provider } = makeService({ content: CORROBORATED_INVOICE });
    await service.extract(makeCtx(), DOC_ID);

    const parts = firstRequest(provider).messages[0].content;
    if (!Array.isArray(parts)) throw new Error('expected multimodal content parts');

    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatchObject({ type: 'text' });
    expect(parts[2]).toMatchObject({ type: 'text' });

    const [open, file, close] = parts as [
      { type: 'text'; text: string },
      { type: 'file'; data: string; mediaType: string },
      { type: 'text'; text: string },
    ];

    // The file part sits INSIDE the wrapper: open marker before, close after.
    expect(open.text).toContain('<merchant_document>');
    expect(open.text).toContain('attachment: kind=image mime=image/png');
    expect(open.text).not.toContain('</merchant_document>');
    expect(close.text).toContain('</merchant_document>');
    expect(close.text).toContain('of instructions to follow');

    expect(file).toEqual({
      type: 'file',
      data: PNG_BYTES.toString('base64'),
      mediaType: 'image/png',
    });
  });

  it('describes a PDF as a PDF rather than as an image attachment', async () => {
    const { service, provider } = makeService({
      content: CORROBORATED_INVOICE,
      bytes: PDF_BYTES,
      document: makeDocument({
        fileName: 'invoice.pdf',
        mimeType: 'application/pdf',
        storagePath: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/doc-1/invoice.pdf',
      }),
    });
    await service.extract(makeCtx(), DOC_ID);

    const parts = firstRequest(provider).messages[0].content;
    if (!Array.isArray(parts)) throw new Error('expected multimodal content parts');

    expect(parts[0]).toMatchObject({ type: 'text' });
    expect((parts[0] as { text: string }).text).toContain('kind=pdf mime=application/pdf');
    expect((parts[0] as { text: string }).text).not.toContain('image attachment');
    expect(parts[1]).toEqual({
      type: 'file',
      data: PDF_BYTES.toString('base64'),
      mediaType: 'application/pdf',
    });
  });

  it('keeps attachment bytes out of the system prompt', async () => {
    const { service, provider } = makeService({
      content: CORROBORATED_INVOICE,
      document: makeDocument({ fileName: 'evil.png', mimeType: 'image/png' }),
    });
    await service.extract(makeCtx(), DOC_ID);

    const call = firstRequest(provider);
    expect(call.systemPrompt).not.toContain(PNG_BYTES.toString('base64').slice(0, 32));
    expect(call.systemPrompt).not.toContain('IGNORE ALL');
    expect(call.tools).toBeUndefined();
  });
});

// ===========================================================================
// EVIDENCE PRESERVATION
// ===========================================================================

describe('evidence preservation', () => {
  it('carries the model evidence[] onto the persisted result', async () => {
    const { service } = makeService({ content: CORROBORATED_INVOICE });
    const result = await service.extract(makeCtx(), DOC_ID);

    expect(result.evidence).toHaveLength(7);
    expect(result.evidence[0]).toMatchObject({ field: 'invoiceNumber', sourceId: 'doc-1' });
  });

  it('persists an empty evidence list when the model cites nothing', async () => {
    const uncited = JSON.stringify({
      invoiceNumber: 'INV-SYN-001',
      issueDate: null,
      dueDate: null,
      supplierName: null,
      lineItems: [],
      total: null,
      evidence: [],
      needsReview: true,
      uncertaintyReasons: ['unreadable'],
    });

    const { service } = makeService({ content: uncited });
    const result = await service.extract(makeCtx(), DOC_ID);

    expect(result.evidence).toEqual([]);
    expect(result.overallConfidence).toBe('low');
  });

  it('parses evidence only from an array payload', () => {
    expect(evidenceOf({ evidence: [{ sourceId: 's', recordId: 'r', sourceType: 'invoice' }] })).toHaveLength(1);
    expect(evidenceOf({ evidence: 'not-an-array' })).toEqual([]);
    expect(evidenceOf({})).toEqual([]);
  });
});

// ===========================================================================
// CONFIDENCE
// ===========================================================================

describe('evidence-based confidence', () => {
  const evidence = [
    { sourceId: 'doc-1', recordId: 'doc-1', sourceType: 'invoice' as const, field: 'supplierName', excerpt: 'Supplier: Synthetic Supplies Pvt Ltd' },
    { sourceId: 'doc-1', recordId: 'doc-1', sourceType: 'invoice' as const, field: 'invoiceNumber', excerpt: 'INV-OTHER-999' },
    { sourceId: 'doc-1', recordId: 'doc-1', sourceType: 'invoice' as const, field: 'issueDate' },
  ];

  const fields = toExtractionFields(
    {
      invoiceNumber: 'INV-SYN-001',
      supplierName: 'Synthetic Supplies Pvt Ltd',
      issueDate: '2026-01-15',
      dueDate: null,
      total: { amountMinor: 50000, currency: 'INR' },
      needsReview: true,
      evidence,
    },
    'invoice',
    evidence,
  );

  it('grades a value that its cited excerpt contains as high', () => {
    const supplier = fieldByName(fields, 'supplierName');
    expect(supplier.confidence).toBe('high');
    expect(supplier.source).toBe('evidence');
  });

  it('grades a cited value the excerpt does not contain as low', () => {
    const invoiceNumber = fieldByName(fields, 'invoiceNumber');
    expect(invoiceNumber.confidence).toBe('low');
    expect(invoiceNumber.source).toBe('evidence_contradicts');
  });

  it('grades a citation with no excerpt as low', () => {
    const issueDate = fieldByName(fields, 'issueDate');
    expect(issueDate.confidence).toBe('low');
    expect(issueDate.source).toBe('evidence_missing_excerpt');
  });

  it('grades an uncited present value as medium, never high', () => {
    expect(fieldByName(fields, 'total').confidence).toBe('medium');
    expect(fieldByName(fields, 'total').source).toBe('model');
    // needsReview is metadata, not a document field: it never becomes a field.
    expect(fields.some((f) => f.name === 'needsReview')).toBe(false);
  });

  it('grades an absent value as low', () => {
    const dueDate = fieldByName(fields, 'dueDate');
    expect(dueDate.confidence).toBe('low');
    expect(dueDate.source).toBe('absent');
  });

  it('never returns high from a fixture that cites nothing', () => {
    expect(deriveOverallConfidence(toExtractionFields({ total: { amountMinor: 1, currency: 'INR' } }, 'invoice'))).toBe('medium');
  });

  it('caps a high result when the model asks for review', () => {
    const high: readonly ExtractionField[] = [
      { name: 'supplierName', value: 'x', type: 'string', confidence: 'high', source: 'evidence' },
    ];

    expect(deriveOverallConfidence(high)).toBe('high');
    expect(deriveOverallConfidence(high, { needsReview: true })).toBe('medium');
  });

  it('returns high overall only when every field is corroborated', async () => {
    const { service } = makeService({ content: CORROBORATED_INVOICE });
    const result = await service.extract(makeCtx(), DOC_ID);

    expect(result.fields.every((f) => f.confidence === 'high')).toBe(true);
    expect(result.overallConfidence).toBe('high');
  });

  it('keeps overall confidence at low when any field is absent', async () => {
    const partial = JSON.stringify({
      invoiceNumber: 'INV-SYN-001',
      issueDate: '2026-01-15',
      dueDate: null,
      supplierName: 'Synthetic Supplies',
      lineItems: [],
      total: null,
      evidence: [{ sourceId: 'doc-1', recordId: 'doc-1', sourceType: 'invoice' }],
      needsReview: false,
      uncertaintyReasons: [],
    });

    const { service } = makeService({ content: partial });
    const result = await service.extract(makeCtx(), DOC_ID);

    expect(result.overallConfidence).toBe('low');
  });
});
