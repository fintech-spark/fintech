// Serialization between a stored forecast row and the domain type.
//
// `cash_flow_forecasts.periods` and `.risks` are JSONB, so a projection read back
// from the database arrives as plain objects with ISO date strings rather than
// `Date` instances. Every field is validated and rebuilt explicitly here; nothing
// is spread through unchecked, because a malformed row must fail loudly instead
// of poisoning a merchant-facing balance.

import { ValidationError } from '@/lib/errors';
import { asBusinessId, createMoney, type CurrencyCode, type Money } from '@/lib/types';
import type {
  CashFlowConfidence,
  CashFlowForecast,
  CashFlowItem,
  CashFlowPeriod,
  CashFlowRisk,
  CashFlowSourceType,
  ForecastAssumption,
  ForecastCoverage,
  OpeningBalanceSource,
  RiskSeverity,
  RiskType,
} from '../domain/types';
import type { CashFlowForecastRow } from './cash-flow-repository';
import { DEFAULT_REPORTING_TIMEZONE } from '@/modules/analytics';

interface HydrationOptions {
  readonly reportingTimezone?: string;
  readonly assumptions?: readonly ForecastAssumption[];
  readonly coverage?: ForecastCoverage;
}

const CONFIDENCES: readonly CashFlowConfidence[] = ['actual', 'expected', 'projected'];
const SOURCE_TYPES: readonly CashFlowSourceType[] = [
  'transaction',
  'receivable',
  'payable',
  'expense',
  'recurring_expense',
  'historical_average',
  'derived',
];
const RISK_TYPES: readonly RiskType[] = [
  'negative_balance',
  'low_balance',
  'high_concentration',
  'payment_spike',
];
const RISK_SEVERITIES: readonly RiskSeverity[] = ['critical', 'warning', 'info'];

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(`Stored forecast field "${field}" is not an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`Stored forecast field "${field}" is not an array.`);
  }
  return value;
}

function asInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ValidationError(`Stored forecast field "${field}" is not an integer.`);
  }
  return value;
}

function asText(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`Stored forecast field "${field}" is not a string.`);
  }
  return value;
}

function asDate(value: unknown, field: string): Date {
  const text = asText(value, field);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`Stored forecast field "${field}" is not a valid timestamp.`);
  }
  return parsed;
}

function asMember<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  const text = asText(value, field);
  if (!(allowed as readonly string[]).includes(text)) {
    throw new ValidationError(
      `Stored forecast field "${field}" has unsupported value "${text}".`,
    );
  }
  return text as T;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

function hydrateItem(value: unknown): CashFlowItem {
  const record = asRecord(value, 'periods[].inflows[]');
  return {
    category: asText(record.category, 'category') as CashFlowItem['category'],
    amount: asInteger(record.amount, 'amount'),
    description: asText(record.description, 'description'),
    confidence: asMember(record.confidence, CONFIDENCES, 'confidence'),
    ...(optionalText(record.sourceId) === undefined ? {} : { sourceId: optionalText(record.sourceId) }),
    ...(record.sourceType === undefined
      ? {}
      : { sourceType: asMember(record.sourceType, SOURCE_TYPES, 'sourceType') }),
    assumptionBased: record.assumptionBased === true,
  };
}

function hydratePeriod(value: unknown): CashFlowPeriod {
  const record = asRecord(value, 'periods[]');
  const inflows = asArray(record.inflows, 'periods[].inflows').map(hydrateItem);
  const outflows = asArray(record.outflows, 'periods[].outflows').map(hydrateItem);
  return {
    periodStart: asDate(record.periodStart, 'periodStart'),
    periodEnd: asDate(record.periodEnd, 'periodEnd'),
    inflows,
    outflows,
    netFlow: asInteger(record.netFlow, 'netFlow'),
    runningBalance: asInteger(record.runningBalance, 'runningBalance'),
  };
}

function hydrateRisk(value: unknown): CashFlowRisk {
  const record = asRecord(value, 'risks[]');
  const shortfall = optionalInteger(record.projectedShortfall);
  return {
    type: asMember(record.type, RISK_TYPES, 'type'),
    severity: asMember(record.severity, RISK_SEVERITIES, 'severity'),
    periodStart: asDate(record.periodStart, 'periodStart'),
    description: asText(record.description, 'description'),
    ...(shortfall === undefined ? {} : { projectedShortfall: shortfall }),
    contributingFactors: asArray(record.contributingFactors, 'contributingFactors').map(
      (factor) => asText(factor, 'contributingFactors[]'),
    ),
    relatedIds: asArray(record.relatedIds, 'relatedIds').map((id) => asText(id, 'relatedIds[]')),
  };
}

/** Rebuilds a domain forecast from a stored row. */
export function hydrateForecast(
  row: CashFlowForecastRow,
  calculatedAt: Date,
  options: HydrationOptions = {},
): CashFlowForecast {
  const currency = (row.currency ?? 'INR') as CurrencyCode;
  const coverage: ForecastCoverage =
    options.coverage ??
    ({
      coverageBps: 0,
      historicalWindowDays: 0,
      periodsOfHistory: 0,
      hasEnoughHistory: false,
      quality: 'insufficient_data',
      knownGaps: [
        'Coverage metadata was not persisted with this forecast; treat every figure as unverified.',
      ],
    } satisfies ForecastCoverage);

  const periods = asArray(row.periods, 'periods').map(hydratePeriod);
  const openingSource: OpeningBalanceSource =
    row.startingCashMinor === 0 && periods.length === 0 ? 'unavailable' : 'ledger_derived';

  return {
    id: row.id,
    businessId: asBusinessId(row.businessId),
    period: { from: row.periodStart, to: row.periodEnd },
    periods,
    startingCash: createMoney(row.startingCashMinor, currency) as Money,
    endingCash: createMoney(row.endingCashMinor, currency) as Money,
    risks: asArray(row.risks, 'risks').map(hydrateRisk),
    calculatedAt: row.calculatedAt ?? calculatedAt,
    currency,
    reportingTimezone: options.reportingTimezone ?? DEFAULT_REPORTING_TIMEZONE,
    granularity: 'week',
    assumptions: options.assumptions ?? [],
    coverage,
    isProjection: true,
    openingBalanceSource: openingSource,
  };
}

/**
 * Converts a domain forecast into a storable row.
 *
 * The `risks` column stores a plain risk array, matching its
 * `jsonb NOT NULL DEFAULT '[]'` shape. The schema has no column for assumptions
 * or coverage, so those are not persisted; a forecast re-read from storage
 * therefore reports them through the explicit "not persisted" fallback in
 * `hydrateForecast` rather than pretending it still knows them.
 */
export function toForecastRow(input: {
  id: string;
  businessId: CashFlowForecast['businessId'];
  forecast: CashFlowForecast;
}): CashFlowForecastRow {
  return {
    id: input.id,
    businessId: input.businessId,
    periodStart: input.forecast.period.from,
    periodEnd: input.forecast.period.to,
    periods: JSON.parse(JSON.stringify(input.forecast.periods)) as unknown,
    startingCashMinor: input.forecast.startingCash.amount,
    endingCashMinor: input.forecast.endingCash.amount,
    currency: input.forecast.currency,
    risks: JSON.parse(JSON.stringify(input.forecast.risks)) as unknown,
    calculatedAt: input.forecast.calculatedAt,
  };
}
