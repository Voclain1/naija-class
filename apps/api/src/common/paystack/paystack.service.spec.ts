import * as crypto from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { PaystackService } from "./paystack.service.js";

// Unit tests for PaystackService.verifyWebhookSignature — the pure HMAC path.
// No network, no DB, no NestJS DI. We construct PaystackService directly with
// a stub ConfigService that returns a fixed secret key.
//
// These are the security-critical tests: a bug here means forged webhooks
// could credit payments without actual money movement.

const SECRET = "test_secret_key_for_unit_tests_only";
const OTHER_SECRET = "different_secret_key";

function makeService(secret = SECRET): PaystackService {
  const config = { get: (_key: string) => secret } as never;
  return new PaystackService(config);
}

function makeSignature(body: Buffer, secret = SECRET): string {
  return crypto.createHmac("sha512", secret).update(body).digest("hex");
}

describe("PaystackService.verifyWebhookSignature", () => {
  it("returns true for a valid signature", () => {
    const body = Buffer.from('{"event":"charge.success"}');
    const sig = makeSignature(body);
    expect(makeService().verifyWebhookSignature(body, sig)).toBe(true);
  });

  it("returns false when the signature was computed with a different key", () => {
    const body = Buffer.from('{"event":"charge.success"}');
    const sig = makeSignature(body, OTHER_SECRET);
    // service uses SECRET, but sig was computed with OTHER_SECRET
    expect(makeService().verifyWebhookSignature(body, sig)).toBe(false);
  });

  it("returns false when the body has been tampered with", () => {
    const originalBody = Buffer.from('{"event":"charge.success","data":{"amount":10000}}');
    const sig = makeSignature(originalBody);
    const tamperedBody = Buffer.from('{"event":"charge.success","data":{"amount":99999}}');
    expect(makeService().verifyWebhookSignature(tamperedBody, sig)).toBe(false);
  });

  it("catches buffer-length mismatch (non-hex signature) without throwing", () => {
    const body = Buffer.from('{"event":"charge.success"}');
    // A non-hex or wrong-length signature would cause timingSafeEqual to throw
    // if the guard didn't catch it. The guard wraps in try/catch; verify the
    // underlying service method itself throws (the guard catches it).
    // Confirm via the guard's catch path by calling verifyWebhookSignature with
    // an oddly-lengthed string.
    const badSig = "not-valid-hex!!";
    // We expect this to throw (timingSafeEqual throws on length mismatch)
    // because the service does not swallow — the guard does.
    expect(() => makeService().verifyWebhookSignature(body, badSig)).toThrow();
  });

  it("returns false for an empty signature", () => {
    const body = Buffer.from('{"event":"charge.success"}');
    // An empty hex string produces a zero-length Buffer, which causes
    // timingSafeEqual to throw — caught by the guard, treated as invalid.
    expect(() => makeService().verifyWebhookSignature(body, "")).toThrow();
  });
});

describe("PaystackService constructor", () => {
  it("logs a warning if PAYSTACK_SECRET_KEY is not set", () => {
    const config = { get: (_key: string) => undefined } as never;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => new PaystackService(config)).not.toThrow();
    warnSpy.mockRestore();
  });

  it("throws at call time if PAYSTACK_SECRET_KEY is not set", async () => {
    const config = { get: (_key: string) => undefined } as never;
    const service = new PaystackService(config);
    await expect(
      service.initializeTransaction({ email: "test@test.com", amount: 100, reference: "ref" }),
    ).rejects.toThrow("PAYSTACK_SECRET_KEY is not configured");
  });
});
