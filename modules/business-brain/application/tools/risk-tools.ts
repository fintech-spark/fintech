// Merchant Brain: cash-flow and profit-leak tools
//
// Both read what the deterministic services already wrote. Neither recomputes a
// projection. The cash-flow tool returns the stored `risks` jsonb verbatim and
// flags explicitly when no forecast has been run, so the model says "no
// forecast available" instead of inferring one.

import { z } from 'zod';
import { defineTool } from '@/lib/ai/tools/registry';
import { currencySchema, minorUnitsSchema } from '@/lib/ai/tools/schemas';
import type { DatabaseClient } from '@/lib/database/client';
import { classifySeverity } from '@/modules/profit-leaks';
import type { DatabaseClient as DbClient } from '@/lib/database/client';
import {
  loadDocumentCoverage,
  loadLatestCashFlowForecast,
  loadProfitLeaks,
} from '../../infrastructure/expense-facts';
import { TOOL_SCHEMAS } from './common';

// ---------------------------------------------------------------------------
// cash_flow_summary
// ---------------------------------------------------------------------------

export function createCashFlowSummaryTool(database: DbClient) {
  return defineTool({
    name: 'cash_flow_summary',
    version: 'v1',
    description:
      'The most recent stored cash-flow forecast: window, starting and ending cash, and the risks the deterministic cash-flow service recorded. If no forecast has been calculated this returns forecastAvailable false — say so rather than projecting one yourself.',
    inputSchema: z.object({}).strict(),
    outputSchema: z
      .object({
        forecastAvailable: z.boolean(),
        periodStart: z.string().nullable(),
        periodEnd: z.string().nullable(),
        startingCashMinor: minorUnitsSchema.nullable(),
        endingCashMinor: minorUnitsSchema.nullable(),
        currency: currencySchema.nullable(),
        /** Deterministic: ending - starting. */
        netMovementMinor: minorUnitsSchema.nullable(),
        risks: z.array(
          z
            .object({
              type: z.string().min(1),
              severity: z.string().min(1),
              description: z.string(),
            })
            .strict(),
        ),
        calculatedAt: z.string().nullable(),
      })
      .strict(),
    authorization: { minimumRole: 'manager', permission: 'analytics:read' },
    sensitivity: 'financial',
    readOnly: true,
    source: 'domain_service',
    async execute(ctx) {
      const forecast = await loadLatestCashFlowForecast(database, ctx.tenant.businessId);
      if (!forecast) {
        return {
          forecastAvailable: false,
          periodStart: null,
          periodEnd: null,
          startingCashMinor: null,
          endingCashMinor: null,
          currency: null,
          netMovementMinor: null,
          risks: [],
          calculatedAt: null,
        };
      }

      return {
        forecastAvailable: true,
        periodStart: forecast.periodStart,
        periodEnd: forecast.periodEnd,
        startingCashMinor: forecast.startingCashMinor,
        endingCashMinor: forecast.endingCashMinor,
        currency: forecast.currency,
        netMovementMinor: forecast.endingCashMinor - forecast.startingCashMinor,
        risks: forecast.risks.map((risk) => ({
          type: risk.type,
          severity: risk.severity,
          description: risk.description,
        })),
        calculatedAt: forecast.calculatedAt,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// profit_leak_findings
// ---------------------------------------------------------------------------

export function createProfitLeakFindingsTool(database: DatabaseClient) {
  return defineTool({
    name: 'profit_leak_findings',
    version: 'v1',
    description:
      'Active and acknowledged profit leaks recorded by the deterministic leak detector, ranked by severity then impact. Each finding carries the stored severity plus a severity recomputed from impact_minor by the same deterministic thresholds the detector uses. Use this for "where is money leaking".',
    inputSchema: z
      .object({
        categories: z.array(TOOL_SCHEMAS.term.describe('leak category')).max(10).optional(),
        limit: TOOL_SCHEMAS.narrowLimit.optional(),
      })
      .strict(),
    outputSchema: z
      .object({
        findings: z.array(
          z
            .object({
              id: z.string().min(1),
              category: z.string().min(1),
              storedSeverity: z.string().min(1),
              severityFromImpact: z.string().min(1),
              title: z.string().min(1),
              description: z.string(),
              impactMinor: minorUnitsSchema,
              currency: currencySchema,
              impactPeriod: z.string(),
              status: z.string().min(1),
              detectedAt: z.string().min(1),
            })
            .strict(),
        ),
        totalImpactMinor: minorUnitsSchema,
        currency: currencySchema.nullable(),
        truncated: z.boolean(),
      })
      .strict(),
    authorization: { minimumRole: 'manager', permission: 'analytics:read' },
    sensitivity: 'financial',
    readOnly: true,
    source: 'domain_service',
    async execute(ctx, input) {
      const limit = input.limit ?? 25;
      const rows = await loadProfitLeaks(database, ctx.tenant.businessId, {
        ...(input.categories ? { categories: input.categories } : {}),
        limit,
      });

      return {
        findings: rows.map((row) => ({
          id: row.id,
          category: row.category,
          storedSeverity: row.severity,
          severityFromImpact: classifySeverity(row.impactMinor),
          title: row.title,
          description: row.description,
          impactMinor: row.impactMinor,
          currency: row.currency,
          impactPeriod: row.impactPeriod,
          status: row.status,
          detectedAt: row.detectedAt,
        })),
        totalImpactMinor: rows.reduce((sum, row) => sum + row.impactMinor, 0),
        currency: rows[0]?.currency ?? null,
        truncated: rows.length === limit,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// context_coverage
// ---------------------------------------------------------------------------

/**
 * How much retrievable document context exists at all.
 *
 * Exposed as a tool rather than folded into the compiler because the
 * distinction matters to the answer: "retrieval found nothing" and "nothing has
 * ever been indexed" call for very different responses.
 */
export function createContextCoverageTool(database: DatabaseClient) {
  return defineTool({
    name: 'context_coverage',
    version: 'v1',
    description:
      'How much document context exists to retrieve: per source type, the number of documents and the number of indexed text chunks. Use this to tell "nothing relevant found" apart from "nothing indexed yet".',
    inputSchema: z.object({}).strict(),
    outputSchema: z
      .object({
        bySourceType: z.array(
          z
            .object({
              sourceType: z.string().min(1),
              documentCount: z.number().int().nonnegative(),
              indexedChunkCount: z.number().int().nonnegative(),
            })
            .strict(),
        ),
        totalDocuments: z.number().int().nonnegative(),
        totalIndexedChunks: z.number().int().nonnegative(),
        anyIndexed: z.boolean(),
      })
      .strict(),
    authorization: { minimumRole: 'staff', permission: 'documents:read' },
    sensitivity: 'business_profile',
    readOnly: true,
    source: 'database',
    async execute(ctx) {
      const rows = await loadDocumentCoverage(database, ctx.tenant.businessId);
      const totalDocuments = rows.reduce((sum, row) => sum + row.documentCount, 0);
      const totalIndexedChunks = rows.reduce((sum, row) => sum + row.indexedChunkCount, 0);

      return {
        bySourceType: rows.map((row) => ({
          sourceType: row.sourceType,
          documentCount: row.documentCount,
          indexedChunkCount: row.indexedChunkCount,
        })),
        totalDocuments,
        totalIndexedChunks,
        anyIndexed: totalIndexedChunks > 0,
      };
    },
  });
}
