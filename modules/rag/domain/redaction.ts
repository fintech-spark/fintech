// Merchant Brain: pre-embedding redaction
//
// WHY THIS RUNS BEFORE EMBEDDING AND NOT AFTER
// ---------------------------------------------
// A vector is not reversible. Once invoice text is embedded, a redaction policy
// written next month cannot un-embed it, and the retrieval index becomes an
// unrecoverable copy of whatever was indexed. Redaction therefore happens on
// the plaintext chunk, on the way in.
//
// WHAT IS REDACTED, AND WHY
// -------------------------
// Credentials and secret material: never have any retrieval value, and a
// document that leaks one into a vector store leaks it to every future prompt.
//
// Direct identifiers: tax ids, bank account and IFSC, card numbers, phone
// numbers, email addresses. These identify a natural person or expose a
// settlement account. They are replaced with a typed placeholder rather than
// deleted, so retrieval can still tell that a supplier's bank details changed
// without the model ever seeing them.
//
// WHAT IS DELIBERATELY KEPT
// -------------------------
// Trading-partner names, product names, and amounts. These carry the business
// meaning retrieval exists to find — "why did Sudhir Sharma stop buying" is
// unanswerable if the name is stripped. This is a deliberate trade: name-level
// PII stays inside the tenant's own boundary. The real control is that every
// retrieval statement binds `business_id = $1` from the authenticated context
// (see `modules/business-brain/infrastructure/tenant-query.ts` and the
// `SIMILARITY_SEARCH_SQL` predicate). It is NOT RLS: the application pool
// authenticates as a role with `rolbypassrls = true`, so migration 0004's policies
// are inert for this traffic., while account-level and credential-level
// material never leaves plaintext storage.
//
// Redaction is deterministic and idempotent, so re-running it is safe and the
// content hash stays meaningful.

/** Marker shape written in place of a redacted span. */
export type RedactionKind =
  | 'credential'
  | 'tax_id'
  | 'bank_account'
  | 'card_number'
  | 'phone'
  | 'email';

export interface RedactionResult {
  readonly text: string;
  readonly counts: Readonly<Partial<Record<RedactionKind, number>>>;
  readonly totalRedactions: number;
}

interface Rule {
  readonly kind: RedactionKind;
  readonly pattern: RegExp;
}

// Order matters: the most specific credential shapes run before the generic
// long-digit rule, so a card number is not mistaken for a bank account.
const RULES: readonly Rule[] = [
  // Credentials. Anchored on well-known key prefixes and on label=value pairs.
  {
    kind: 'credential',
    pattern:
      /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b|\bAIza[0-9A-Za-z_-]{20,}\b|\bgh[pousr]_[0-9A-Za-z]{16,}\b|\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
  },
  {
    kind: 'credential',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    kind: 'credential',
    pattern:
      /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|service[_-]?role)\b\s*[:=]\s*\S+/gi,
  },
  {
    kind: 'credential',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g,
  },
  // Indian tax identifiers.
  // GSTIN is 15 characters: 2 digits, 5 letters, 4 digits, 1 letter, 1 digit,
  // the literal 'Z' entity code, then 1 alphanumeric check character.
  { kind: 'tax_id', pattern: /\b\d{2}[A-Z]{5}\d{4}[A-Z]\dZ[\dA-Z]\b/g },
  { kind: 'tax_id', pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  // Bank settlement details.
  { kind: 'bank_account', pattern: /\bIFSC\s*[:=]?\s*[A-Z]{4}0[A-Z0-9]{6}\b/gi },
  { kind: 'bank_account', pattern: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
  {
    kind: 'bank_account',
    pattern: /\b(?:a\/c|account|acc)\s*(?:no\.?|number|#)?\s*[:=]?\s*\d{9,18}\b/gi,
  },
  // Payment cards: 13-19 digits, optionally grouped.
  { kind: 'card_number', pattern: /\b(?:\d[ -]?){13,19}\b/g },
  // Direct contact identifiers.
  { kind: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: 'phone', pattern: /(?<!\d)(?:\+?91[-\s]?)?[6-9]\d{4}[-\s]?\d{5}(?!\d)/g },
];

/**
 * Removes secret and identifying material from text before it is embedded.
 *
 * Returns the counts alongside the text so ingestion can record that
 * redaction happened without persisting the original.
 */
export function redactForEmbedding(input: string): RedactionResult {
  let text = input;
  const counts: Partial<Record<RedactionKind, number>> = {};

  for (const rule of RULES) {
    text = text.replace(rule.pattern, (match) => {
      counts[rule.kind] = (counts[rule.kind] ?? 0) + 1;
      return placeholderFor(rule.kind, match);
    });
  }

  const totalRedactions = Object.values(counts).reduce<number>(
    (sum, value) => sum + (value ?? 0),
    0,
  );

  return { text, counts, totalRedactions };
}

/**
 * Replaces a matched span with a typed placeholder.
 *
 * The matched text is preserved only as its shape: a bank account becomes
 * `[redacted:bank_account:12]` so the model can still reason that a 12-digit
 * account exists without learning it.
 */
function placeholderFor(kind: RedactionKind, match: string): string {
  const digits = match.replace(/\D/g, '');
  const length = digits.length > 0 ? digits.length : match.length;
  return `[redacted:${kind}:${length}]`;
}

/**
 * A coarse classification used to decide whether a source is safe to index at
 * all. WhatsApp exports and voice transcripts carry the highest concentration
 * of incidental third-party PII, so they are marked for review rather than
 * indexed silently.
 */
export function classifyIndexingRisk(sourceType: string): 'low' | 'elevated' {
  return sourceType === 'whatsapp' || sourceType === 'conversation' ? 'elevated' : 'low';
}
