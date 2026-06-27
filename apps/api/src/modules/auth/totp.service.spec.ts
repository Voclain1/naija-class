import { generateSync } from "otplib";
import { describe, expect, it } from "vitest";

import { TotpService } from "./totp.service";

// Pure unit tests — no DB, no DI container. TotpService is stateless.
describe("TotpService", () => {
  const svc = new TotpService();

  describe("generateSecret", () => {
    it("returns a base32 string", () => {
      const secret = svc.generateSecret();
      expect(typeof secret).toBe("string");
      expect(secret.length).toBeGreaterThan(0);
      // base32 alphabet: A-Z 2-7
      expect(/^[A-Z2-7]+$/.test(secret)).toBe(true);
    });

    it("generates different secrets on each call", () => {
      expect(svc.generateSecret()).not.toBe(svc.generateSecret());
    });
  });

  describe("getOtpAuthUrl", () => {
    it("returns a valid otpauth:// URL", () => {
      const secret = svc.generateSecret();
      const url = svc.getOtpAuthUrl(secret, "owner@example.com");
      expect(url).toMatch(/^otpauth:\/\/totp\//);
      expect(url).toContain("School%20Kit");
    });
  });

  describe("verifyCode", () => {
    it("returns true for a valid code", () => {
      const secret = svc.generateSecret();
      const code = generateSync({ secret });
      expect(svc.verifyCode(secret, code)).toBe(true);
    });

    it("returns false for an incorrect code", () => {
      const secret = svc.generateSecret();
      expect(svc.verifyCode(secret, "000000")).toBe(false);
    });

    it("returns false for a code from a different secret", () => {
      const secretA = svc.generateSecret();
      const secretB = svc.generateSecret();
      const codeForB = generateSync({ secret: secretB });
      expect(svc.verifyCode(secretA, codeForB)).toBe(false);
    });

    it("returns false for a malformed code rather than throwing", () => {
      const secret = svc.generateSecret();
      expect(svc.verifyCode(secret, "not-a-code")).toBe(false);
    });
  });
});
