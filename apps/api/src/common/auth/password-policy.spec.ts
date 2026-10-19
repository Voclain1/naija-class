import { describe, expect, it } from "vitest";

import { meetsPasswordPolicy, resetPasswordSchema } from "@school-kit/types";

// Sign-in's check of a password someone already has must be exactly the rule
// they would be held to when choosing one, or it would ask some people to
// change a password the reset form then accepts unchanged (or the reverse).
describe("meetsPasswordPolicy", () => {
  const cases = [
    "oldpass123", // Phase 0: a letter and a digit
    "Oldpass123", // no symbol
    "OLDPASS12!", // no lower case
    "oldpass12!", // no upper case
    "Oldpass!!!", // no digit
    "Ab1!", // too short
    "Correct-Horse-9",
    "Abcdef1!",
    "A".repeat(126) + "b1!", // 129: too long
  ];

  it.each(cases)("agrees with the reset form about %s", (pw) => {
    expect(meetsPasswordPolicy(pw)).toBe(resetPasswordSchema.safeParse({ token: "t", password: pw }).success);
  });
});
