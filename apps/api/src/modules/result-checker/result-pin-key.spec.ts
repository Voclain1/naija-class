import { describe, expect, it } from "vitest";

import { formatPin, hashPin, normalisePin, resolveResultPinKey } from "./result-pin-key";

// D56 — the server secret result PINs are hashed under.
describe("result PIN key", () => {
  it("production refuses to start without RESULT_PIN_HMAC_KEY — loudly, naming the fix", () => {
    expect(() => resolveResultPinKey({ NODE_ENV: "production" })).toThrow(/RESULT_PIN_HMAC_KEY is not set.*flyctl secrets set/s);
    expect(() => resolveResultPinKey({ NODE_ENV: "production", RESULT_PIN_HMAC_KEY: "   " })).toThrow(/not set/);
  });

  it("refuses a short key anywhere, and uses a real one as given", () => {
    expect(() => resolveResultPinKey({ NODE_ENV: "development", RESULT_PIN_HMAC_KEY: "short" })).toThrow(/at least 32/);
    const real = "a".repeat(64);
    expect(resolveResultPinKey({ NODE_ENV: "production", RESULT_PIN_HMAC_KEY: real })).toBe(real);
  });

  it("dev and test fall back to a fixed non-production key", () => {
    expect(resolveResultPinKey({ NODE_ENV: "test" })).toMatch(/not-for-production/);
  });

  it("the hash depends on the key — a leaked database without it reveals nothing", () => {
    expect(hashPin("k".repeat(32), "123456789012")).not.toBe(hashPin("j".repeat(32), "123456789012"));
    expect(hashPin("k".repeat(32), "123456789012")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts a PIN as printed or typed, and nothing that is not 12 digits", () => {
    expect(normalisePin("4821 0937 5512")).toBe("482109375512");
    expect(normalisePin("4821-0937-5512")).toBe("482109375512");
    expect(normalisePin("48210937551")).toBeNull();
    expect(normalisePin("4821 0937 551X")).toBeNull();
    expect(formatPin("012345678901")).toBe("0123 4567 8901");
  });
});
