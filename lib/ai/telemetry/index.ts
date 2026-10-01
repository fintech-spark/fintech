/**
 * AI Telemetry
 *
 * Tracks AI operations for observability without storing sensitive data.
 */

import type { AIProvider, ModelRole, TokenUsage } from '../providers/types';

/** Record of a single AI operation */
export interface AIOperationRecord {
  readonly operationId: string;
  readonly provider: AIProvider;
  readonly model: string;
  readonly role: ModelRole;
  readonly task: string;
  readonly latencyMs: number;
  readonly usage: TokenUsage;
  readonly toolCalls: number;
  readonly success: boolean;
  readonly error?: string;
  readonly fallback: boolean;
  readonly timestamp: Date;
}

/** Telemetry collector interface */
export interface AITelemetry {
  record(operation: AIOperationRecord): void;
  getRecent(limit?: number): AIOperationRecord[];
}

/** In-memory telemetry collector */
export function createAITelemetry(maxRecords = 1000): AITelemetry {
  const records: AIOperationRecord[] = [];

  return {
    record(operation: AIOperationRecord): void {
      records.push(operation);
      if (records.length > maxRecords) records.shift();
    },
    getRecent(limit = 50): AIOperationRecord[] {
      return records.slice(-limit);
    },
  };
}
