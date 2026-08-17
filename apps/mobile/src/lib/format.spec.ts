import { describe, expect, it } from "vitest";

import { formatHundredths } from "./format";

describe("formatHundredths", () => {
  it("formats whole and fractional percentages", () => {
    expect(formatHundredths(8500)).toBe("85.00%");
    expect(formatHundredths(7350)).toBe("73.50%");
    expect(formatHundredths(10000)).toBe("100.00%");
    expect(formatHundredths(0)).toBe("0.00%");
  });

  it("pads a single-digit remainder", () => {
    // 8505 is 85.05%, not 85.5% — the bug this padding prevents.
    expect(formatHundredths(8505)).toBe("85.05%");
  });

  it("renders an em dash for null rather than 0.00%", () => {
    // "no data" and "you scored nothing" are opposite meanings.
    expect(formatHundredths(null)).toBe("—");
  });

  it("keeps the fraction positive on a negative input", () => {
    // Not expected from the API, but -1 % 100 is -1 in JS, which would
    // otherwise render "-0.-1%".
    expect(formatHundredths(-8500)).toBe("-85.00%");
  });
});
