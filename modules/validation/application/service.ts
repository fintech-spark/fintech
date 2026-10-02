// Phase 6 — Deterministic validation service (no DB writes, no privileged clients)
//
// Uses existing `ExtractionResult` / `ExtractionField` / `MoneySchema`.
// All arithmetic is code, not model. AI is only used for ambiguous interpretation.

import type { ExtractionResult, ExtractionField } from '../../extraction/domain/types';
import type { ValidationResult, EvidenceItem } from '../domain/types';
import { EvidenceRefSchema } from '@/lib/ai/schemas';

export interface ValidationService {
  validate(extraction: ExtractionResult, documentId?: string, businessId?: string): ValidationResult;
}

const REQUIRED_INVOICE_FIELDS = ['invoiceNumber', 'issueDate', 'supplierName', 'lineItems', 'subtotalMinor', 'totalMinor'];

function getField(fields: readonly ExtractionField[], name: string): ExtractionField | undefined {
  return fields.find((f) => f.name === name);
}

function isMoneyField(f: ExtractionField): boolean {
  return f.type === 'money';
}

function safeNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = parseFloat(val);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export const deterministicValidationService: ValidationService = {
  validate(extraction) {
    const fields = extraction.fields;
    const reasons: string[] = [];
    const contradictions: string[] = [];
    const missingEvidence: string[] = [];
    const evidence: EvidenceItem[] = [];

    // 1. Required structural fields
    for (const req of REQUIRED_INVOICE_FIELDS) {
      const f = getField(fields, req);
      if (!f || f.value === null || f.value === undefined || f.value === '') {
        reasons.push(`Missing required field: ${req}`);
        missingEvidence.push(req);
      }
    }

    // 2. Line-item arithmetic (deterministic — never ask LLM)
    const lineItemsField = getField(fields, 'lineItems');
    if (lineItemsField && Array.isArray(lineItemsField.value) && lineItemsField.value.length > 0) {
      let computedSubtotal = 0;
      const items = lineItemsField.value as Array<Record<string, unknown>>;
      for (const item of items) {
        const qty = safeNumber(item.quantity);
        const price = safeNumber((item.unitPrice as {amountMinor?: number})?.amountMinor ?? item.unitPrice);
        const total = safeNumber((item.total as any)?.amountMinor ?? (item.total as any) ?? item.totalMinor);
        if (qty !== null && price !== null) {
          const expected = Math.round(qty * price); // minor-unit integer arithmetic
          if (total !== null && Math.abs(expected - total) > 1) {
            contradictions.push(`Line item arithmetic: qty=${qty} × price=${price} => expected=${expected}, got=${total}`);
          }
          computedSubtotal += total ?? expected;
        }
      }
      const subtotalField = getField(fields, 'subtotalMinor');
      if (subtotalField) {
        const stated = safeNumber(subtotalField.value);
        if (stated !== null && Math.abs(stated - computedSubtotal) > 1) {
          contradictions.push(`Subtotal mismatch: computed=${computedSubtotal}, stated=${stated}`);
        }
      }
    }

    // 3. Tax / total consistency (deterministic)
    const subtotalF = getField(fields, 'subtotalMinor');
    const taxF = getField(fields, 'taxMinor');
    const totalF = getField(fields, 'totalMinor');
    if (subtotalF && taxF && totalF) {
      const sub = safeNumber(subtotalF.value);
      const tax = safeNumber(taxF.value);
      const total = safeNumber(totalF.value);
      if (sub !== null && tax !== null && total !== null) {
        const expectedTotal = Math.round(sub - (getField(fields, 'discountMinor')?.value as number ?? 0) + tax);
        if (Math.abs(expectedTotal - total) > 1) {
          contradictions.push(`Total arithmetic: subtotal=${sub}, tax=${tax} => expected=${expectedTotal}, got=${total}`);
        }
      }
    }

    // 4. Source support / evidence (deterministic presence check; actual trace requires provider)
    const documentId = (extraction as any).documentId ?? (extraction as any).document_id ?? 'unknown';
    const businessId = (extraction as any).businessId ?? (extraction as any).business_id ?? 'unknown';
    for (const req of ['invoiceNumber', 'supplierName', 'totalMinor']) {
      const f = getField(fields, req);
      if (f && f.value && f.confidence === 'high') {
        evidence.push({
          sourceType: 'invoice',
          sourceId: documentId ?? 'unknown',
          field: req,
          support: 'DIRECTLY_SUPPORTED',
          observedAt: extraction.extractedAt.toISOString(),
        });
      }
    }

    // 5. Status determination
    const hasCriticalContradiction = contradictions.length > 0;
    const hasCriticalMissing = missingEvidence.length > 2; // more than optional missing
    const hasUnsupported = reasons.some((r) => r.includes('unsupported'));

    const status: 'VALIDATED' | 'NEEDS_REVIEW' | 'REJECTED' =
      hasCriticalContradiction ? 'REJECTED' :
      (hasCriticalMissing || hasUnsupported || reasons.length > 2) ? 'NEEDS_REVIEW' :
      'VALIDATED';

    return {
      extractionId: extraction.id,
      documentId: documentId,
      businessId: businessId,
      status,
      validatorType: 'deterministic',
      validatedAt: new Date(),
      evidence,
      confidence: hasCriticalContradiction ? 'low' : (reasons.length > 0 ? 'medium' : 'high'),
      reason: hasCriticalContradiction
        ? `Contradictions: ${contradictions.join('; ')}`
        : (reasons.length > 0 ? `Issues: ${reasons.join('; ')}` : undefined),
      contradictions: contradictions.length > 0 ? contradictions : undefined,
      missingEvidence: missingEvidence.length > 0 ? missingEvidence : undefined,
    } as ValidationResult;
  },
};
