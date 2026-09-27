// "Call the school" (docs/modules/the-school-day.md Part D).
//
// D11 refuses general messaging: two-way chat brings adult–child contact into
// a product used by minors, with a safeguarding duty, moderation and retention
// this project cannot carry. Teacher↔student messaging in particular is a
// category to refuse on purpose rather than arrive at.
//
// D12 is what a parent already does — ring the school — with the friction
// removed. One number, the school's own, and no reply path pretending to be
// one.

/**
 * A `tel:` link for the school's number, or null when there is nothing to ring.
 *
 * Null rather than a disabled button: a school that never filled in a phone
 * number should show no button at all. A greyed-out "Call the school" tells a
 * worried parent the feature exists and has been taken away from them.
 *
 * Everything a human types into a phone field — spaces, brackets, dashes — is
 * stripped, because a dialler handed "0803 123 4567" can refuse it. A leading
 * `+` is KEPT: Nigerian numbers are commonly stored as +234…, and dropping it
 * turns an international number into a local one that dials somewhere else.
 */
export function callSchoolHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const international = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  // A handful of digits is a typo, not a number worth dialling. Nigerian local
  // numbers are 11 digits (0803…) and international ones 13 with the country
  // code, so anything under 7 is certainly not callable.
  if (digits.length < 7) return null;
  return `tel:${international ? "+" : ""}${digits}`;
}

/**
 * GET /portal/school and GET /student-portal/me/school — who my school is, and
 * how to ring them.
 *
 * The portal (web) had no such read at all: it knew the child, the invoices and
 * the calendar, but never the school itself, because nothing had needed it. The
 * app gets the same fields from its session; the browser needs to ask.
 *
 * Deliberately two fields and no more. An address, an email and branding are
 * not needed to place a call, and this response lands in a parent's browser.
 */
export interface SchoolContactResponse {
  name: string;
  phone: string | null;
}
