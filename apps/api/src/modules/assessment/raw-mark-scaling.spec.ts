import { describe, expect, it } from "vitest";

import { findRawMarkError, scaleRawMark } from "@school-kit/types";

// Phase 8c / CP5a — marks out of any total (phase-8.md §22.1, D60).
describe("scaleRawMark — round half up, in integers", () => {
  it("scales into the component's weight", () => {
    expect(scaleRawMark(37, 60, 60)).toBe(37); // same total: unchanged
    expect(scaleRawMark(37, 60, 20)).toBe(12); // 12.33 → 12
    expect(scaleRawMark(45, 50, 60)).toBe(54); // 54.0
    expect(scaleRawMark(0, 80, 20)).toBe(0);
    expect(scaleRawMark(80, 80, 20)).toBe(20); // full marks stay full marks
  });

  it("rounds exactly .5 UP", () => {
    expect(scaleRawMark(15, 40, 20)).toBe(8); // 7.5 → 8
    expect(scaleRawMark(1, 4, 2)).toBe(1); // 0.5 → 1
    expect(scaleRawMark(3, 8, 4)).toBe(2); // 1.5 → 2
  });

  it("never lands a hair under .5 the way floating point can", () => {
    // 29/58 * 15 = 7.5 exactly; a float product can read 7.4999…
    expect(scaleRawMark(29, 58, 15)).toBe(8);
    // Exhaustively: every mark out of every total ≤ 100 into weights ≤ 100
    // matches exact rational round-half-up, and never exceeds the weight.
    for (let outOf = 1; outOf <= 100; outOf += 7) {
      for (let weight = 1; weight <= 100; weight += 9) {
        for (let mark = 0; mark <= outOf; mark++) {
          const scaled = scaleRawMark(mark, outOf, weight);
          const twice = 2 * mark * weight; // compare 2·scaled against the exact value
          expect(scaled * 2 * outOf <= twice + outOf).toBe(true);
          expect((scaled + 1) * 2 * outOf > twice + outOf).toBe(true);
          expect(scaled).toBeLessThanOrEqual(weight);
        }
      }
    }
  });
});

describe("findRawMarkError", () => {
  it("accepts a whole mark within its total", () => {
    expect(findRawMarkError(37, 60)).toBeNull();
    expect(findRawMarkError(0, 1)).toBeNull();
    expect(findRawMarkError(1000, 1000)).toBeNull();
  });

  it("refuses a mark above its total, negative or fractional marks, and a bad total", () => {
    expect(findRawMarkError(61, 60)).toMatch(/more than 60/);
    expect(findRawMarkError(-1, 60)).toMatch(/negative/);
    expect(findRawMarkError(3.5, 60)).toMatch(/whole number/);
    expect(findRawMarkError(1, 0)).toMatch(/from 1 to 1000/);
    expect(findRawMarkError(1, 1001)).toMatch(/from 1 to 1000/);
  });
});
