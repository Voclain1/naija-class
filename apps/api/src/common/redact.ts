// PII redaction helpers for log lines and audit metadata.
//
// Rule (CLAUDE.md → Hard rules → Multi-tenancy): full email, phone, BVN, NIN
// must not appear in production logs. Audit metadata persists, so even more
// reason to redact at write-time rather than display-time.

export function redactEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@", 2);
  if (!domain) return "***";
  const shown = local.length <= 2 ? local : local.slice(0, 2);
  return `${shown}***@${domain}`;
}

export function redactPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  // Show country code prefix + last 2 digits.
  if (phone.length <= 4) return "***";
  return `${phone.slice(0, phone.startsWith("+") ? 4 : 3)}***${phone.slice(-2)}`;
}
