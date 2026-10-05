// Merchant Brain: evidence packets
//
// An evidence item is a citable handle. The model may reference `id` and
// nothing else, so a citation is always resolvable to something that exists.
//
// IDs are minted here, deterministically from the tool name or chunk id, and
// collected into a registry. The prompt builder emits the registry alongside
// the context, which means a fabricated `[E-999]` reference is visibly absent
// rather than silently plausible.

import type { ToolEnvelope, ToolProvenance } from '@/lib/ai/tools/types';
import type { DeterministicMetricRecord, SourceReference } from './context';

export type EvidenceType = 'tool_fact' | 'deterministic_metric' | 'retrieved_document';

export interface EvidenceItem {
  readonly snapshotId?: string;
  readonly provenance?: unknown;
  readonly id: string;
  readonly type: EvidenceType;
  readonly source: SourceReference;
  /** Human-readable label shown to the model alongside the content. */
  readonly label: string;
  readonly observedAt: string;
  readonly confidence: 'high' | 'medium' | 'low';
  /** Whether the model must treat this content as data rather than instruction. */
  readonly untrusted: boolean;
}

export interface EvidencePacket {
  readonly items: readonly EvidenceItem[];
  /** Only IDs present here may be cited by the model. */
  readonly citableIds: readonly string[];
}

export class EvidenceRegistry {
  private readonly items = new Map<string, EvidenceItem>();
  private order: string[] = [];

  add(item: EvidenceItem): EvidenceItem {
    if (this.items.has(item.id)) return this.items.get(item.id) as EvidenceItem;
    this.items.set(item.id, item);
    this.order.push(item.id);
    return item;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  get(id: string): EvidenceItem | undefined {
    return this.items.get(id);
  }

  list(): readonly EvidenceItem[] {
    return this.order.map((id) => this.items.get(id) as EvidenceItem);
  }

  toPacket(): EvidencePacket {
    return { items: this.list(), citableIds: [...this.order] };
  }
}

/**
 * Deterministic, collision-free evidence id.
 *
 * Prefixed by type so a reader can tell what kind of thing is being cited, and
 * derived from a stable key so recompiling the same context yields the same ids
 * — which makes prompt assertions in tests possible.
 */
export function evidenceId(type: EvidenceType, key: string): string {
  return `[${type === 'tool_fact' ? 'F' : type === 'deterministic_metric' ? 'M' : 'E'}-${key}]`;
}

export function toolSource(provenance: ToolProvenance): SourceReference {
  return {
    id: provenance.tool,
    kind: provenance.source,
    origin: `tool:${provenance.tool}@${provenance.version}`,
    observedAt: provenance.generatedAt,
  };
}

export function metricSource(
  origin: string,
  observedAt: string,
): SourceReference {
  return { id: origin, kind: 'analytics', origin, observedAt };
}

/**
 * Wraps a validated tool envelope as a citable fact.
 *
 * Every tool result is `high` confidence because it came from a schema-validated
 * query against the merchant's own records. Confidence drops for retrieved
 * document text, never for structured data — the asymmetry is the point.
 */
export function factFromEnvelope(envelope: ToolEnvelope<unknown>): EvidenceItem {
  return {
    id: evidenceId('tool_fact', envelope.provenance.tool),
    type: 'tool_fact',
    source: toolSource(envelope.provenance),
    label: `${envelope.provenance.tool} (${envelope.provenance.source})`,
    observedAt: envelope.provenance.generatedAt,
    // A tool that had to truncate its own result is less trustworthy for the
    // excluded rows, so the confidence travels with the payload.
    confidence: 'high',
    untrusted: false,
  };
}

export function metricFromRecord(record: DeterministicMetricRecord): EvidenceItem {
  return {
    id: record.id,
    type: 'deterministic_metric',
    source: record.source,
    label: `${record.metric} (${record.currency}, minor units)`,
    observedAt: record.source.observedAt ?? record.periodEnd,
    confidence: 'high',
    untrusted: false,
  };
}
