import { createHmac } from "node:crypto";

import type { ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";

import { readPaystackSigningKeys, verifyModernPaystackSignature } from "./paystack-signature.js";
import { PaystackWebhookGuard } from "./paystack-webhook.guard.js";
import { PaystackService } from "./paystack.service.js";

const body = Buffer.from('{"event":"charge.success", "data":{"amount":500}}');
const old = "whsec_fictionalold";
const current = "whsec_fictionalcurrent";
const now = 1_760_270_400;
const sign = (secret: string, timestamp: number) => createHmac("sha512", secret)
  .update(`${timestamp}.`).update(body).digest("hex");
const keys = readPaystackSigningKeys(JSON.stringify({ whk_current: current, whk_old: old }));

describe("Paystack signed webhook authentication", () => {
  it("checks exact bytes, selected key IDs and each signature during rotation", () => {
    const line = `t=${now},v1=whk_current:${"0".repeat(128)},v1=whk_old:${sign(old, now)}`;
    expect(verifyModernPaystackSignature(body, line, keys, now)).toBe(true);
    expect(verifyModernPaystackSignature(Buffer.from(JSON.stringify(JSON.parse(body.toString()))), line, keys, now)).toBe(false);
    expect(verifyModernPaystackSignature(body, `t=${now},v1=whk_current:${sign(old, now)}`, keys, now)).toBe(false);
  });

  it("rejects ambiguous and stale timestamps and the wrong clock direction", () => {
    for (const seconds of [-301, 301]) {
      const t = now + seconds;
      expect(verifyModernPaystackSignature(body, `t=${t},v1=whk_old:${sign(old, t)}`, keys, now)).toBe(false);
    }
    expect(verifyModernPaystackSignature(body, `t=${now},t=${now},v1=whk_old:${sign(old, now)}`, keys, now)).toBe(false);
  });

  it("permits legacy during migration but never downgrades a malformed modern signature", () => {
    const key = "sk_test_fictional";
    const header = createHmac("sha512", key).update(body).digest("hex");
    const ctx = (modern?: string) => ({
      switchToHttp: () => ({ getRequest: () => ({
        rawBody: body, headers: { "x-paystack-signature": header, "paystack-signature": modern },
      }) }),
    }) as ExecutionContext;
    const config = new ConfigService({ PAYSTACK_SECRET_KEY: key, PAYSTACK_WEBHOOK_MODE: "test" });
    const guard = new PaystackWebhookGuard(new PaystackService(config), config);
    expect(guard.canActivate(ctx())).toBe(true);
    expect(() => guard.canActivate(ctx("bad"))).toThrow();
    config.set("PAYSTACK_WEBHOOK_REQUIRE_MODERN", "on");
    expect(() => guard.canActivate(ctx())).toThrow();
  });
});
