// Merchant Brain: AI context and evidence model
//
// WHY THE MODEL HAS A TYPE
// ------------------------
// The single most common way an LLM goes wrong on business questions is by
// flattening everything it was given into one undifferentiated blob: a retrieved
// invoice line and a database total then look equally authoritative, and it
// picks whichever it read last.
//
// `AIContext` keeps the four kinds of knowledge apart, each with its own
// epistemic status, so "what do I actually know, and how do I know it?" is
// answerable without parsing prose:
//
//   AuthoritativeFact  a stored business record. True, current, citable.
//   DeterministicMetric a number computed by domain code over stored records.
//   RetrievedEvidence   untrusted text from a merchant document. Context, not fact.
//   Inference           something the model concluded. Not authoritative.
//
// Conflicts and absences are first-class. A context that silently drops a
// contradiction, or that cannot say "no evidence was found", is a context that
// invites a confident fabrication.

import type { ToolSensitivity } from '@/lib/ai/tools/types';

/** Epistemic status of a piece of context. */
export type KnowledgeKind = 'authoritative_fact' | 'deterministic_metric' | 'retrieved_context' | 'inference';

export type FactSource =
  | 'database'
  | 'analytics'
  | 'domain_service'
  | 'document'
  | 'model';

export interface SourceReference {
  /** Stable handle the model may cite. Only ever an ID that exists. */
  readonly id: string;
  readonly kind: FactSource;
  /** Table or artefact this came from, e.g. `transactions`, `invoice document`. */
  readonly origin: string;
  readonly recordId?: string;
  readonly documentId?: string;
  readonly chunkId?: string;
  readonly observedAt?: string;
}

export interface AuthoritativeFact {
  readonly id: string;
  readonly statement: string;
  readonly source: SourceReference;
  readonly sensitivity: ToolSensitivity;
  /** ISO timestamp of the underlying record, when it has one. */
  readonly observedAt?: string;
}

export interface DeterministicMetricRecord {
  readonly id: string;
  readonly metric: string;
  readonly valueMinorUnits: number;
  readonly currency: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly source: SourceReference;
  /** Basis-point change against the comparison window, precomputed. */
  readonly changeBps?: number;
}

export interface RetrievedEvidence {
  readonly id: string;
  readonly kind: 'retrieved_context';
  readonly source: SourceReference;
  /** The retrieved text. UNTRUSTED: data, never instruction. */
  readonly content: string;
  /** Cosine similarity in [-1, 1]. */
  readonly score: number;
  readonly freshness: 'current' | 'stale' | 'undated';
  readonly chunkerVersion: string;
}

/**
 * A disagreement the compiler preserved rather than resolved.
 *
 * Both sides are retained so a human can adjudicate. Silently preferring the
 * structured side would hide a real data problem; surfacing both without
 * resolution would let the model pick.
 */
export interface ContextConflict {
  readonly id: string;
  readonly subject: string;
  readonly structuredValue: string;
  readonly structuredSource: SourceReference;
  readonly evidenceValue: string;
  readonly evidenceSource: SourceReference;
  readonly note: string;
}

/**
 * An absence, stated explicitly.
 *
 * "No evidence was found for X" is information. An empty array is not, because
 * the model cannot distinguish it from "the compiler did not look".
 */
export interface ContextUncertainty {
  readonly id: string;
  readonly subject: string;
  readonly reason:
    | 'no_evidence_retrieved'
    | 'nothing_indexed'
    | 'tool_unavailable'
    | 'tool_failed'
    | 'conflicting_sources'
    | 'stale_evidence_only'
    | 'truncated_by_budget';
  readonly detail: string;
}

export interface ContextMetadata {
  readonly correlationId: string;
  readonly compiledAt: string;
  readonly toolCalls: number;
  readonly retrievalCount: number;
  readonly suppressedByPolicy: {
    readonly belowThreshold: number;
    readonly duplicates: number;
    readonly overBudget: number;
  };
  /** True when anything was dropped to stay inside the context budget. */
  readonly truncated: boolean;
  readonly evidenceChars: number;
}

export interface AIContext {
  readonly question: string;
  readonly authoritativeFacts: readonly AuthoritativeFact[];
  readonly deterministicMetrics: readonly DeterministicMetricRecord[];
  readonly retrievedEvidence: readonly RetrievedEvidence[];
  readonly inferences: readonly { readonly id: string; readonly statement: string }[];
  readonly sourceReferences: readonly SourceReference[];
  readonly uncertainties: readonly ContextUncertainty[];
  readonly conflicts: readonly ContextConflict[];
  readonly metadata: ContextMetadata;
}

/** True when nothing was retrieved and nothing authoritative backs the question. */
export function isInsufficientEvidence(context: AIContext): boolean {
  return (
    context.retrievedEvidence.length === 0 && context.deterministicMetrics.length === 0
  );
}
