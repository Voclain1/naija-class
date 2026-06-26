import { describe, expect, it } from "vitest";
import { acceptInvitationSchema, signupOwnerSchema } from "@school-kit/types";

// Shared valid base for signup — all fields except password.
const signupBase = {
  schoolName: "Test School",
  schoolSlug: "test-school",
  ownerFirstName: "Ada",
  ownerLastName: "Lovelace",
  ownerEmail: "ada@example.com",
  ownerPhone: "08012345678",
  ndprConsent: true as const,
};

// Shared valid base for invitation accept.
const acceptBase = {
  firstName: "Ada",
  lastName: "Lovelace",
  ndprConsent: true as const,
};

// Phase 3 Slice 2 password policy: uppercase + lowercase + digit + special char,
// 8–128 chars. Applies identically to signupOwnerSchema and acceptInvitationSchema.
// Login schema is intentionally excluded (stays lenient — no 400 vs 401 probing).

const PASSWORD_CASES = [
  { desc: "accepts a compliant password", pw: "Abcdef1!", valid: true },
  { desc: "accepts a password with multiple specials", pw: "Aa1!@#$%", valid: true },
  { desc: "rejects password shorter than 8 chars", pw: "Aa1!", valid: false },
  {
    desc: "rejects password without uppercase letter",
    pw: "abcdef1!",
    valid: false,
    errorMatch: "uppercase",
  },
  {
    desc: "rejects password without lowercase letter",
    pw: "ABCDEF1!",
    valid: false,
    errorMatch: "lowercase",
  },
  {
    desc: "rejects password without a digit",
    pw: "Abcdefg!",
    valid: false,
    errorMatch: "digit",
  },
  {
    desc: "rejects password without a special character",
    pw: "Abcdef12",
    valid: false,
    errorMatch: "special",
  },
  { desc: "accepts a 128-char max-length password", pw: "Aa1!" + "x".repeat(124), valid: true },
  { desc: "rejects a 129-char over-length password", pw: "Aa1!" + "x".repeat(125), valid: false },
];

describe("signupOwnerSchema — password policy (Phase 3 Slice 2)", () => {
  for (const { desc, pw, valid, errorMatch } of PASSWORD_CASES) {
    it(desc, () => {
      const r = signupOwnerSchema.safeParse({ ...signupBase, password: pw });
      expect(r.success).toBe(valid);
      if (!valid && errorMatch) {
        expect(JSON.stringify((r as { error: unknown }).error)).toContain(errorMatch);
      }
    });
  }
});

describe("acceptInvitationSchema — password policy (Phase 3 Slice 2)", () => {
  for (const { desc, pw, valid, errorMatch } of PASSWORD_CASES) {
    it(desc, () => {
      const r = acceptInvitationSchema.safeParse({ ...acceptBase, password: pw });
      expect(r.success).toBe(valid);
      if (!valid && errorMatch) {
        expect(JSON.stringify((r as { error: unknown }).error)).toContain(errorMatch);
      }
    });
  }
});
