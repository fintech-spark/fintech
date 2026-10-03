// Merchant Brain: money formatting tests.
//
// Money is the highest-risk thing this UI touches. A frontend that rounds
// wrongly, drops a currency, or shows "₹0.00" for a value it does not have will
// make a merchant mistrust every other number on the screen. These tests pin
// the behaviour that prevents that.

import { describe, expect, it } from "vitest";

import {
  formatCount,
  formatFileSize,
  formatMinorUnits,
  formatMoney,
  formatMoneyCompact,
  formatMoneyDelta,
  formatPercent,
  formatPercentChange,
  formatPointChange,
  formatQuantity,
  toMajorUnits,
} from "@/lib/format/money";
import type { Money } from "@/lib/types";

const inr = (amount: number): Money => ({ amount, currency: "INR" });

describe("toMajorUnits", () => {
  it("divides integer minor units into major units", () => {
    expect(toMajorUnits(100_00, "INR")).toBe(100);
    expect(toMajorUnits(1, "INR")).toBe(0.01);
    expect(toMajorUnits(0, "INR")).toBe(0);
  });

  it("keeps negative amounts intact", () => {
    expect(toMajorUnits(-250, "INR")).toBe(-2.5);
  });
});

describe("formatMoney", () => {
  it("renders minor units as a grouped rupee amount", () => {
    // 100,000 rupees is 10,000,000 paise. The Indian lakh grouping
    // (1,00,000.00) is the convention, not the western 100,000.00.
    expect(formatMoney(inr(10_000_000))).toBe("₹1,00,000.00");
    expect(formatMoney(inr(100_000))).toBe("₹1,000.00");
  });

  it("shows paise rather than rounding them away", () => {
    expect(formatMoney(inr(250))).toBe("₹2.50");
    expect(formatMoney(inr(1))).toBe("₹0.01");
  });

  it("renders an em dash for a missing value rather than zero", () => {
    // A missing amount and a zero amount mean completely different things to a
    // merchant. Collapsing them would be a lie.
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney(inr(0))).toBe("₹0.00");
  });

  it("renders an em dash for a non-finite amount", () => {
    expect(formatMoney(inr(Number.NaN))).toBe("—");
    expect(formatMinorUnits(Number.POSITIVE_INFINITY, "INR")).toBe("—");
  });

  it("honours the currency on the value", () => {
    expect(formatMoney({ amount: 1_000, currency: "USD" })).toBe("$10.00");
  });
});

describe("formatMoneyCompact", () => {
  it("keeps the exact figure reachable next to the compact one", () => {
    const result = formatMoneyCompact(inr(10_000_000));
    expect(result.compact).not.toBe(result.exact);
    expect(result.exact).toBe("₹1,00,000.00");
  });

  it("reports a missing value as explicitly unavailable", () => {
    expect(formatMoneyCompact(null)).toEqual({
      compact: "—",
      exact: "Not available",
    });
  });
});

describe("formatMoneyDelta", () => {
  it("marks an increase and a decrease explicitly", () => {
    expect(formatMoneyDelta(inr(50_000))).toEqual({ text: "+₹500.00", direction: "up" });
    expect(formatMoneyDelta(inr(-50_000))).toEqual({ text: "−₹500.00", direction: "down" });
  });

  it("does not sign a zero change", () => {
    expect(formatMoneyDelta(inr(0))).toEqual({ text: "₹0.00", direction: "flat" });
  });
});

describe("formatPercentChange", () => {
  it("describes a relative change between two given figures", () => {
    expect(formatPercentChange(110, 100)).toEqual({ text: "+10.0%", direction: "up" });
    expect(formatPercentChange(90, 100)).toEqual({ text: "−10.0%", direction: "down" });
    expect(formatPercentChange(100, 100)).toEqual({ text: "0.0%", direction: "flat" });
  });

  it("returns null when there is no meaningful base", () => {
    // Infinity% on screen would be worse than saying nothing.
    expect(formatPercentChange(50, 0)).toBeNull();
    expect(formatPercentChange(Number.NaN, 10)).toBeNull();
  });
});

describe("formatPointChange", () => {
  // The distinction that matters most in this product: a margin moving from
  // 18.4% to 21.1% is +2.7 points, not +15%.
  it("uses percentage points, not percent", () => {
    expect(formatPointChange(21.1, 18.4)).toEqual({
      text: "+2.7 pts",
      direction: "up",
    });
    expect(formatPointChange(18.4, 21.1)).toEqual({
      text: "−2.7 pts",
      direction: "down",
    });
  });

  it("never renders a bare percent for a point change", () => {
    const result = formatPointChange(15, 10);
    expect(result?.text).not.toContain("%");
    expect(result?.text).toContain("pts");
  });
});

describe("formatPercent", () => {
  it("formats an authoritative percentage", () => {
    expect(formatPercent(18.44)).toBe("18.4%");
    expect(formatPercent(18.44, { fractionDigits: 2 })).toBe("18.44%");
  });

  it("renders a missing percentage as unknown", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
  });
});

describe("formatQuantity", () => {
  it("prints whole numbers without a decimal tail", () => {
    expect(formatQuantity(12)).toBe("12");
    expect(formatQuantity(12, "kg")).toBe("12 kg");
  });

  it("keeps up to three fraction digits, matching numeric(20,3)", () => {
    expect(formatQuantity(1.5)).toBe("1.5");
    expect(formatQuantity(1.2345)).toBe("1.235");
  });

  it("renders a missing quantity as unknown", () => {
    expect(formatQuantity(null)).toBe("—");
  });
});

describe("formatCount", () => {
  it("pluralises with the merchant's noun", () => {
    expect(formatCount(1, "product")).toBe("1 product");
    expect(formatCount(3, "product")).toBe("3 products");
    expect(formatCount(0, "product")).toBe("0 products");
  });

  it("groups large counts for readability", () => {
    expect(formatCount(12345, "document")).toBe("12,345 documents");
  });
});

describe("formatFileSize", () => {
  it("scales to a readable unit", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("rounds away decimals once the number is large", () => {
    expect(formatFileSize(20 * 1024)).toBe("20 KB");
  });

  it("renders an unknown size honestly", () => {
    expect(formatFileSize(null)).toBe("—");
    expect(formatFileSize(-1)).toBe("—");
  });
});