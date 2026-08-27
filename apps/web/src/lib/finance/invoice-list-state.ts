// What the invoice table should be showing right now.
//
// F-05: the list previously did `.catch(() => setInvoices([]))`, so a 500, a
// dropped connection, an expired session — every failure — rendered the same
// row as a healthy term with nothing billed yet: "No invoices found."  For a
// bursar that is not a cosmetic problem. "No invoices found" is a factual
// claim about the school's finances, and it was being made on the strength
// of a network error. Someone could reasonably re-run generation, or tell a
// parent nothing was owed.
//
// This module makes the distinction explicit and total, so no code path can
// collapse an error into an emptiness claim again.

import type { InvoiceStatus } from "@school-kit/types";

export type InvoiceListView =
  /** Request in flight, nothing to show yet. */
  | { kind: "loading" }
  /** The fetch failed. NOT an emptiness claim. Offers a retry. */
  | { kind: "error"; message: string }
  /** Fetch succeeded; this term/arm genuinely has no invoices at all. */
  | { kind: "empty" }
  /** Fetch succeeded; invoices exist but the active filters exclude them. */
  | { kind: "filtered-empty"; statusLabel: string }
  /** Fetch succeeded with rows. */
  | { kind: "rows" };

export interface InvoiceListInputs {
  loading: boolean;
  error: string | null;
  rowCount: number;
  /** The status filter currently applied, "" for "All statuses". */
  statusFilter: InvoiceStatus | "";
  /** Human label for that status, for the filtered-empty copy. */
  statusLabel: string;
}

/**
 * Order matters and is deliberate:
 *   error BEFORE loading — a retry must not be hidden behind a spinner that
 *   a stale `loading` flag left set;
 *   error BEFORE emptiness — this is the whole point of the module;
 *   filtered-empty BEFORE empty — "no OVERDUE invoices in this arm" and
 *   "this arm has no invoices" are different facts and the second is the
 *   one a bursar would act on.
 */
export function resolveInvoiceListView(input: InvoiceListInputs): InvoiceListView {
  if (input.error) return { kind: "error", message: input.error };
  if (input.loading) return { kind: "loading" };
  if (input.rowCount > 0) return { kind: "rows" };
  if (input.statusFilter !== "") {
    return { kind: "filtered-empty", statusLabel: input.statusLabel };
  }
  return { kind: "empty" };
}
