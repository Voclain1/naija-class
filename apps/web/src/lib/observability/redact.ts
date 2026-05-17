// Browser-side PII redactor for Sentry events. Same shape as the API
// equivalent (apps/api/src/observability/redact.ts) — duplicated rather
// than shared because (a) the apps don't share a runtime types module yet,
// (b) the redactor is 60 lines, (c) the rule "extract on the third caller"
// applies. If the mobile app needs one, lift the trio into packages/types.

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(\+?\d{1,3}[-.\s]?)?\(?\d{3,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;
const SENSITIVE_KEY_RE =
  /password|passwd|token|secret|api[_-]?key|bvn|nin|otp|authorization|cookie|set-cookie/i;
const MAX_DEPTH = 8;

export function redactString(input: string): string {
  return input
    .replace(EMAIL_RE, "[REDACTED_EMAIL]")
    .replace(PHONE_RE, (match) => {
      const digits = match.replace(/\D/g, "");
      return digits.length >= 10 ? "[REDACTED_PHONE]" : match;
    });
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[REDACTED_DEPTH]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactValue(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}
