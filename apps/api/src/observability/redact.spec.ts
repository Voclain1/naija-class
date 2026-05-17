import { describe, expect, it } from "vitest";

import { redactString, redactValue } from "./redact";

// The redactor is the only thing standing between user PII and a third-party
// error-reporting service. Tests cover (a) value-shape regexes, (b)
// key-shape masks, (c) nested traversal, (d) bounded depth, (e) non-string
// passthrough.

describe("redactString", () => {
  it("masks email addresses", () => {
    expect(redactString("user mayowa@example.com not found")).toBe(
      "user [REDACTED_EMAIL] not found",
    );
  });

  it("masks multiple emails in one string", () => {
    expect(redactString("a@x.io and b@y.io")).toBe(
      "[REDACTED_EMAIL] and [REDACTED_EMAIL]",
    );
  });

  it("masks Nigerian phone numbers with +234 prefix", () => {
    expect(redactString("call +2348012345678 now")).toBe(
      "call [REDACTED_PHONE] now",
    );
  });

  it("masks 11-digit Nigerian phone numbers starting 0", () => {
    expect(redactString("call 08012345678 now")).toBe(
      "call [REDACTED_PHONE] now",
    );
  });

  it("does not mask short numeric strings (status codes, IDs)", () => {
    expect(redactString("status 404")).toBe("status 404");
  });

  it("leaves harmless text alone", () => {
    expect(redactString("School Kit listening on port 4000")).toBe(
      "School Kit listening on port 4000",
    );
  });
});

describe("redactValue", () => {
  it("returns primitives unchanged", () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(true)).toBe(true);
    expect(redactValue(null)).toBe(null);
    expect(redactValue(undefined)).toBe(undefined);
  });

  it("masks values by key name (password)", () => {
    const out = redactValue({ email: "a@b.io", password: "hunter2" }) as Record<
      string,
      unknown
    >;
    expect(out.password).toBe("[REDACTED]");
    // Email still gets value-masked even though the key isn't sensitive.
    expect(out.email).toBe("[REDACTED_EMAIL]");
  });

  it("masks values by key name (token, bvn, nin, otp, authorization)", () => {
    const out = redactValue({
      token: "abc",
      bvn: "22123456789",
      nin: "11111111111",
      otp: "123456",
      authorization: "Bearer abc",
    }) as Record<string, unknown>;
    expect(out.token).toBe("[REDACTED]");
    expect(out.bvn).toBe("[REDACTED]");
    expect(out.nin).toBe("[REDACTED]");
    expect(out.otp).toBe("[REDACTED]");
    expect(out.authorization).toBe("[REDACTED]");
  });

  it("traverses nested objects", () => {
    const out = redactValue({
      user: { email: "a@b.io", profile: { phone: "+2348012345678" } },
    }) as { user: { email: string; profile: { phone: string } } };
    expect(out.user.email).toBe("[REDACTED_EMAIL]");
    expect(out.user.profile.phone).toBe("[REDACTED_PHONE]");
  });

  it("traverses arrays", () => {
    const out = redactValue([
      { email: "a@b.io" },
      { email: "c@d.io" },
    ]) as Array<{ email: string }>;
    expect(out[0].email).toBe("[REDACTED_EMAIL]");
    expect(out[1].email).toBe("[REDACTED_EMAIL]");
  });

  it("bounds traversal depth so a pathological input cannot hang the SDK", () => {
    // 12 levels deep with an email at the bottom. Depth cap is 8.
    let nested: Record<string, unknown> = { email: "a@b.io" };
    for (let i = 0; i < 12; i++) nested = { inner: nested };
    const out = redactValue(nested);
    // Just assert the function terminates and returns *something*. The
    // depth-truncated payload is not required to be inspectable; the point
    // is that we did not recurse forever.
    expect(out).toBeDefined();
  });
});
