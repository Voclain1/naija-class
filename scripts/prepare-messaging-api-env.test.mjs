import test from "node:test";
import assert from "node:assert/strict";
import { prepareMessagingApiEnv, requiredMessagingValues } from "./prepare-messaging-api-env.mjs";

test("overlays exact messaging values and preserves every unrelated line", () => {
  const source = [
    "# production settings",
    "PAYSTACK_WEBHOOK_MODE=test",
    "UNRELATED_SECRET=do-not-change",
    "MESSAGING_PAID_ENABLED=on",
    "",
  ].join("\n");
  const result = prepareMessagingApiEnv(source);
  assert.match(result, /# production settings\n/);
  assert.match(result, /UNRELATED_SECRET=do-not-change\n/);
  for (const [key, value] of Object.entries(requiredMessagingValues)) {
    assert.equal(result.split("\n").filter((line) => line === `${key}=${value}`).length, 1);
  }
});

test("rejects empty input and duplicate target keys", () => {
  assert.throws(() => prepareMessagingApiEnv(""), /empty/);
  assert.throws(() => prepareMessagingApiEnv("PAYSTACK_WEBHOOK_MODE=test\nPAYSTACK_WEBHOOK_MODE=live"), /duplicate/);
});
