// Injectable time source.
//
// Services must never call `Date.now()` or `new Date()` directly. Time is an
// input to every deterministic intelligence result: a profit-leak severity, a
// cash-flow risk window, and an action approval expiry are all functions of
// "now". Reading the wall clock inside business logic makes those results
// impossible to assert in a test and impossible to replay.
//
// Production wiring passes `systemClock`. Tests pass `fixedClock`, which makes
// every time-dependent assertion exact instead of flaky.
//
// This is additive shared-kernel infrastructure alongside `Money`, `Result` and
// `TenantContext`; it introduces no new dependency and changes no existing
// export.

export interface Clock {
  /** Current instant. */
  now(): Date;
}

/** Reads the host wall clock. The only clock allowed in production wiring. */
export const systemClock: Clock = {
  now: () => new Date(),
};

/** Always returns the same instant. For deterministic tests. */
export function fixedClock(instant: Date): Clock {
  const pinned = new Date(instant.getTime());
  return { now: () => new Date(pinned.getTime()) };
}

/** Advances by a fixed step on every read. For time-travel tests. */
export function steppingClock(start: Date, stepMs: number): Clock {
  const origin = start.getTime();
  let calls = 0;
  return {
    now: () => {
      const current = new Date(origin + calls * stepMs);
      calls += 1;
      return current;
    },
  };
}