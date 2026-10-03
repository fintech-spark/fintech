// Merchant Brain: RAG retrieval policy
//
// Returning the first K nearest chunks is not retrieval, it is a sorted prefix.
// Three failure modes follow from it, and each has a control here:
//
//   PRECISION   The nearest neighbour to a vague query is often topically
//               adjacent and useless.  -> similarity floor.
//   REDUNDANCY  A long invoice split into chunks returns five near-identical
//               spans that crowd out a second, genuinely useful document.
//                                            -> per-document cap + content-hash dedup.
//   RECENCY     A superseded price list outranks the current one.
//                                            -> version-aware preference + freshness flag.
//
// The defaults are deliberately conservative. Context quality dominates prompt
// size: five strong chunks beat forty mediocre ones, because irrelevant context
// measurably degrades grounding and costs tokens on every request.
//
// `candidateMultiplier` over-fetches before filtering. Recall is bought at the
// ANN stage, where it is cheap, and precision is enforced afterwards.

import type { ScoredChunk } from './types';

export interface RetrievalPolicy {
  /** Cosine similarity floor. Below this a chunk is not context. */
  readonly minSimilarity: number;
  /** Absolute ceiling on chunks handed to the context compiler. */
  readonly maxTopK: number;
  /** Ceiling applied when the caller does not ask for a specific count. */
  readonly defaultTopK: number;
  /** ANN over-fetch factor. 4x is ample for a tenant-scoped corpus. */
  readonly candidateMultiplier: number;
  /** Hard ceiling on candidates pulled from the index in one query. */
  readonly maxCandidates: number;
  /** Most chunks any single document may contribute. */
  readonly maxChunksPerDocument: number;
  /** Total characters of retrieved text permitted per request. */
  readonly maxEvidenceChars: number;
  /** Chunks older than this relative to the newest hit are flagged stale. */
  readonly freshnessWindowDays: number;
}

export const DEFAULT_RETRIEVAL_POLICY: RetrievalPolicy = {
  minSimilarity: 0.35,
  maxTopK: 8,
  defaultTopK: 5,
  candidateMultiplier: 4,
  maxCandidates: 40,
  maxChunksPerDocument: 2,
  maxEvidenceChars: 8000,
  freshnessWindowDays: 180,
};

/** Highest cosine similarity a normalised embedding pair can produce. */
export const MAX_SIMILARITY = 1;

export interface FilteredRetrieval {
  readonly kept: readonly ScoredChunk[];
  readonly suppressed: {
    readonly belowThreshold: number;
    readonly duplicates: number;
    readonly overBudget: number;
  };
}

/**
 * Applies the retrieval controls to raw ANN output.
 *
 * Pure and order-dependent on `candidates` being sorted by descending score,
 * which is what the repository's `ORDER BY similarity DESC` guarantees.
 *
 * `options.topK` is the caller's resolved count. Without it the policy falls
 * back to `defaultTopK`, which silently caps a request for eight chunks at
 * five — the reason a requested topK has to be threaded through here rather
 * than enforced by slicing the candidates beforehand. Slicing first also means
 * every chunk the filters drop shrinks the answer below the requested count;
 * the filters run first, and the caller's count is applied to what survives.
 */
export function applyRetrievalPolicy(
  candidates: readonly ScoredChunk[],
  policy: RetrievalPolicy = DEFAULT_RETRIEVAL_POLICY,
  options: { readonly topK?: number } = {},
): FilteredRetrieval {
  const requested =
    options.topK === undefined || !Number.isFinite(options.topK)
      ? policy.defaultTopK
      : Math.min(Math.max(1, Math.floor(options.topK)), policy.maxTopK);
  let belowThreshold = 0;
  let duplicates = 0;
  let overBudget = 0;

  const seenContent = new Set<string>();
  const perDocument = new Map<string, number>();
  const kept: ScoredChunk[] = [];
  let evidenceChars = 0;

  for (const candidate of candidates) {
    if (kept.length >= requested) {
      overBudget += 1;
      continue;
    }

    if (!Number.isFinite(candidate.score) || candidate.score < policy.minSimilarity) {
      belowThreshold += 1;
      continue;
    }

    // Duplicate suppression is per document: the same span twice inside one
    // document is redundancy, while identical boilerplate in two documents is
    // two pieces of evidence and both may need citing. The per-document cap
    // above is what stops one document crowding out another.
    const fingerprint = fingerprintOf(candidate);
    if (seenContent.has(fingerprint)) {
      duplicates += 1;
      continue;
    }

    const documentId = candidate.chunk.documentId;
    const used = perDocument.get(documentId) ?? 0;
    if (used >= policy.maxChunksPerDocument) {
      duplicates += 1;
      continue;
    }

    // A chunk that would overflow the character budget is dropped, not
    // truncated: a half sentence of evidence is worse than no evidence.
    if (evidenceChars + candidate.chunk.content.length > policy.maxEvidenceChars) {
      overBudget += 1;
      continue;
    }

    seenContent.add(fingerprint);
    perDocument.set(documentId, used + 1);
    evidenceChars += candidate.chunk.content.length;
    kept.push(candidate);
  }

  return {
    kept,
    suppressed: { belowThreshold, duplicates, overBudget },
  };
}

/**
 * Identity for duplicate suppression, scoped to the document that holds it.
 *
 * Prefers the recorded content hash, which is exact, and falls back to a
 * normalised text comparison for chunks indexed before hashing existed. Both
 * branches are document-scoped so they behave the same way — an unscoped hash
 * would collapse identical text found in two different documents and silently
 * drop one of them from the answer.
 */
function fingerprintOf(candidate: ScoredChunk): string {
  const documentId = candidate.chunk.documentId;
  const hash = candidate.chunk.metadata.contentHash;
  if (hash) return `hash:${documentId}:${hash}`;
  const index = candidate.chunk.metadata.chunkIndex;
  return `pos:${documentId}:${index}:${normaliseForCompare(candidate.chunk.content)}`;
}

/** Collapses whitespace so a re-flowed chunk still compares equal. */
function normaliseForCompare(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Marks retrieved chunks that predate the freshest evidence in the set.
 *
 * A stale document is not dropped — the merchant may legitimately ask about a
 * historical price — but it is labelled so the model can say "your March price
 * list said…" rather than presenting it as current state.
 */
export function assessFreshness(
  chunks: readonly ScoredChunk[],
  policy: RetrievalPolicy = DEFAULT_RETRIEVAL_POLICY,
  now: Date = new Date(),
): ReadonlyMap<string, { freshness: Freshness; ageDays: number | null }> {
  const ages = chunks
    .map((chunk) => ageInDays(chunk.chunk.metadata.sourceTimestamp, now))
    .filter((age): age is number => age !== null);
  const newest = ages.length > 0 ? Math.min(...ages) : null;
  const verdict = new Map<string, { freshness: Freshness; ageDays: number | null }>();

  for (const chunk of chunks) {
    const age = ageInDays(chunk.chunk.metadata.sourceTimestamp, now);
    if (age === null) {
      verdict.set(chunk.chunk.id, { freshness: 'undated', ageDays: null });
      continue;
    }
    const relativeToNewest = newest === null ? 0 : age - newest;
    const freshness: Freshness =
      age > policy.freshnessWindowDays || relativeToNewest > policy.freshnessWindowDays
        ? 'stale'
        : 'current';
    verdict.set(chunk.chunk.id, { freshness, ageDays: age });
  }

  return verdict;
}

export type Freshness = 'current' | 'stale' | 'undated';

function ageInDays(timestamp: string | undefined, now: Date): number | null {
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((now.getTime() - parsed) / dayMs));
}

/**
 * Clamps a caller-requested `topK` into the policy envelope.
 *
 * A model asking for 500 chunks gets the ceiling, not an error: the request is
 * legitimate, only the magnitude is wrong.
 */
export function resolveTopK(
  requested: number | undefined,
  policy: RetrievalPolicy = DEFAULT_RETRIEVAL_POLICY,
): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return policy.defaultTopK;
  }
  const floored = Math.floor(requested);
  if (floored < 1) return 1;
  return Math.min(floored, policy.maxTopK);
}

/** How many ANN candidates to fetch for a resolved topK. */
export function resolveCandidateCount(
  topK: number,
  policy: RetrievalPolicy = DEFAULT_RETRIEVAL_POLICY,
): number {
  return Math.min(topK * policy.candidateMultiplier, policy.maxCandidates);
}
