// Creates the proposed production API environment without evaluating it as
// shell code. Existing unrelated lines, comments and values are retained.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const requiredMessagingValues = Object.freeze({
  PAYSTACK_WEBHOOK_MODE: "live",
  PAYSTACK_WEBHOOK_REQUIRE_MODERN: "off",
  PAYSTACK_WEBHOOK_LEGACY_REVIEW_BY: "2026-12-09",
  MESSAGING_LEGACY_SMS_MIGRATION_MODE: "off",
  MESSAGING_LEGACY_SMS_ENABLED: "off",
  MESSAGING_TERMII_REPORTS_ENABLED: "off",
  MESSAGING_PAID_ENABLED: "off",
});

export function prepareMessagingApiEnv(source) {
  if (typeof source !== "string" || source.length === 0) throw new Error("source environment is empty");
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalNewline = /\r?\n$/.test(source);
  const lines = source.split(/\r?\n/);
  if (hadFinalNewline) lines.pop();
  const seen = new Set();
  const output = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match || !(match[1] in requiredMessagingValues)) return line;
    if (seen.has(match[1])) throw new Error(`duplicate target key: ${match[1]}`);
    seen.add(match[1]);
    return `${match[1]}=${requiredMessagingValues[match[1]]}`;
  });
  for (const [key, value] of Object.entries(requiredMessagingValues)) {
    if (!seen.has(key)) output.push(`${key}=${value}`);
  }
  return output.join(newline) + (hadFinalNewline ? newline : "");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , input, output] = process.argv;
  if (!input || !output) throw new Error("usage: prepare-messaging-api-env INPUT OUTPUT");
  writeFileSync(output, prepareMessagingApiEnv(readFileSync(input, "utf8")), { mode: 0o600 });
}
