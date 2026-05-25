// PII redaction for Sentry error reports.
//
// CLAUDE.md "never log full user PII in production" applies to error reports
// too. Sentry's default capture would include exception messages, request
// bodies, request headers, and arbitrary `extra` context — any of which can
// carry the user's email, phone, password, OTP, BVN, or NIN. This module
// walks the event tree and masks those values before the SDK ships them.
//
// We mask, not delete: keeping `email=[REDACTED_EMAIL]` is more debuggable
// than dropping the field entirely. Two redaction shapes:
//   - VALUE redaction: regex match on the value itself (emails, phone numbers)
//   - KEY redaction: case-insensitive key name match (password, token, bvn,
//     nin, otp, authorization, cookie, secret) — value masked regardless of
//     what's in it.

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Nigerian phone formats: +234 followed by 10 digits, or 0[7-9] followed by
// 9 digits. Conservative; will also match an international format like
// +44... which is fine — we'd rather over-redact than leak.
const PHONE_RE = /(\+?\d{1,3}[-.\s]?)?\(?\d{3,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;

// Sensitive key names. Case-insensitive (flag `i`) and underscore-tolerant
// (`[_]?`) so both camelCase (`firstName`, `dateOfBirth`) and snake_case
// (`first_name`, `date_of_birth`) match the same pattern. Adding a key here
// masks the VALUE at that key, never the key name itself — see redactValue.
//
// Phase 0: password / token / secret / api-key / bvn / nin / otp /
//          authorization / cookie  — credential + identifier surface.
// Phase 1 slice 4: Student durable PII. dateOfBirth + medicalNotes are
// NDPR-sensitive (children's data; medicalNotes is special-category
// health data). first/middle/last name + address get masked too because
// together with DOB they are uniquely identifying — see the slice-4
// PII-redaction acceptance criterion in docs/journal/2026-05-24.
// bloodGroup is health-adjacent. email + phone are already covered by
// the value regexes above; they're caught regardless of the key name.
// Phase 1 slice 5: Guardian adds two new workplace identifiers —
// `occupation` (e.g. "Banker at GTBank") and `employer` (e.g. "GTBank").
// Both can identify an adult uniquely when combined with name + city, so
// they go behind the redactor too. Guardian's first/last/phone/email/
// address are already covered by the slice-4 entries.
const SENSITIVE_KEY_RE =
  /password|passwd|token|secret|api[_-]?key|bvn|nin|otp|authorization|cookie|set-cookie|date[_]?of[_]?birth|\bdob\b|first[_]?name|middle[_]?name|last[_]?name|^address$|medical[_]?notes|blood[_]?group|occupation|employer/i;

// Maximum depth for object traversal. Sentry events nest a few levels deep
// (event.contexts.runtime.foo); 8 is comfortably more than we'd ever produce
// and short-circuits cycles or pathological inputs.
const MAX_DEPTH = 8;

export function redactString(input: string): string {
  return input
    .replace(EMAIL_RE, "[REDACTED_EMAIL]")
    .replace(PHONE_RE, (match) => {
      // Heuristic to avoid masking innocent integers like UUIDs-with-dashes
      // or status codes. Real phones have at least 10 digits; require that.
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
