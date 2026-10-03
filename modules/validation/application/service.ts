// Phase 6 — Deterministic validation service (no DB writes, no privileged clients)
//
// Uses existing `ExtractionResult` / `ExtractionField` / `MoneySchema`.
// All arithmetic is code, not model. AI is only used for ambiguous interpretation.
//
// SECURITY: every value below the extraction boundary is DATA. Document text is
// never an instruction. `detectEmbeddedInstructions` looks for instruction-shaped
// content and forces human review; it never acts on what the text asks for.

import type { ExtractionResult, ExtractionField } from '../../extraction/domain/types';
import type { DocumentId, BusinessId } from '@/lib/types';
import type { ValidationResult, EvidenceItem } from '../domain/types';

export interface ValidationService {
  validate(extraction: ExtractionResult, documentId?: string, businessId?: string): ValidationResult;
}

/**
 * Fields without which an invoice cannot become authoritative.
 *
 * `dueDate` is deliberately absent: it is optional, and treating it as required
 * would reject otherwise-valid invoices.
 */
const REQUIRED_INVOICE_FIELDS = [
  'invoiceNumber',
  'issueDate',
  'supplierName',
  'lineItems',
  'subtotalMinor',
  'totalMinor',
] as const;

/** Fields whose value must be traceable to a source fragment before promotion. */
const EVIDENCE_FIELDS = ['invoiceNumber', 'supplierName', 'totalMinor'] as const;

/** Minor-unit tolerance for money arithmetic, to absorb rounding only. */
const MONEY_TOLERANCE = 1;

/**
 * Instruction-shaped phrases that must never appear in a merchant document.
 *
 * These are DATA PATTERNS, not an instruction filter: a match does not change
 * any number, it only forces human review. Precision matters more than recall —
 * a false positive costs a merchant a manual look, a false negative lets a
 * hostile document through unreviewed.
 */
const EMBEDDED_INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /reveal\s+(the\s+)?system\s+prompt/i,
  /(approve|authorise|authorize)\s+(this\s+)?(invoice|transaction|payment)/i,
  /change\s+(the\s+)?(amount|total|totalminor)\s+to\b/i,
  /use\s+this\s+(tenant|business)[_\s-]?id/i,
  /you\s+are\s+now\b/i,
  /system\s*:\s*/i,
];

interface Findings {
  readonly reasons: string[];
  readonly contradictions: string[];
  readonly missingEvidence: string[];
  readonly evidence: EvidenceItem[];
  readonly embeddedInstructions: string[];
}

function getField(
  fields: readonly ExtractionField[],
  name: string,
): ExtractionField | undefined {
  return fields.find((f) => f.name === name);
}

/** Parses a numeric minor-unit value from a field, tolerating numeric strings. */
function safeNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Reads a money amount in integer minor units from either shape. */
function moneyValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value !== null && typeof value === 'object') {
    const amount = (value as Record<string, unknown>).amountMinor;
    if (typeof amount === 'number') return amount;
  }
  return null;
}

/**
 * A field is absent when it is missing entirely, explicitly null/empty, or an
 * empty collection.
 *
 * An empty `lineItems` array counts as absent: an invoice that states a total
 * but exposes no line items cannot have that total verified, which is exactly
 * the `missing-evidence` case.
 */
function isAbsent(field: ExtractionField | undefined): boolean {
  if (!field) return true;
  const { value } = field;
  if (value === null || value === undefined || value === '') return true;
  return Array.isArray(value) && value.length === 0;
}

/**
 * Verifies each line item multiplies out, then sums them.
 *
 * Money is integer minor units; the comparison is integer arithmetic with a
 * one-unit tolerance for rounding only.
 */
function checkLineItems(
  fields: readonly ExtractionField[],
  contradictions: string[],
): number | null {
  const field = getField(fields, 'lineItems');
  if (!field || !Array.isArray(field.value) || field.value.length === 0) return null;

  const items = field.value as ReadonlyArray<Record<string, unknown>>;
  let computedSubtotal = 0;
  let checked = 0;

  for (const item of items) {
    const quantity = safeNumber(item.quantity);
    const price = moneyValue(item.unitPrice);
    const total = moneyValue(item.total) ?? moneyValue(item.totalMinor);

    if (quantity === null || price === null) continue;
    checked += 1;

    const expected = Math.round(quantity * price);

    if (total !== null && Math.abs(expected - total) > MONEY_TOLERANCE) {
      contradictions.push(
        `Line item arithmetic: qty=${quantity} × price=${price} => expected=${expected}, got=${total}`,
      );
    }

    computedSubtotal += total ?? expected;
  }

  return checked > 0 ? computedSubtotal : null;
}

/** Compares the stated subtotal against the sum of its own line items. */
function checkSubtotal(
  fields: readonly ExtractionField[],
  computedSubtotal: number | null,
  contradictions: string[],
): void {
  if (computedSubtotal === null) return;

  const stated = safeNumber(getField(fields, 'subtotalMinor')?.value);
  if (stated === null) return;

  if (Math.abs(stated - computedSubtotal) > MONEY_TOLERANCE) {
    contradictions.push(
      `Subtotal mismatch: computed=${computedSubtotal}, stated=${stated}`,
    );
  }
}

/** Verifies subtotal − discount + tax equals the stated total. */
function checkTotal(
  fields: readonly ExtractionField[],
  contradictions: string[],
): void {
  const subtotal = safeNumber(getField(fields, 'subtotalMinor')?.value);
  const tax = safeNumber(getField(fields, 'taxMinor')?.value);
  const total = safeNumber(getField(fields, 'totalMinor')?.value);
  if (subtotal === null || tax === null || total === null) return;

  const discount = safeNumber(getField(fields, 'discountMinor')?.value) ?? 0;
  const expected = Math.round(subtotal - discount + tax);

  if (Math.abs(expected - total) > MONEY_TOLERANCE) {
    contradictions.push(
      `Total arithmetic: subtotal=${subtotal}, discount=${discount}, tax=${tax} => expected=${expected}, got=${total}`,
    );
  }
}

/**
 * Flags instruction-shaped content found inside the extracted document text.
 *
 * The matched phrase is recorded so a reviewer can see what was ignored. No
 * number is altered: a hostile document that also carries correct figures must
 * still be reviewed, never silently "corrected" to the value it demanded.
 */
function detectEmbeddedInstructions(
  fields: readonly ExtractionField[],
): string[] {
  const field = getField(fields, 'untrustedDocumentText');
  const text = typeof field?.value === 'string' ? field.value : '';
  if (text.length === 0) return [];

  return EMBEDDED_INSTRUCTION_PATTERNS.filter((pattern) => pattern.test(text)).map(
    (pattern) => pattern.source,
  );
}

/** Flags evidence that a reviewer must weigh, and collects direct support. */
function checkEvidence(
  fields: readonly ExtractionField[],
  documentId: string,
  observedAt: string,
  findings: EvidenceItem[],
): void {
  for (const name of EVIDENCE_FIELDS) {
    const field = getField(fields, name);
    if (!field || isAbsent(field)) continue;

    if (field.confidence !== 'high') continue;

    findings.push({
      sourceType: 'invoice',
      sourceId: documentId,
      field: name,
      support: 'DIRECTLY_SUPPORTED',
      observedAt,
    });
  }

  const declared = getField(fields, 'evidence');
  if (!declared || !Array.isArray(declared.value)) return;

  for (const item of declared.value as ReadonlyArray<Record<string, unknown>>) {
    if (item.support !== 'CONFLICTING') continue;
    findings.push({
      sourceType: 'invoice',
      sourceId: documentId,
      field: typeof item.field === 'string' ? item.field : 'unknown',
      excerpt: typeof item.excerpt === 'string' ? item.excerpt : undefined,
      support: 'CONFLICTING',
      observedAt,
    });
  }
}

/** Records every required field the extraction could not supply. */
function collectMissing(
  fields: readonly ExtractionField[],
): string[] {
  return REQUIRED_INVOICE_FIELDS.filter((name) => isAbsent(getField(fields, name)));
}

/** Records the extractor's own uncertainty reasons verbatim. */
function collectUncertaintyReasons(fields: readonly ExtractionField[]): string[] {
  const field = getField(fields, 'uncertaintyReasons');
  if (!Array.isArray(field?.value)) return [];
  return (field.value as readonly unknown[]).filter(
    (reason): reason is string => typeof reason === 'string',
  );
}

function decideStatus(findings: Findings): ValidationResult['status'] {
  if (findings.contradictions.length > 0) return 'REJECTED';
  if (findings.evidence.some((e) => e.support === 'CONFLICTING')) return 'REJECTED';
  if (findings.missingEvidence.length > 0) return 'NEEDS_REVIEW';
  if (findings.embeddedInstructions.length > 0) return 'NEEDS_REVIEW';
  if (findings.reasons.length > 0) return 'NEEDS_REVIEW';
  return 'VALIDATED';
}

export const deterministicValidationService: ValidationService = {
  validate(extraction, documentIdOverride, businessIdOverride) {
    const fields = extraction.fields;
    const reasons: string[] = [];
    const contradictions: string[] = [];
    const missingEvidence = collectMissing(fields);
    const evidence: EvidenceItem[] = [];

    for (const name of missingEvidence) {
      reasons.push(`Missing required field: ${name}`);
    }

    const computedSubtotal = checkLineItems(fields, contradictions);
    checkSubtotal(fields, computedSubtotal, contradictions);
    checkTotal(fields, contradictions);

    const embeddedInstructions = detectEmbeddedInstructions(fields);
    for (const pattern of embeddedInstructions) {
      reasons.push(`Embedded instruction ignored in document text: /${pattern}/`);
    }

    for (const reason of collectUncertaintyReasons(fields)) {
      reasons.push(reason);
    }

    const needsReview = getField(fields, 'needsReview')?.value === true;
    if (needsReview && reasons.length === 0) {
      reasons.push('Extractor flagged the extraction as needing review.');
    }

    const observedAt = extraction.extractedAt.toISOString();
    const documentId = documentIdOverride ?? extraction.documentId;
    const businessId = businessIdOverride ?? extraction.businessId;

    checkEvidence(fields, String(documentId), observedAt, evidence);

    const findings: Findings = {
      reasons,
      contradictions,
      missingEvidence,
      evidence,
      embeddedInstructions,
    };

    const status = decideStatus(findings);

    const summary =
      contradictions.length > 0
        ? `Contradictions: ${contradictions.join('; ')}`
        : reasons.length > 0
          ? `Issues: ${reasons.join('; ')}`
          : undefined;

    return {
      extractionId: extraction.id,
      documentId: documentId as DocumentId,
      businessId: businessId as BusinessId,
      status,
      validatorType: 'deterministic',
      validatedAt: new Date(),
      evidence,
      confidence: contradictions.length > 0 ? 'low' : reasons.length > 0 ? 'medium' : 'high',
      ...(summary !== undefined ? { reason: summary } : {}),
      ...(contradictions.length > 0 ? { contradictions } : {}),
      ...(missingEvidence.length > 0 ? { missingEvidence } : {}),
    };
  },
};