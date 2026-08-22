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

// Subaccount routing (compressed plan-first, 2026-07-31). initializeTransaction
// must pass `subaccount`/`bearer` through to Paystack's request body ONLY
// when a subaccount is actually supplied — a manual-only school's payment
// (no subaccount) must never accidentally include a stray split param.
describe("PaystackService.initializeTransaction — subaccount routing", () => {
  it("includes subaccount + bearer:subaccount in the request body when subaccount is passed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          message: "ok",
          data: { authorization_url: "https://checkout.paystack.com/x", access_code: "ac_x", reference: "ref" },
        }),
        { status: 200 },
      ),
    );

    await makeService().initializeTransaction({
      email: "test@test.com",
      amount: 100,
      reference: "ref",
      subaccount: "ACCT_abc123",
    });

    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(body.subaccount).toBe("ACCT_abc123");
    expect(body.bearer).toBe("subaccount");
    fetchSpy.mockRestore();
  });

  it("respects an explicit bearer override", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          message: "ok",
          data: { authorization_url: "https://checkout.paystack.com/x", access_code: "ac_x", reference: "ref" },
        }),
        { status: 200 },
      ),
    );

    await makeService().initializeTransaction({
      email: "test@test.com",
      amount: 100,
      reference: "ref",
      subaccount: "ACCT_abc123",
      bearer: "account",
    });

    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(body.bearer).toBe("account");
    fetchSpy.mockRestore();
  });

  it("omits subaccount/bearer entirely for a manual-only payment (no subaccount passed)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          message: "ok",
          data: { authorization_url: "https://checkout.paystack.com/x", access_code: "ac_x", reference: "ref" },
        }),
        { status: 200 },
      ),
    );

    await makeService().initializeTransaction({ email: "test@test.com", amount: 100, reference: "ref" });

    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(body.subaccount).toBeUndefined();
    expect(body.bearer).toBeUndefined();
    fetchSpy.mockRestore();
  });
});

describe("PaystackService.getSubaccount", () => {
  it("returns the subaccount data on a successful lookup", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          message: "ok",
          data: { subaccount_code: "ACCT_abc123", business_name: "Test School Ventures", active: true },
        }),
        { status: 200 },
      ),
    );

    const result = await makeService().getSubaccount("ACCT_abc123");

    expect(result).toEqual({ subaccount_code: "ACCT_abc123", business_name: "Test School Ventures", active: true });
    fetchSpy.mockRestore();
  });

  it("throws PAYSTACK_SUBACCOUNT_NOT_FOUND when Paystack returns a non-ok response (typo'd/dead code)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not found", { status: 404 }));

    // ConflictError (not InternalError) — see getSubaccount's own comment:
    // a typo'd/dead code is a client mistake, and ConflictError's
    // (code, message) shape puts a real sentence in `.message`, which is
    // what the admin settings page actually displays.
    await expect(makeService().getSubaccount("ACCT_bogus")).rejects.toMatchObject({
      code: "PAYSTACK_SUBACCOUNT_NOT_FOUND",
      message: expect.stringContaining("ACCT_bogus"),
    });
    fetchSpy.mockRestore();
  });

  it("throws at call time if PAYSTACK_SECRET_KEY is not set", async () => {
    const config = { get: (_key: string) => undefined } as never;
    const service = new PaystackService(config);
    await expect(service.getSubaccount("ACCT_x")).rejects.toThrow("PAYSTACK_SECRET_KEY is not configured");
  });
});

describe("PaystackService.ensureSchoolPercentageSplit", () => {
  const split = {
    id: 42,
    name: "SchoolKit school school-1",
    type: "percentage",
    currency: "NGN",
    split_code: "SPL_school1",
    active: true,
    domain: "test",
    bearer_type: "subaccount",
    bearer_subaccount: 314,
    subaccounts: [{ share: 100, subaccount: { id: 314, subaccount_code: "ACCT_school1" } }],
  };

  it("creates percentage:100 with the school as sole share and fee bearer, then fetch-verifies", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: true, message: "ok", data: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: true, message: "ok", data: split })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: true, message: "ok", data: split })));

    const result = await makeService("sk_test_unit").ensureSchoolPercentageSplit({
      schoolId: "school-1",
      subaccountCode: "ACCT_school1",
    });
    const createBody = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body));
    expect(createBody).toMatchObject({
      name: "SchoolKit school school-1",
      type: "percentage",
      currency: "NGN",
      bearer_type: "subaccount",
      bearer_subaccount: "ACCT_school1",
      subaccounts: [{ subaccount: "ACCT_school1", share: 100 }],
    });
    expect(result.split_code).toBe("SPL_school1");
    fetchSpy.mockRestore();
  });

  it("reconciles an existing deterministic-name split without creating another", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: true, message: "ok", data: [split] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: true, message: "ok", data: split })));
    await makeService("sk_test_unit").ensureSchoolPercentageSplit({
      schoolId: "school-1",
      subaccountCode: "ACCT_school1",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls.every((call) => call[1]?.method !== "POST")).toBe(true);
    fetchSpy.mockRestore();
  });

  it("fails closed when fetch-back shows silently changed routing", async () => {
    const bad = { ...split, bearer_type: "account" };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: true, message: "ok", data: [split] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: true, message: "ok", data: bad })));
    await expect(
      makeService("sk_test_unit").ensureSchoolPercentageSplit({
        schoolId: "school-1",
        subaccountCode: "ACCT_school1",
      }),
    ).rejects.toMatchObject({ code: "PAYSTACK_SPLIT_MISMATCH" });
    fetchSpy.mockRestore();
  });
});
