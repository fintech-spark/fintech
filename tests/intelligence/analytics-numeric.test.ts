import { describe, expect, it } from 'vitest';
import {
  BPS_SCALE,
  applyBpsToMinorUnits,
  assertMinorUnits,
  bpsToPercent,
  changeBps,
  clamp,
  endOfReportingDay,
  endOfReportingMonth,
  hashString,
  marginBps,
  maxOf,
  mean,
  median,
  percentToBps,
  previousEquivalentPeriod,
  ratioBps,
  resolveReportingTimezone,
  roundHalfAwayFromZero,
  splitIntoReportingMonths,
  startOfReportingDay,
  sumMinorUnits,
  toReportingDateLabel,
  weightedAverageMinorUnits,
  type HalfOpenPeriod,
} from '@/modules/analytics';

const IST = 'Asia/Kolkata';

describe('integer money arithmetic', () => {
  it('sums minor units exactly', () => {
    expect(sumMinorUnits([100, 250, 650])).toBe(1_000);
  });

  it('refuses to sum beyond the safe integer range rather than losing precision', () => {
    const huge = Number.MAX_SAFE_INTEGER - 5;
    expect(() => sumMinorUnits([huge, huge])).toThrow(/safe integer/i);
  });

  it('rejects a non-integer minor-unit value', () => {
    expect(() => assertMinorUnits(10.5)).toThrow(/safe integer/i);
    expect(() => assertMinorUnits(Number.NaN)).toThrow();
  });

  it('applies a bps rate to minor units, rounding once', () => {
    expect(applyBpsToMinorUnits(100_000, 1_000)).toBe(10_000);
    expect(applyBpsToMinorUnits(999, 5_000)).toBe(500);
    expect(applyBpsToMinorUnits(1, 5_000)).toBe(1);
  });

  it('rounds halves away from zero symmetrically', () => {
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
  });

  it('handles negative minor units without truncation', () => {
    expect(applyBpsToMinorUnits(-100_000, 1_000)).toBe(-10_000);
    expect(roundHalfAwayFromZero(-2.4)).toBe(-2);
  });
});

describe('rates and ratios', () => {
  it('computes a ratio in bps', () => {
    expect(ratioBps(250, 1_000)).toBe(2_500);
  });

  it('returns undefined for a zero denominator rather than a fabricated zero', () => {
    expect(ratioBps(0, 0)).toBeUndefined();
    expect(ratioBps(500, 0)).toBeUndefined();
    expect(marginBps(0, 0)).toBeUndefined();
  });

  it('reports a signed change against the magnitude of the baseline', () => {
    expect(changeBps(120, 100)).toBe(2_000);
    expect(changeBps(80, 100)).toBe(-2_000);
    expect(changeBps(50, -100)).toBe(15_000);
  });

  it('leaves a change from a zero baseline undefined', () => {
    expect(changeBps(500, 0)).toBeUndefined();
    expect(changeBps(0, 0)).toBeUndefined();
  });

  it('converts between percentages and bps without drift', () => {
    expect(percentToBps(5)).toBe(500);
    expect(bpsToPercent(500)).toBe(5);
    expect(BPS_SCALE).toBe(10_000);
  });

  it('clamps into an inclusive range', () => {
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(5, 0, 10)).toBe(5);
  });
});

describe('statistics used by detectors', () => {
  it('averages a sample and reports undefined for an empty one', () => {
    expect(mean([10, 20, 30])).toBe(20);
    expect(mean([])).toBeUndefined();
  });

  it('takes the median, including for an even sample', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeUndefined();
  });

  it('finds the maximum or reports undefined', () => {
    expect(maxOf([3, 9, 2])).toBe(9);
    expect(maxOf([])).toBeUndefined();
  });

  it('computes a quantity-weighted average cost on integers', () => {
    expect(
      weightedAverageMinorUnits([
        { minorUnits: 100, quantity: 1 },
        { minorUnits: 200, quantity: 3 },
      ]),
    ).toBe(175);
  });

  it('refuses a weighted average with a non-positive quantity', () => {
    expect(() => weightedAverageMinorUnits([{ minorUnits: 100, quantity: 0 }])).toThrow();
  });
});

describe('tamper detection hashing', () => {
  it('is stable across calls for identical input', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
  });

  it('differs for different input', () => {
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});

describe('reporting timezone semantics', () => {
  it('uses the business timezone when it is valid', () => {
    expect(resolveReportingTimezone(IST)).toEqual({ timeZone: IST, fallback: false });
  });

  it('falls back visibly when the stored zone is unusable', () => {
    const resolved = resolveReportingTimezone('Not/AZone');
    expect(resolved.fallback).toBe(true);
    expect(resolved.timeZone).toBe('Asia/Kolkata');
    expect(resolveReportingTimezone(undefined).fallback).toBe(true);
  });

  it('starts the reporting day at local midnight, not UTC midnight', () => {
    // 2026-03-15T18:30Z is 2026-03-16T00:00 IST, so the day starts at 18:30Z the day before.
    const instant = new Date('2026-03-15T18:30:00.000Z');
    expect(startOfReportingDay(instant, IST).toISOString()).toBe('2026-03-15T18:30:00.000Z');
    expect(toReportingDateLabel(instant, IST)).toBe('2026-03-16');
  });

  it('ends the reporting day at the next local midnight', () => {
    const instant = new Date('2026-03-15T18:30:00.000Z');
    expect(endOfReportingDay(instant, IST).toISOString()).toBe('2026-03-16T18:30:00.000Z');
  });

  it('ends the reporting month on the last day of that month', () => {
    const instant = new Date('2026-02-10T00:00:00.000Z');
    // February 2026 has 28 days; the next local midnight is 2026-03-01T00:00 IST.
    expect(endOfReportingMonth(instant, IST).toISOString()).toBe('2026-02-28T18:30:00.000Z');
  });

  it('reports the same label for a UTC instant in a merchant-facing way', () => {
    expect(toReportingDateLabel(new Date('2026-01-01T00:00:00.000Z'), 'UTC')).toBe('2026-01-01');
  });
});

describe('period comparison', () => {
  const january: HalfOpenPeriod = {
    from: new Date('2026-01-01T00:00:00.000Z'),
    to: new Date('2026-02-01T00:00:00.000Z'),
  };

  it('derives the previous equivalent period from the exact duration', () => {
    const previous = previousEquivalentPeriod(january);
    expect(previous.to.getTime()).toBe(january.from.getTime());
    expect(previous.from.toISOString()).toBe('2025-12-01T00:00:00.000Z');
  });

  it('produces adjacent windows that touch without overlapping', () => {
    const previous = previousEquivalentPeriod(january);
    expect(previous.to.getTime()).toBe(january.from.getTime());
    expect(previous.from.getTime()).toBeLessThan(previous.to.getTime());
  });

  it('keeps window length equal across a daylight-saving transition', () => {
    const acrossDst: HalfOpenPeriod = {
      from: new Date('2026-03-07T00:00:00.000Z'),
      to: new Date('2026-03-14T00:00:00.000Z'),
    };
    const previous = previousEquivalentPeriod(acrossDst);
    const originalDays =
      (acrossDst.to.getTime() - acrossDst.from.getTime()) / 86_400_000;
    const previousDays = (previous.to.getTime() - previous.from.getTime()) / 86_400_000;
    expect(previousDays).toBe(originalDays);
  });

  it('rejects a non-positive period', () => {
    expect(() =>
      previousEquivalentPeriod({ from: new Date('2026-01-02'), to: new Date('2026-01-01') }),
    ).toThrow(/positive duration/i);
  });
});

describe('period bucketing', () => {
  it('splits a half-open period into non-overlapping months', () => {
    const windows = splitIntoReportingMonths(
      { from: new Date('2026-01-01T00:00:00.000Z'), to: new Date('2026-04-01T00:00:00.000Z') },
      'UTC',
    );
    expect(windows).toHaveLength(3);
    expect(windows[0]?.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(windows[2]?.to.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    for (let index = 1; index < windows.length; index += 1) {
      expect(windows[index]?.from.getTime()).toBe(windows[index - 1]?.to.getTime());
    }
  });

  it('clamps the first and last month to the requested range', () => {
    const windows = splitIntoReportingMonths(
      { from: new Date('2026-01-15T00:00:00.000Z'), to: new Date('2026-02-10T00:00:00.000Z') },
      'UTC',
    );
    expect(windows[0]?.from.toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(windows[windows.length - 1]?.to.toISOString()).toBe('2026-02-10T00:00:00.000Z');
  });
});