// Deterministic integer/basis-point arithmetic for authoritative business figures.
//
// Canonical money representation is `Money { amount: number }` where `amount`
// is an integer count of currency minor units (paise for INR). No function in
// this file performs floating-point currency arithmetic, and none of them
// consult a clock, a random source, or tenant state, so identical inputs always
// produce identical outputs.
//
// Basis points (bps) are the only representation used for rates and ratios.
// 1 bps = 0.01%. 10_000 bps = 100%. Storing rates as bps keeps every ratio an
// exact integer until it is deliberately rounded once, at the boundary.

/** 10_000 bps = 100%. Used to convert a bps rate into a multiplier. */
export const BPS_SCALE = 10_000;

/** A quantity that is safe to add, subtract and multiply without precision loss. */
export function isSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value);
}

/**
 * Sum minor-unit amounts. Throws when the running total would leave the safe
 * integer range, because silently producing an imprecise financial total is
 * worse than refusing to produce one.
 */
export function sumMinorUnits(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    assertMinorUnits(value);
    total += value;
    if (!Number.isSafeInteger(total)) {
      throw new RangeError(
        `Money total exceeded the safe integer range while summing minor units (got ${total}).`,
      );
    }
  }
  return total;
}

/**
 * Validates that `value` is a safe integer count of minor units and returns it
 * unchanged. Returning the value lets call sites assert and assign in one step.
 */
export function assertMinorUnits(value: number, label = 'amount'): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer count of minor units, got ${value}.`);
  }
  return value;
}

/** Multiplies a minor-unit amount by a bps rate, rounding half away from zero exactly once. */
export function applyBpsToMinorUnits(minorUnits: number, bps: number): number {
  assertMinorUnits(minorUnits);
  if (!Number.isFinite(bps)) {
    throw new RangeError(`Basis points must be finite, got ${bps}.`);
  }
  const scaled = (minorUnits * bps) / BPS_SCALE;
  return roundHalfAwayFromZero(scaled);
}

/**
 * Rounds a value to the nearest integer, resolving exact halves away from zero
 * so that -0.5 -> -1 and 0.5 -> 1. `Math.round` resolves -0.5 to -0, which
 * would make symmetric figures round asymmetrically.
 */
export function roundHalfAwayFromZero(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Cannot round a non-finite value (${value}).`);
  }
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Rate in bps of `part` against `whole`.
 *
 * Returns `undefined` when the denominator is zero, because a percentage change
 * from nothing is undefined rather than zero. Callers must surface that as an
 * explicit unavailable state instead of reporting a fabricated rate.
 */
export function ratioBps(part: number, whole: number): number | undefined {
  if (!Number.isFinite(part) || !Number.isFinite(whole)) return undefined;
  if (whole === 0) return undefined;
  return roundHalfAwayFromZero((part / whole) * BPS_SCALE);
}

/**
 * Period-over-period change in bps, signed: positive means growth.
 *
 * Uses the magnitude of the baseline so that a move from a loss to a profit is
 * reported by magnitude rather than sign inversion. Returns `undefined` when the
 * baseline is zero because no meaningful growth rate exists.
 */
export function changeBps(current: number, previous: number): number | undefined {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return undefined;
  if (previous === 0) return undefined;
  return roundHalfAwayFromZero(((current - previous) / Math.abs(previous)) * BPS_SCALE);
}

/**
 * Margin in bps. Margin is profit over revenue, so a zero revenue denominator
 * yields an undefined margin rather than a misleading zero.
 */
export function marginBps(profit: number, revenue: number): number | undefined {
  return ratioBps(profit, revenue);
}

/**
 * Clamps a value into an inclusive integer range. Used to keep detector inputs
 * and severity bands inside their declared bounds.
 */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`Cannot clamp a non-finite value (${value}).`);
  if (min > max) throw new RangeError(`Invalid clamp range [${min}, ${max}].`);
  return Math.min(max, Math.max(min, value));
}

/** Converts a percentage expressed as a human number (5 = 5%) into bps. */
export function percentToBps(percent: number): number {
  if (!Number.isFinite(percent)) {
    throw new RangeError(`Percentage must be finite, got ${percent}.`);
  }
  return roundHalfAwayFromZero(percent * 100);
}

/** Converts basis points into a percentage expressed as a human number. */
export function bpsToPercent(bps: number): number {
  return bps / 100;
}

/**
 * Weighted average unit cost in minor units, computed from integer inputs.
 *
 * Weighted averaging is done on the product of minor units and quantity first
 * and divided once at the end, so no intermediate rounding error accumulates.
 * Returns `undefined` when total quantity is zero.
 */
export function weightedAverageMinorUnits(
  samples: readonly { readonly minorUnits: number; readonly quantity: number }[],
): number | undefined {
  let weightedTotal = 0;
  let totalQuantity = 0;
  for (const sample of samples) {
    if (sample.quantity <= 0) {
      throw new RangeError(`Weighted average quantity must be positive, got ${sample.quantity}.`);
    }
    weightedTotal += sample.minorUnits * sample.quantity;
    totalQuantity += sample.quantity;
  }
  if (totalQuantity === 0) return undefined;
  return roundHalfAwayFromZero(weightedTotal / totalQuantity);
}

/** Median of a numeric sample. Returns `undefined` for an empty sample. */
export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid];
  const lower = sorted.length % 2 === 1 ? upper : sorted[mid - 1];
  if (upper === undefined || lower === undefined) return undefined;
  return (upper + lower) / 2;
}

/** Arithmetic mean of a numeric sample. Returns `undefined` for an empty sample. */
export function mean(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

/**
 * Largest value in a sample, or `undefined` when the sample is empty. Used for
 * peak-outflow and single-counterparty concentration checks.
 */
export function maxOf(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  let highest = values[0] as number;
  for (const value of values) if (value > highest) highest = value;
  return highest;
}

/**
 * A deterministic, content-derived stable key. Used to deduplicate notifications
 * and to detect parameter tampering. Not a cryptographic identity: it only has
 * to be stable and collision-resistant enough for those two purposes.
 */
export function stableKey(parts: readonly string[]): string {
  const normalized = parts
    .map((part) => encodeURIComponent(part))
    .join('\u001f');
  return hashString(normalized);
}

/**
 * FNV-1a 32-bit hash rendered as 8 lowercase hex characters. Chosen because it
 * needs no runtime dependency and is stable across Node versions, which keeps
 * tamper detection reproducible in tests and in production.
 */
export function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}