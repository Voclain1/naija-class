import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-messaging-cutover.mjs", import.meta.url));
const future = days => new Date(Date.now() + days * 86400000).toISOString().slice(0,10);
const base = { PAYSTACK_WEBHOOK_MODE: "live", PAYSTACK_SECRET_KEY: "sk_live_fictional",
  MESSAGING_LEGACY_SMS_MIGRATION_MODE: "off" };
const legacy = { PAYSTACK_WEBHOOK_REQUIRE_MODERN: "off", PAYSTACK_WEBHOOK_LEGACY_REVIEW_BY: future(14) };
const modern = { PAYSTACK_WEBHOOK_REQUIRE_MODERN: "on", PAYSTACK_WEBHOOK_LIVE_KEYS: '{"whk_fictional":"whsec_fictional"}' };
function run(config) {
  return spawnSync(process.execPath, [script], { encoding: "utf8", env: {
    ...process.env, FLY_DEPLOY_DISABLED: "true", VPS_MODE: "live",
    API_ENV_FILE: Object.entries({...base,...config}).map(([k,v]) => k+"="+v).join("\n")
  }});
}
test("explicit legacy transition does not need invented signing keys", () => {
  const r = run(legacy); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /sk_live_fictional/);
});
test("modern-only still requires a valid live keyring", () => {
  assert.equal(run(modern).status, 0);
  assert.notEqual(run({...modern,PAYSTACK_WEBHOOK_LIVE_KEYS:""}).status, 0);
});
test("implicit auth and wrong live key are blocked", () => {
  assert.notEqual(run({}).status, 0);
  assert.notEqual(run({...legacy,PAYSTACK_SECRET_KEY:"sk_test_fictional"}).status, 0);
});
test("legacy deadline and supplied keyring must be valid", () => {
  for (const date of ["",future(-1),future(60),"2027-02-30"]) {
    assert.notEqual(run({...legacy,PAYSTACK_WEBHOOK_LEGACY_REVIEW_BY:date}).status, 0);
  }
  assert.notEqual(run({...legacy,PAYSTACK_WEBHOOK_LIVE_KEYS:"invalid"}).status, 0);
});
test("SMS and paid messaging gates are independent of authentication", () => {
  assert.notEqual(run({...legacy,MESSAGING_LEGACY_SMS_MIGRATION_MODE:""}).status, 0);
  assert.notEqual(run({...legacy,MESSAGING_PAID_ENABLED:"on"}).status, 0);
});
