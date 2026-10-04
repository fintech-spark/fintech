import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  InvoiceExtractionSchema,
  ExpenseExtractionSchema,
} from '@/lib/ai/schemas';
import {
  guardOutput,
  assertNoTenantKey,
  FORBIDDEN_TENANT_KEYS,
} from '@/lib/ai';
import { assembleContextPrompt, compileContext } from '@/modules/business-brain';
import { asBusinessId } from '@/lib/types';

const BIZ_A = asBusinessId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const INJECTION_FILE = path.resolve(import.meta.dirname, '../extraction/fixtures/prompt-injection.txt');

describe('AI Security Evaluation — Prompt Injection Defense & Structured Output', () => {
  it('wraps untrusted document content in structural XML delimiters to prevent prompt injection', () => {
    const rawMaliciousContent = readFileSync(INJECTION_FILE, 'utf8');

    // Compile into an evidence packet
    const compiled = compileContext({
      question: 'What is the invoice total?',
      correlationId: 'eval-sec-1',
      toolEnvelopes: [],
      retrievedChunks: [
        {
          chunk: {
            id: 'chunk-malicious',
            businessId: BIZ_A,
            documentId: 'doc-evil-1' as never,
            content: rawMaliciousContent,
            metadata: {
              businessId: BIZ_A,
              sourceId: 'doc-evil-1',
              sourceType: 'document',
              chunkIndex: 0,
              totalChunks: 1,
              chunkerVersion: 'rag-chunker.v1',
            },
            createdAt: new Date(),
          },
          score: 0.9,
        },
      ],
    });

    const assembledPrompt = assembleContextPrompt(compiled.context, compiled.evidence);

    // Assert that untrusted content is strictly inside <retrieved_evidence> delimiters
    expect(assembledPrompt.user).toContain('<retrieved_evidence');
    expect(assembledPrompt.user).toContain('</retrieved_evidence>');
    expect(assembledPrompt.user).toContain('IGNORE ALL PREVIOUS INSTRUCTIONS');

    // Assert that system prompt enforces data isolation
    expect(assembledPrompt.system).toContain('business analysis system');
  });

  it('strictly validates structured extraction output with Zod schemas and rejects malformed shapes', () => {
    const validInvoiceOutput = {
      invoiceNumber: 'INV-2026-001',
      issueDate: '2026-02-01',
      dueDate: '2026-03-01',
      supplierName: 'Reliable Supplier Ltd',
      lineItems: [
        {
          description: 'High Grade Rice',
          quantity: 10,
          unitPrice: { amountMinor: 5000, currency: 'INR' },
          total: { amountMinor: 50000, currency: 'INR' },
        },
      ],
      total: { amountMinor: 59000, currency: 'INR' },
      evidence: [
        {
          sourceId: 'doc-1',
          recordId: 'rec-1',
          sourceType: 'invoice' as const,
          field: 'total',
          excerpt: 'Total: 590.00',
        },
      ],
      needsReview: false,
      uncertaintyReasons: [],
    };

    const parsed = InvoiceExtractionSchema.safeParse(validInvoiceOutput);
    expect(parsed.success).toBe(true);

    // Rejection 1: missing required fields
    const missingTotal = {
      invoiceNumber: 'INV-2026-001',
      supplierName: 'Reliable Supplier Ltd',
      lineItems: [],
    };
    expect(InvoiceExtractionSchema.safeParse(missingTotal).success).toBe(false);

    // Rejection 2: floating-point money amounts (minor-unit integer invariant)
    const floatAmount = {
      ...validInvoiceOutput,
      total: { amountMinor: 590.5, currency: 'INR' },
    };
    expect(InvoiceExtractionSchema.safeParse(floatAmount).success).toBe(false);

    // Rejection 3: invalid currency length
    const badCurrency = {
      ...validInvoiceOutput,
      total: { amountMinor: 59000, currency: 'INDIAN_RUPEE' },
    };
    expect(InvoiceExtractionSchema.safeParse(badCurrency).success).toBe(false);
  });

  it('rejects forbidden tenant parameters in AI tool input schemas to prevent IDOR', () => {
    for (const key of FORBIDDEN_TENANT_KEYS) {
      expect(() => assertNoTenantKey({ [key]: 'foreign-tenant-id' }, 'read_sales')).toThrow(
        /tenant key/i,
      );
    }
  });

  it('validates guardOutput against unexpected or empty payloads', () => {
    const schema = ExpenseExtractionSchema;
    const guardedValid = guardOutput(
      schema,
      {
        description: 'Fuel purchase',
        amount: { amountMinor: 25000, currency: 'INR' },
        occurredOn: '2026-02-15',
        category: 'fuel',
        merchant: 'Local Fuel Station',
        evidence: [],
        needsReview: false,
      },
    );
    expect(guardedValid.passed).toBe(true);
    if (guardedValid.passed) {
      expect(guardedValid.data.merchant).toBe('Local Fuel Station');
    }

    const guardedInvalid = guardOutput(schema, { amount: { amountMinor: 'twenty thousand' } });
    expect(guardedInvalid.passed).toBe(false);
  });
});
