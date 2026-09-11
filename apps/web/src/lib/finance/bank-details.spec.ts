import { describe, expect, it } from "vitest";

import { bankAccountNumberSchema, resolveSchoolBankDetails } from "@school-kit/types";

// The visibility rule, proved once. Three surfaces depend on this answer —
// the finance dashboard, the settings preview, and the WhatsApp share message
// — and the way three independent `if (enabled && ...)` checks would
// eventually disagree is by one of them showing an INCOMPLETE account.
//
// Specced from apps/web because packages/types has no test runner; its "test"
// script is a placeholder echo.

const COMPLETE = {
  bankName: "Zenith Bank",
  bankAccountName: "Demo Academy",
  bankAccountNumber: "1234567890",
  bankDetailsEnabled: true,
};

describe("resolveSchoolBankDetails", () => {
  it("returns the details when enabled and complete", () => {
    expect(resolveSchoolBankDetails(COMPLETE)).toEqual({
      bankName: "Zenith Bank",
      bankAccountName: "Demo Academy",
      bankAccountNumber: "1234567890",
    });
  });

  it("returns null when the toggle is off, even with every field filled", () => {
    // The toggle is the safety property: filling the form is not consent to
    // show it to parents.
    expect(resolveSchoolBankDetails({ ...COMPLETE, bankDetailsEnabled: false })).toBeNull();
  });

  it("returns null when enabled but a field is missing", () => {
    // A school that enables it and later blanks one field must not render a
    // partial "pay to:" block — an account number with no bank, or a bank
    // with no number, is worse than showing nothing.
    for (const key of ["bankName", "bankAccountName", "bankAccountNumber"] as const) {
      expect(resolveSchoolBankDetails({ ...COMPLETE, [key]: null }), `${key} null`).toBeNull();
      expect(resolveSchoolBankDetails({ ...COMPLETE, [key]: "   " }), `${key} blank`).toBeNull();
    }
  });

  it("returns null for a missing school rather than throwing", () => {
    expect(resolveSchoolBankDetails(null)).toBeNull();
    expect(resolveSchoolBankDetails(undefined)).toBeNull();
  });

  it("trims what it returns, so no surface renders padded values", () => {
    const padded = resolveSchoolBankDetails({ ...COMPLETE, bankName: "  Zenith Bank  " });
    expect(padded?.bankName).toBe("Zenith Bank");
  });
});

describe("bankAccountNumberSchema (NUBAN)", () => {
  it("accepts exactly ten digits", () => {
    expect(bankAccountNumberSchema.safeParse("0123456789").success).toBe(true);
  });

  it("rejects nine and eleven digits", () => {
    // A typo'd account number is a transfer to a stranger, and nothing
    // downstream can detect that for the parent.
    expect(bankAccountNumberSchema.safeParse("012345678").success).toBe(false);
    expect(bankAccountNumberSchema.safeParse("01234567890").success).toBe(false);
  });

  it("rejects non-digits, including spaced and hyphenated forms", () => {
    for (const bad of ["12345 6789", "123-456-789", "abcdefghij", "123456789x"]) {
      expect(bankAccountNumberSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("trims surrounding whitespace before validating", () => {
    expect(bankAccountNumberSchema.safeParse(" 0123456789 ").success).toBe(true);
  });
});
