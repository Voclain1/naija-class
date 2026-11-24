import { describe, expect, it } from "vitest";

import { countSmsSegments, quoteMessagingKobo } from "./messaging-pricing";

describe("messaging cost estimates", () => {
  it("counts GSM basic, extended and Unicode payloads", () => {
    expect(countSmsSegments("")).toBe(0);
    expect(countSmsSegments("a".repeat(160))).toBe(1);
    expect(countSmsSegments("a".repeat(161))).toBe(2);
    expect(countSmsSegments("^".repeat(152))).toBe(2);
    expect(countSmsSegments("^".repeat(153))).toBe(3);
    expect(countSmsSegments("₦".repeat(70))).toBe(1);
    expect(countSmsSegments("🙂".repeat(36))).toBe(2);
  });

  it("quotes a fractional FX conversion with margin and tax in integer kobo", () => {
    const price = { providerAmount: 7n, rateNumerator: 3n, rateDenominator: 2n, taxBasisPoints: 750n, marginBasisPoints: 1000n };
    expect(quoteMessagingKobo(price, 2)).toBe(25n);
    expect(() => quoteMessagingKobo(price, 0)).toThrow(RangeError);
    expect(() => quoteMessagingKobo({ ...price, rateDenominator: 0n }, 2)).toThrow(RangeError);
  });
});
