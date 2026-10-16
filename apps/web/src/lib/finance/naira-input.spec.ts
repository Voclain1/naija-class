import { describe, expect, it } from "vitest";

import { nairaInputToKobo } from "./naira-input";

describe("nairaInputToKobo", () => {
  it("reads whole naira, commas, the naira sign and up to two decimals", () => {
    expect(nairaInputToKobo("5000")).toBe(500_000);
    expect(nairaInputToKobo("₦5,000")).toBe(500_000);
    expect(nairaInputToKobo(" 1,200.5 ")).toBe(120_050);
    expect(nairaInputToKobo("0.07")).toBe(7);
    expect(nairaInputToKobo("19.99")).toBe(1_999);
  });

  it("refuses nothing, zero, negatives, three decimals and words", () => {
    for (const bad of ["", "0", "0.00", "-5", "1.234", "five", "1e3", "."]) {
      expect(nairaInputToKobo(bad)).toBeNull();
    }
  });
});
