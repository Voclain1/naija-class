import { describe, expect, it } from "vitest";

import { normalizeNigerianPhone, TermiiService } from "./termii.service.js";

// normalizeNigerianPhone — pure, no network. Guardian.phone has zero format
// validation (packages/types/src/guardians/create-guardian.dto.ts), so this
// function is the only thing standing between whatever an admin typed and
// Termii's required international-no-plus format.
describe("normalizeNigerianPhone", () => {
  it("converts local format (0801...) to international (234801...)", () => {
    expect(normalizeNigerianPhone("08012345678")).toBe("2348012345678");
  });

  it("passes through already-international format with no leading +", () => {
    expect(normalizeNigerianPhone("2348012345678")).toBe("2348012345678");
  });

  it("strips a leading + from international format", () => {
    expect(normalizeNigerianPhone("+2348012345678")).toBe("2348012345678");
  });

  it("strips formatting characters (spaces, dashes)", () => {
    expect(normalizeNigerianPhone("+234 801 234 5678")).toBe("2348012345678");
    expect(normalizeNigerianPhone("0801-234-5678")).toBe("2348012345678");
  });

  it("treats a bare 10-digit number (no leading 0) as local-minus-zero", () => {
    expect(normalizeNigerianPhone("8012345678")).toBe("2348012345678");
  });

  it("returns null for an unrecognized length", () => {
    expect(normalizeNigerianPhone("12345")).toBeNull();
  });

  it("returns null for a malformed value containing letters", () => {
    // e.g. a test-fixture phone like "+23480f1000000" (see
    // guardians.service.spec.ts's guardianFields()) — digits-only
    // extraction leaves an invalid length/shape, not a garbage send.
    expect(normalizeNigerianPhone("+23480f1000000")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(normalizeNigerianPhone("")).toBeNull();
  });
});

// Constructor behavior — mirrors PaystackService.spec.ts's "no key" test:
// the service must not throw at construction time when TERMII_API_KEY is
// absent (the app still boots), only when sendSms is actually called.
describe("TermiiService", () => {
  function makeService(apiKey?: string): TermiiService {
    const config = { get: (key: string) => (key === "TERMII_API_KEY" ? apiKey : undefined) } as never;
    return new TermiiService(config);
  }

  it("does not throw at construction when TERMII_API_KEY is absent", () => {
    expect(() => makeService(undefined)).not.toThrow();
  });

  it("sendSms throws when TERMII_API_KEY is absent", async () => {
    await expect(makeService(undefined).sendSms("2348012345678", "hi")).rejects.toThrow();
  });

  it("sendSms throws when TERMII_API_KEY is the unfilled .env.example placeholder", async () => {
    await expect(makeService("replace-me").sendSms("2348012345678", "hi")).rejects.toThrow();
  });
});
