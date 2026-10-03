// Merchant Brain: context compiler
//
// Takes tool results and retrieved evidence and produces an `AIContext` in
// which every item declares its origin, and in which absences are stated rather
// than implied.
//
// PRIORITY ORDER UNDER BUDGET PRESSURE
// ------------------------------------
// Deterministic metrics outrank retrieved text. That ordering is deliberate: a
// stale or wrong document sentence is worse than no document sentence, while a
// database total is exactly as useful after trimming as before. Structured
// business metrics are therefore never dropped to make room for prose — the
// budget is applied to evidence only, and metrics are capped by count.
//
// CONFLICT DETECTION
// ------------------
// A conflict is raised when retrieved text states a figure for a subject the
// compiler already holds a deterministic metric for, and the two disagree. The
// compiler does not choose a winner: it keeps both, records the conflict, and
// lets the model report the disagreement. Silently preferring the structured
// value would mask a genuine data-quality problem; letting the model choose
// would hand it an arbitrary tiebreak.

import type { ToolEnvelope } from '@/lib/ai/tools/types';
import type { Freshness, ScoredChunk } from '@/modules/rag';
import {
  EvidenceRegistry,
  evidenceId,
  factFromEnvelope,
  metricFromRecord,
} from '../domain/evidence';
import type { EvidenceItem } from '../domain/evidence';
import type {
  AIContext,
  AuthoritativeFact,
  ContextConflict,
  ContextMetadata,
  ContextUncertainty,
  DeterministicMetricRecord,
  RetrievedEvidence,
  SourceReference,
} from '../domain/context';

export interface ContextBudget {
  /** Ceiling on tool results folded into the context. */
  readonly maxToolResults: number;
  readonly maxMetrics: number;
  readonly maxEvidence: number;
  /** Ceiling on total characters across metrics, facts and evidence. */
  readonly maxTotalChars: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  maxToolResults: 8,
  maxMetrics: 60,
  maxEvidence: 8,
  maxTotalChars: 24_000,
};

export interface CompileInput {
  readonly question: string;
  readonly correlationId: string;
  readonly toolEnvelopes: readonly ToolEnvelope<unknown>[];
  readonly retrievedChunks: readonly ScoredChunk[];
  readonly freshness?: ReadonlyMap<string, { freshness: Freshness; ageDays: number | null }>;
  readonly retrievalSuppressed?: {
    readonly belowThreshold: number;
    readonly duplicates: number;
    readonly overBudget: number;
  };
  readonly toolCallCount?: number;
  readonly budget?: Partial<ContextBudget>;
  readonly now?: Date;
}

export interface CompileOutput {
  readonly context: AIContext;
  readonly evidence: ReturnType<EvidenceRegistry['toPacket']>;
}

export function compileContext(input: CompileInput): CompileOutput {
  const budget = { ...DEFAULT_CONTEXT_BUDGET, ...input.budget };
  const now = input.now ?? new Date();
  const registry = new EvidenceRegistry();

  const suppressed = input.retrievalSuppressed ?? {
    belowThreshold: 0,
    duplicates: 0,
    overBudget: 0,
  };

  const facts: AuthoritativeFact[] = [];
  const metrics: DeterministicMetricRecord[] = [];
  const uncertainties: ContextUncertainty[] = [];
  const conflicts: ContextConflict[] = [];

  // ---- 1. Tool envelopes -> facts and deterministic metrics ----------------
  const acceptedEnvelopes = input.toolEnvelopes.slice(0, budget.maxToolResults);
  const droppedTools = input.toolEnvelopes.length - acceptedEnvelopes.length;

  for (const envelope of acceptedEnvelopes) {
    const item = registry.add(factFromEnvelope(envelope));
    facts.push({
      id: item.id,
      statement: describeEnvelope(envelope),
      source: item.source,
      sensitivity: envelope.provenance.sensitivity,
      ...(envelope.provenance.reportingPeriod
        ? { observedAt: `${envelope.provenance.reportingPeriod.start}/${envelope.provenance.reportingPeriod.end}` }
        : {}),
    });

    for (const extracted of extractMetrics(envelope)) {
      if (metrics.length >= budget.maxMetrics) break;
      const record: DeterministicMetricRecord = {
        ...extracted,
        // Currency is part of the identity. The same tool emits `revenue` once
        // per reporting currency; without it both rows mint `[M-revenue:2026-01]`
        // and the registry keeps only the first, so a citation for the second
        // currency resolves to the wrong amount.
        id: evidenceId(
          'deterministic_metric',
          `${extracted.metric}:${extracted.currency}:${extracted.periodStart}`,
        ),
        source: {
          id: `${envelope.provenance.tool}:${extracted.metric}:${extracted.currency}`,
          kind: extracted.source,
          origin: `tool:${envelope.provenance.tool}@${envelope.provenance.version}`,
          observedAt: envelope.provenance.generatedAt,
        },
      };
      metrics.push(record);
      registry.add(metricFromRecord(record));
    }
  }

  // ---- 2. Retrieved chunks -> untrusted evidence ---------------------------
  // Character budget is shared with metrics, so metrics are measured first and
  // evidence fills what remains.
  const metricsChars = JSON.stringify(metrics).length;
  const factsChars = JSON.stringify(facts).length;
  const evidenceCharBudget = Math.max(0, budget.maxTotalChars - metricsChars - factsChars);

  const evidence: RetrievedEvidence[] = [];
  const seenChunkKeys = new Set<string>();
  let droppedEvidence = 0;
  let droppedForChars = 0;
  let evidenceChars = 0;

  for (const scored of input.retrievedChunks) {
    if (evidence.length >= budget.maxEvidence) {
      droppedEvidence += 1;
      continue;
    }
    const key = chunkKey(scored);
    if (seenChunkKeys.has(key)) {
      droppedEvidence += 1;
      continue;
    }

    const freshness = input.freshness?.get(scored.chunk.id)?.freshness ?? 'undated';
    const id = evidenceId('retrieved_document', scored.chunk.id);
    const source: SourceReference = {
      id,
      kind: 'document',
      origin: `document:${scored.chunk.metadata.sourceType}`,
      documentId: scored.chunk.documentId,
      chunkId: scored.chunk.id,
      ...(scored.chunk.metadata.sourceTimestamp
        ? { observedAt: scored.chunk.metadata.sourceTimestamp }
        : {}),
    };

    const record: RetrievedEvidence = {
      id,
      kind: 'retrieved_context',
      source,
      content: scored.chunk.content,
      score: scored.score,
      freshness,
      chunkerVersion: scored.chunk.metadata.chunkerVersion,
    };

    // Evidence is already ordered by descending relevance, so when the budget
    // runs out the least relevant chunk is the one that goes.
    if (evidenceChars + record.content.length > evidenceCharBudget) {
      droppedForChars += 1;
      continue;
    }

    seenChunkKeys.add(key);
    evidenceChars += record.content.length;
    evidence.push(record);
    registry.add(retrievedItem(record, scored.chunk.metadata.sourceType));
  }

  // ---- 3. Conflicts between structured facts and retrieved text -----------
  conflicts.push(...detectConflicts(metrics, evidence, registry));

  // ---- 4. Absences, stated explicitly -------------------------------------
  if (evidence.length === 0) {
    uncertainties.push({
      id: 'U-evidence-absent',
      subject: 'merchant documents and history',
      reason: 'no_evidence_retrieved',
      detail:
        'No document chunk passed the similarity threshold for this question. State that there is no document evidence, and do not describe, quote or characterise any document.',
    });
  }
  if (metrics.length === 0) {
    uncertainties.push({
      id: 'U-metrics-absent',
      subject: 'structured business metrics',
      reason: 'no_evidence_retrieved',
      detail:
        'No structured metric was retrieved for this question. State any figure as unavailable. Do not estimate one.',
    });
  }
  if (droppedTools > 0 || droppedEvidence > 0 || droppedForChars > 0) {
    uncertainties.push({
      id: 'U-truncated',
      subject: 'context budget',
      reason: 'truncated_by_budget',
      detail:
        `${droppedTools} tool result(s) and ${droppedEvidence + droppedForChars} retrieved chunk(s) were dropped to stay inside the context budget. Absence here is a budget artefact, not evidence that the data does not exist.`,
    });
  }
  if (evidence.length > 0 && evidence.every((item) => item.freshness === 'stale')) {
    uncertainties.push({
      id: 'U-stale-only',
      subject: 'retrieved evidence freshness',
      reason: 'stale_evidence_only',
      detail:
        'Every retrieved chunk predates the freshness window. Present it as historical context, never as current business state.',
    });
  }
  for (const conflict of conflicts) {
    uncertainties.push({
      id: `U-${conflict.id}`,
      subject: conflict.subject,
      reason: 'conflicting_sources',
      detail: conflict.note,
    });
  }

  const metadata: ContextMetadata = {
    correlationId: input.correlationId,
    compiledAt: now.toISOString(),
    toolCalls: input.toolCallCount ?? input.toolEnvelopes.length,
    retrievalCount: evidence.length,
    suppressedByPolicy: suppressed,
    truncated: droppedTools > 0 || droppedEvidence > 0 || droppedForChars > 0,
    evidenceChars,
  };

  return {
    context: {
      question: input.question,
      authoritativeFacts: facts,
      deterministicMetrics: metrics,
      retrievedEvidence: evidence,
      inferences: [],
      sourceReferences: dedupeReferences([...facts, ...metrics, ...evidence]),
      uncertainties,
      conflicts,
      metadata,
    },
    evidence: registry.toPacket(),
  };
}

// ---------------------------------------------------------------------------
// Metric extraction
// ---------------------------------------------------------------------------

interface ExtractedMetric {
  readonly metric: string;
  readonly valueMinorUnits: number;
  readonly currency: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly source: 'database' | 'analytics' | 'domain_service';
  readonly changeBps?: number;
}

/**
 * Lifts deterministic metrics out of a tool payload.
 *
 * Tools emit a `metrics` array of `{ metric, valueMinorUnits, currency,
 * periodStart, periodEnd, source }`. Reading that declared shape rather than
 * walking arbitrary payload keys is what keeps a number from being invented: a
 * field the tool did not emit cannot become a metric.
 *
 * A `metrics` entry produced by the count shape (`value` + `unit: 'count'`) is
 * promoted only when it carries an explicit currency, since a count has none.
 */
function extractMetrics(envelope: ToolEnvelope<unknown>): ExtractedMetric[] {
  const payload = envelope.data;
  if (payload === null || typeof payload !== 'object') return [];
  const raw = (payload as Record<string, unknown>).metrics;
  if (!Array.isArray(raw)) return [];

  const out: ExtractedMetric[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;

    const name = record.metric;
    const currency = record.currency;
    const periodStart = record.periodStart ?? envelope.provenance.reportingPeriod?.start;
    const periodEnd = record.periodEnd ?? envelope.provenance.reportingPeriod?.end;

    if (typeof name !== 'string' || name.length === 0) continue;
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) continue;
    if (typeof periodStart !== 'string' || typeof periodEnd !== 'string') continue;

    const rawValue = record.valueMinorUnits ?? record.value;
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) continue;
    // A fractional minor-unit value means the producing tool violated the Money
    // contract. Truncating it would quietly lose or invent money, so the entry
    // is refused and the gap shows up as an absence.
    if (!Number.isInteger(rawValue)) continue;

    const changeBps = record.changeBps;
    out.push({
      metric: name,
      valueMinorUnits: rawValue,
      currency,
      periodStart,
      periodEnd,
      source: normaliseSource(record.source, envelope.provenance.source),
      ...(typeof changeBps === 'number' && Number.isFinite(changeBps)
        ? { changeBps: Math.trunc(changeBps) }
        : {}),
    });
  }
  return out;
}

function normaliseSource(
  value: unknown,
  fallback: ToolEnvelope<unknown>['provenance']['source'],
): 'database' | 'analytics' | 'domain_service' {
  return value === 'database' || value === 'analytics' || value === 'domain_service'
    ? value
    : fallback;
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

/** Pulls `revenue was 1,20,000`-style claims out of retrieved text. */
const FIGURE_CLAIM =
  /([a-z][a-z0-9_ ]{2,40}?)\s*(?:is|was|of|are|were|=|:)\s*(?:rs\.?|inr|₹|\$)?\s*([0-9][0-9,]{2,})\b/gi;

/**
 * Which retrieved-text subjects are worth checking against a metric.
 *
 * Deliberately narrow. Flagging every number that appears near a metric name
 * would bury real conflicts in noise; the model then ignores the section.
 */
const METRIC_SUBJECT: Readonly<Record<string, RegExp>> = {
  revenue: /revenue|sales|turnover/i,
  net_revenue: /revenue|sales|turnover/i,
  refunds: /refund/i,
  receivables_outstanding: /receivable|outstanding/i,
  inventory_value: /inventory|stock value/i,
};

function detectConflicts(
  metrics: readonly DeterministicMetricRecord[],
  evidence: readonly RetrievedEvidence[],
  registry: EvidenceRegistry,
): ContextConflict[] {
  const conflicts: ContextConflict[] = [];
  const seen = new Set<string>();

  metrics.forEach((record, metricIndex) => {
    const subjectPattern = METRIC_SUBJECT[record.metric];
    if (!subjectPattern) return;

    evidence.forEach((item, evidenceIndex) => {
      const key = `${record.id}:${item.id}`;
      if (seen.has(key)) return;

      const claim = findConflictingClaim(item.content, record.valueMinorUnits, subjectPattern);
      if (!claim) return;

      seen.add(key);
      const conflict: ContextConflict = {
        id: `C-${metricIndex}-${evidenceIndex}`,
        subject: record.metric,
        structuredValue: `${record.valueMinorUnits} minor units ${record.currency}`,
        structuredSource: record.source,
        evidenceValue: claim,
        evidenceSource: item.source,
        note: `A retrieved document states a different ${record.metric}. The structured figure is authoritative for ${record.periodStart}..${record.periodEnd}; the document statement is retained unverified and may be stale or may describe a different period. Report the disagreement rather than silently preferring one side.`,
      };
      conflicts.push(conflict);
      registry.add({
        id: conflict.id,
        type: 'tool_fact',
        source: conflict.structuredSource,
        label: `conflict:${conflict.subject}`,
        observedAt: conflict.structuredSource.observedAt ?? '',
        confidence: 'medium',
        untrusted: false,
      });
    });
  });

  return conflicts;
}

function findConflictingClaim(
  content: string,
  structuredValue: number,
  subjectPattern: RegExp,
): string | null {
  const scanner = new RegExp(FIGURE_CLAIM.source, 'gi');
  let match = scanner.exec(content);

  while (match !== null) {
    const subject = (match[1] ?? '').trim();
    const asWritten = match[2] ?? '';
    const digits = asWritten.replace(/,/g, '');

    if (subjectPattern.test(subject)) {
      const claimed = Number(digits);
      if (Number.isFinite(claimed) && claimed !== structuredValue) {
        // Reported as written on the document, commas and all, so a reviewer
        // can find the figure on the page.
        return `${asWritten} (stated in document text, subject "${subject}")`;
      }
    }
    match = scanner.exec(content);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deduplicates text so identical invoices do not fill the prompt twice. */
function chunkKey(scored: ScoredChunk): string {
  const hash = scored.chunk.metadata.contentHash;
  if (hash) return `hash:${hash}`;
  return `pos:${scored.chunk.documentId}:${scored.chunk.metadata.chunkIndex}`;
}

function dedupeReferences(items: readonly { source: SourceReference }[]): SourceReference[] {
  const seen = new Map<string, SourceReference>();
  for (const item of items) {
    const key = `${item.source.kind}:${item.source.id}`;
    if (!seen.has(key)) seen.set(key, item.source);
  }
  return Array.from(seen.values());
}

function retrievedItem(record: RetrievedEvidence, sourceType: string): EvidenceItem {
  return {
    id: record.id,
    type: 'retrieved_document',
    source: record.source,
    label: `document chunk (${sourceType}, similarity ${record.score.toFixed(2)}, ${record.freshness})`,
    observedAt: record.source.observedAt ?? '',
    // Similarity, not provenance, drives confidence here: a weak match is not
    // trustworthy however authoritative the document itself is.
    confidence: record.score >= 0.7 ? 'medium' : 'low',
    untrusted: true,
  };
}

/** A one-line, non-numeric description of what a tool contributed. */
function describeEnvelope(envelope: ToolEnvelope<unknown>): string {
  const period = envelope.provenance.reportingPeriod;
  const window = period ? ` for ${period.start}..${period.end}` : '';
  return `${envelope.provenance.tool}@${envelope.provenance.version} result from ${envelope.provenance.source}${window}`;
}
