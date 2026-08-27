// Human identity for an invoice row.
//
// Before this module the invoice list rendered `inv.studentId.slice(0, 8) + "…"`
// — a truncated UUID. A bursar reconciling a term's fees cannot match that to
// a child, a parent on the phone, or a paper receipt. The API now resolves
// `studentName` and `admissionNumber` server-side (batched, one findMany per
// page — see InvoiceGenerationService.resolveStudentIdentities), and this
// module is the single place that decides how those are shown.
//
// Deliberately pure and framework-free so it can be unit-tested under
// apps/web's node-environment Vitest runner, and reused by the list, the
// cancel dialog, the generation preview and the CSV export without three
// slightly-different copies of the same fallback rule.

/** The subset of InvoiceDto/PreviewLineDto this module needs. */
export interface InvoiceIdentityFields {
  studentId: string;
  studentName: string | null;
  admissionNumber: string | null;
}

/**
 * Primary human label for a student.
 *
 * NEVER falls back to the raw or truncated studentId — the DTO contract says
 * consumers must not render the id as a human-facing fallback, and a UUID in
 * a "Student" column is exactly the failure this slice exists to remove. When
 * the name genuinely cannot be resolved (student row hard-deleted) the label
 * says so in words, and the admission number — if present — carries the
 * identity instead.
 */
export function studentDisplayName(invoice: InvoiceIdentityFields): string {
  const name = invoice.studentName?.trim();
  if (name) return name;
  const admission = invoice.admissionNumber?.trim();
  if (admission) return `Unnamed student (${admission})`;
  return "Unknown student";
}

/**
 * Secondary identity line — the admission number, which is what a Nigerian
 * school actually uses to disambiguate two children with the same name.
 * Returns null when there is nothing useful to add, so callers can skip the
 * element entirely rather than render an empty muted line.
 */
export function studentSecondaryLabel(invoice: InvoiceIdentityFields): string | null {
  const admission = invoice.admissionNumber?.trim();
  if (!admission) return null;
  // Already shown inside the primary label in the unnamed case — don't repeat it.
  if (!invoice.studentName?.trim()) return null;
  return admission;
}

/**
 * Short, human-quotable invoice reference. The full id remains the machine
 * identifier (it stays in the CSV and the URL); this is only what a person
 * reads aloud. Upper-cased because a bursar transcribing it by hand should
 * not have to distinguish letter case.
 */
export function invoiceReference(invoiceId: string): string {
  return invoiceId.slice(0, 8).toUpperCase();
}
