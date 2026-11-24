import { describe, expect, it } from "vitest";

import { countSmsSegments, quoteDispatchCost, quoteMessagingKobo } from "./messaging-pricing";

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

describe("effective pricing and billing ownership", () => {
  const at = new Date("2026-11-24T10:00:00Z");
  const baseRate = {
    key: "META_UTILITY" as const, version: "fixture-1", evidence: "fictional rate sheet",
    effectiveFrom: new Date("2026-11-01"), effectiveUntil: new Date("2026-12-01"),
    verifiedAt: new Date("2026-11-02"), providerAmount: 18n, rateNumerator: 1n, rateDenominator: 1n,
    taxBasisPoints: 0n, marginBasisPoints: 0n,
  };

  it("requires one verified effective rate and never debits a school-owned Meta send", () => {
    expect(quoteDispatchCost([baseRate], "META_UTILITY", "SCHOOL_OWNED", 1, at))
      .toEqual({ rateVersion: "fixture-1", estimatedKobo: 18n, walletKobo: 0n });
    expect(quoteDispatchCost([baseRate], "META_UTILITY", "SCHOOLKIT", 1, at)).toBeUndefined();
    expect(quoteDispatchCost([baseRate], "META_MARKETING", "SCHOOL_OWNED", 1, at)).toBeUndefined();
    expect(quoteDispatchCost([baseRate], "META_UTILITY", "SCHOOL_OWNED", 1, new Date("2026-12-01"))).toBeUndefined();
    expect(quoteDispatchCost([baseRate, { ...baseRate, version: "fixture-2" }], "META_UTILITY", "SCHOOL_OWNED", 1, at))
      .toBeUndefined();
  });
});
