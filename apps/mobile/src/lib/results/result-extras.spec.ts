import { describe, expect, it } from "vitest";

import { attendanceLine, cumulativeLine, ordinal, positionLabel, promotionLabel } from "./result-extras";

describe("result extras (Phase 8 / CP6a)", () => {
  it("ordinals, including the teens", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 111].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "111th",
    ]);
  });

  it("attendance reads as present out of days opened, and is absent when never marked", () => {
    expect(attendanceLine({ attendance: { daysOpened: 60, present: 58, absent: 2 } })).toBe(
      "Present 58 of 60 days · absent 2",
    );
    expect(attendanceLine({ attendance: null })).toBeNull();
  });

  it("promotion status in words, and nothing on other terms", () => {
    expect(promotionLabel({ promotionStatus: "PROMOTED_ON_TRIAL" })).toBe("Promoted on trial");
    expect(promotionLabel({ promotionStatus: "REPEAT" })).toBe("To repeat");
    expect(promotionLabel({ promotionStatus: null })).toBeNull();
  });

  it("position only when the school shows it", () => {
    expect(positionLabel(3)).toBe("3rd");
    expect(positionLabel(null)).toBeNull();
  });

  it("a card cached on the phone before these fields existed shows none of them", () => {
    // D32: released cards are persisted to disk, so an older payload arrives
    // without the keys at all.
    const old = {};
    expect(attendanceLine(old)).toBeNull();
    expect(promotionLabel(old)).toBeNull();
    expect(positionLabel(undefined)).toBeNull();
  });

  it("the year so far says how many terms it covers, and adds position only when shown (CP5a)", () => {
    expect(cumulativeLine({ cumulative: { average: 7850, terms: 2, position: 3 } })).toBe(
      "Year average 78.50% over 2 terms · 3rd in class",
    );
    expect(cumulativeLine({ cumulative: { average: 8000, terms: 1, position: null } })).toBe(
      "Year average 80.00% over 1 term",
    );
    expect(cumulativeLine({ cumulative: null })).toBeNull();
    expect(cumulativeLine({})).toBeNull();
  });
});
