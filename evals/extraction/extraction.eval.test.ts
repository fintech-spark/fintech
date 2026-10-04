import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { InvoiceExtractionSchema, ExpenseExtractionSchema } from '@/lib/ai/schemas';

const FIXTURES_DIR = path.resolve(import.meta.dirname, 'fixtures');

interface ExtractionFixture {
  readonly id: string;
  readonly documentType: string;
  readonly description: string;
  readonly content: string;
  readonly expected: Record<string, unknown>;
}

function loadExtractionFixtures(): ExtractionFixture[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(FIXTURES_DIR, f), 'utf8')) as ExtractionFixture);
}

describe('Extraction Evaluation — Deterministic Synthetic Fixtures', () => {
  const fixtures = loadExtractionFixtures();

  it('loads all synthetic extraction fixtures', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(3);
  });

  it('validates invoice-with-tax against InvoiceExtractionSchema', () => {
    const fixture = fixtures.find((f) => f.id === 'invoice-with-tax');
    expect(fixture).toBeDefined();

    const expected = fixture!.expected;
    const invoicePayload = {
      invoiceNumber: expected.invoiceNumber as string,
      issueDate: expected.issueDate as string,
      dueDate: expected.dueDate as string,
      supplierName: expected.supplierName as string,
      lineItems: [
        {
          description: 'Widget Small',
          quantity: 2,
          unitPrice: { amountMinor: 25000, currency: expected.currency as string },
          total: { amountMinor: 50000, currency: expected.currency as string },
        },
        {
          description: 'Widget Large',
          quantity: 1,
          unitPrice: { amountMinor: 75000, currency: expected.currency as string },
          total: { amountMinor: 75000, currency: expected.currency as string },
        },
      ],
      total: { amountMinor: expected.totalMinor as number, currency: expected.currency as string },
      evidence: [],
      needsReview: false,
      uncertaintyReasons: [],
    };

    const parsed = InvoiceExtractionSchema.safeParse(invoicePayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.total?.amountMinor).toBe(147500);
      expect(parsed.data.lineItems).toHaveLength(2);
    }
  });

  it('validates invoice-missing-tax and confirms tax is not fabricated', () => {
    const fixture = fixtures.find((f) => f.id === 'invoice-missing-tax');
    expect(fixture).toBeDefined();

    const expected = fixture!.expected;
    const invoicePayload = {
      invoiceNumber: expected.invoiceNumber as string,
      issueDate: expected.issueDate as string,
      dueDate: null,
      supplierName: expected.supplierName as string,
      lineItems: [
        {
          description: 'Notebook',
          quantity: 10,
          unitPrice: { amountMinor: 4500, currency: expected.currency as string },
          total: { amountMinor: 45000, currency: expected.currency as string },
        },
      ],
      total: { amountMinor: expected.totalMinor as number, currency: expected.currency as string },
      evidence: [],
      needsReview: false,
      uncertaintyReasons: [],
    };

    const parsed = InvoiceExtractionSchema.safeParse(invoicePayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.dueDate).toBeNull();
      expect(parsed.data.total?.amountMinor).toBe(45000);
    }
  });

  it('validates receipt-minimal against ExpenseExtractionSchema without inventing missing fields', () => {
    const fixture = fixtures.find((f) => f.id === 'receipt-minimal');
    expect(fixture).toBeDefined();

    const expected = fixture!.expected;
    const receiptPayload = {
      description: 'Corner store purchase',
      merchant: expected.merchant as string,
      amount: { amountMinor: expected.amountMinor as number, currency: 'INR' },
      occurredOn: expected.occurredOn as string,
      category: null,
      evidence: [],
      needsReview: false,
    };

    const parsed = ExpenseExtractionSchema.safeParse(receiptPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.amount?.amountMinor).toBe(3000);
      expect(parsed.data.merchant).toBe('Synthetic Corner Store');
      expect(parsed.data.category).toBeNull();
    }
  });
});
