import { describe, expect, it } from "vitest";

import { changeWords, percent, scoreBand } from "./analytics-api";

describe("analytics display helpers", () => {
  it("formats hundredths as a percentage", () => {
    expect(percent(9333)).toBe("93.33%");
    expect(percent(10000)).toBe("100.00%");
    expect(percent(5)).toBe("0.05%");
    expect(percent(null)).toBe("—");
  });

  it("says the change in words", () => {
    expect(changeWords(1000)).toBe("up 10.00");
    expect(changeWords(-250)).toBe("down 2.50");
    expect(changeWords(0)).toBe("no change");
    expect(changeWords(null)).toBe("—");
  });

  it("bands a score at the 70 and 50 lines", () => {
    expect(scoreBand(7000)).toBe("high");
    expect(scoreBand(6999)).toBe("middle");
    expect(scoreBand(5000)).toBe("middle");
    expect(scoreBand(4999)).toBe("low");
  });
});
