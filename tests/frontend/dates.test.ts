// Merchant Brain: date and period tests.
//
// Two failure modes this file exists to prevent:
//   1. An off-by-one day. `new Date("2026-03-01")` is UTC midnight, which is
//      the previous day for a merchant in most of the world — a reporting UI
//      that silently shifts a due date is worse than one that shows nothing.
//   2. A silent reporting period. `daysUntil` and `resolvePeriod` must be exact
//      and deterministic, because a merchant's decision depends on them.

import { describe, expect, it } from "vitest";

import {
  PERIOD_PRESETS,
  daysUntil,
  formatDate,
  formatDateLong,
  formatRelativeTime,
  isPeriodPreset,
  parseDateInput,
  periodLabel,
  resolvePeriod,
  toDateInputValue,
} from "@/lib/format/dates";

describe("parseDateInput", () => {
  // A local-timezone constructor is deliberate: a date-only value is a calendar
  // day, not an instant.
  it("reads a date-only string as a local calendar day", () => {
    const parsed = parseDateInput("2026-03-01");
    expect(parsed).not.toBeNull();
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(2);
    expect(parsed?.getDate()).toBe(1);
  });

  it("rejects a day that does not exist rather than rolling it over", () => {
    // `new Date(2026, 1, 30)` silently becomes 2 March. That is exactly the
    // class of bug this guard prevents.
    expect(parseDateInput("2026-02-30")).toBeNull();
    expect(parseDateInput("2026-13-01")).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(parseDateInput("")).toBeNull();
    expect(parseDateInput("01-03-2026")).toBeNull();
    expect(parseDateInput("not a date")).toBeNull();
  });

  it("round-trips through toDateInputValue", () => {
    const date = new Date(2026, 8, 9);
    expect(toDateInputValue(date)).toBe("2026-09-09");
    expect(toDateInputValue(parseDateInput(toDateInputValue(date)))).toBe("2026-09-09");
  });
});

describe("isPeriodPreset", () => {
  it("accepts only the known presets", () => {
    for (const preset of PERIOD_PRESETS) {
      expect(isPeriodPreset(preset)).toBe(true);
    }
    expect(isPeriodPreset("last_6_days")).toBe(false);
    expect(isPeriodPreset("")).toBe(false);
  });

  it("labels every preset in merchant language", () => {
    // No abbreviations: a merchant should not have to decode a window.
    expect(periodLabel("last_30_days")).toBe("Last 30 days");
    expect(periodLabel("previous_month")).toBe("Previous month");
  });
});

describe("resolvePeriod", () => {
  const now = new Date(2026, 2, 15, 14, 30, 0); // 15 Mar 2026, 14:30 local

  it("resolves today to the start of the local day", () => {
    const { from, to } = resolvePeriod("today", now);
    expect(new Date(from).getDate()).toBe(15);
    expect(new Date(from).getHours()).toBe(0);
    expect(new Date(to).getHours()).toBe(14);
  });

  it("resolves last 7 days to an inclusive seven-day window", () => {
    const { from, to } = resolvePeriod("last_7_days", now);
    const start = new Date(from);
    expect(start.getDate()).toBe(9);
    expect(start.getHours()).toBe(0);
    expect(to).toBe(now.toISOString());
  });

  it("resolves last 30 days to an inclusive thirty-day window", () => {
    // 14 Feb through 15 Mar inclusive is exactly 30 days.
    const { from } = resolvePeriod("last_30_days", now);
    expect(new Date(from).getDate()).toBe(14);
    expect(new Date(from).getMonth()).toBe(1); // February
  });

  it("resolves this month from the first", () => {
    const { from } = resolvePeriod("this_month", now);
    expect(new Date(from).getDate()).toBe(1);
    expect(new Date(from).getMonth()).toBe(2);
  });

  it("resolves previous month as the full calendar month before", () => {
    const { from, to } = resolvePeriod("previous_month", now);
    const start = new Date(from);
    const end = new Date(to);
    expect(start.getMonth()).toBe(1);
    expect(start.getDate()).toBe(1);
    expect(end.getMonth()).toBe(1);
    // February 2026 ends on the 28th.
    expect(end.getDate()).toBe(28);
  });
});

describe("daysUntil", () => {
  const now = new Date(2026, 2, 15, 14, 30, 0);

  it("counts whole calendar days, ignoring the time of day", () => {
    // A due date later today is 0 days, not a fraction of a day.
    expect(daysUntil(new Date(2026, 2, 15, 23, 59, 0), now)).toBe(0);
    expect(daysUntil(new Date(2026, 2, 18, 0, 0, 1), now)).toBe(3);
  });

  it("is negative once a date has passed", () => {
    expect(daysUntil(new Date(2026, 2, 12), now)).toBe(-3);
  });

  it("returns null for an unparseable date instead of guessing", () => {
    expect(daysUntil(null, now)).toBeNull();
    expect(daysUntil("nonsense", now)).toBeNull();
  });
});

describe("formatRelativeTime", () => {
  const now = new Date(2026, 2, 15, 12, 0, 0);

  it("describes recent instants in merchant terms", () => {
    expect(formatRelativeTime(new Date(now.getTime() - 5_000), now)).toBe("just now");
    expect(formatRelativeTime(new Date(now.getTime() - 120_000), now)).toContain("2");
  });

  it("handles a future instant without pretending it is past", () => {
    const future = formatRelativeTime(new Date(now.getTime() + 3_600_000), now);
    expect(future).toContain("in");
  });

  it("says so when there is no timestamp", () => {
    expect(formatRelativeTime(null, now)).toBe("Never");
  });
});

describe("formatDate", () => {
  it("renders an unambiguous merchant date", () => {
    expect(formatDateLong(new Date(2026, 2, 1))).toBe("01 Mar 2026");
  });

  it("renders a missing date as unknown rather than as today", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("nonsense")).toBe("—");
  });
});