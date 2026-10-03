// Merchant Brain: evaluation fixture adapter
//
// The fixtures under `evals/*/fixtures/` describe an extraction as a FLAT object:
//
//   { invoiceNumber, lineItems, subtotalMinor, totalMinor, … }
//
// The domain type the validator actually consumes is `ExtractionResult`, whose
// payload lives in a `fields[]` array of `ExtractionField`:
//
//   { fields: [{ name, value, type, confidence }, …] }
//
// Nothing in the repository performed that translation, which is why the eleven
// validation fixtures were inert: they could not be fed to the validator at all.
// This module is that translation, and nothing else. It performs no judgement —
// it does not compute totals, infer confidence, or decide status.

import type { ExtractionField, ExtractionResult, FieldType } from '@/modules/extraction/domain/types';
import type { BusinessId, DocumentId } from '@/lib/types';

export interface ValidationFixture {
  readonly fixtureName: string;
  readonly expectedStatus: 'VALIDATED' | 'NEEDS_REVIEW' | 'REJECTED' | 'UNSUPPORTED' | 'FAILED';
  readonly description: string;
  readonly sourceType: 'invoice' | 'receipt' | 'expense' | 'transaction' | 'document';
  readonly documentId: string;
  readonly businessId: string;
  readonly extraction: Readonly<Record<string, unknown>>;
  readonly validationNotes?: string;
}

/** Maps a fixture value onto the domain `FieldType` union. */
function inferFieldType(value: unknown): FieldType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (value !== null && typeof value === 'object') return 'money';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
  return 'string';
}

/**
 * Splits the flat payload into present and absent field names.
 *
 * A key that is present but explicitly `null` is treated as MISSING by the
 * validator (`f.value === null`), so it must still be emitted as a field for
 * that check to fire. Only genuinely absent keys are dropped.
 */
function toFields(payload: Readonly<Record<string, unknown>>): {
  fields: ExtractionField[];
  absent: string[];
} {
  const fields: ExtractionField[] = [];
  const absent: string[] = [];

  for (const [name, value] of Object.entries(payload)) {
    if (value === undefined) {
      absent.push(name);
      continue;
    }

    fields.push({
      name,
      value,
      type: inferFieldType(value),
      // Confidence is NOT asserted by a fixture: the validator's evidence rule
      // requires `high`, and inventing a score here would manufacture the very
      // provenance the eval is meant to check. `medium` keeps the evidence rule
      // inert unless a case explicitly opts in via `confidentFields`.
      confidence: 'medium',
    });
  }

  return { fields, absent };
}

export interface BuildOptions {
  /**
   * Field names a fixture asserts were read with high confidence.
   *
   * Only these receive `confidence: 'high'`, which is what the validator's
   * evidence check requires. Nothing is inferred from the value itself.
   */
  readonly confidentFields?: readonly string[];
}

export interface BuiltFixture {
  readonly result: ExtractionResult;
  readonly absentFields: readonly string[];
}

/** Converts one validation fixture into an `ExtractionResult`. */
export function toExtractionResult(
  fixture: ValidationFixture,
  options: BuildOptions = {},
): BuiltFixture {
  const { fields, absent } = toFields(fixture.extraction);
  const confident = new Set(options.confidentFields ?? []);

  const withConfidence = fields.map((field) =>
    confident.has(field.name) && field.confidence !== 'high'
      ? { ...field, confidence: 'high' as const }
      : field,
  );

  return {
    absentFields: absent,
    result: {
      id: `eval-${fixture.fixtureName}`,
      businessId: fixture.businessId as BusinessId,
      documentId: fixture.documentId as DocumentId,
      status: 'completed',
      fields: withConfidence,
      evidence: [],
      overallConfidence: 'medium',
      modelUsed: 'eval-fixture',
      extractedAt: new Date('2026-01-15T00:00:00.000Z'),
    },
  };
}