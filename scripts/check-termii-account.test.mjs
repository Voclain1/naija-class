import test from "node:test";
import assert from "node:assert/strict";

import { checkTermiiAccount } from "./check-termii-account.mjs";

const config = "TERMII_API_KEY=private-fixture\nTERMII_BASE_URL=https://api.example.test";
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("reports redacted capacity and the SchoolKit sender state", async () => {
  const seen = [];
  const result = await checkTermiiAccount(config, async (url) => {
    seen.push(url.toString());
    return url.pathname.endsWith("get-balance")
      ? response({ application: "private", balance: 123.45, currency: "NGN" })
      : response({ content: [{ sender_id: "SchoolKit", status: "pending" }] });
  });
  assert.equal(result.ok, true);
  assert.match(result.lines.join("\n"), /positive capacity/);
  assert.match(result.lines.join("\n"), /pending/);
  assert.doesNotMatch(result.lines.join("\n"), /123|private-fixture|application/);
  assert.equal(seen.every((url) => url.includes("api_key=private-fixture")), true);
});

test("fails closed for missing configuration, provider failure, or zero capacity", async () => {
  assert.equal((await checkTermiiAccount("", async () => response({}))).ok, false);
  assert.equal((await checkTermiiAccount("TERMII_API_KEY=x\nTERMII_BASE_URL=http://example.test", async () => response({}))).ok, false);
  assert.equal((await checkTermiiAccount(config, async () => response({}, 401))).ok, false);
  const zero = await checkTermiiAccount(config, async (url) => url.pathname.endsWith("get-balance")
    ? response({ balance: 0, currency: "NGN" }) : response({ content: [] }));
  assert.equal(zero.ok, false);
});
