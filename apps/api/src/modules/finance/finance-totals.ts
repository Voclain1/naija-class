import type { InvoiceStatus } from "@school-kit/db";

// ---------------------------------------------------------------------------
// The single definition of what "billed", "collected", "outstanding" and
// "collection rate" mean.
//
// Same reasoning as collection-by-group.ts, and the same shape: a pure module
// in the FINANCE module that the dashboard imports, so the dependency points
// one way and nothing is copied. CLAUDE.md requires "exactly one place that
// knows how collection rate is defined", and until 2026-09-11 that place was
// FinanceService.getDashboard() — which DashboardService reached by CALLING
// it, inside its own withTenant, opening a second transaction and a second
// pooled connection while the first was still held. That nesting was the
// production deadlock (see dashboard-transaction.spec.ts). Removing it means
// the dashboard has to derive these figures itself, so the definition has to
// move somewhere both callers can reach without one entering the other.
//
// WHAT IS SHARED AND WHAT IS DELIBERATELY NOT:
//
// Shared — the status sets and the arithmetic. Those ARE the definition.
//
// NOT shared — how the rows are obtained. FinanceService keeps its DB-side
// SUM aggregates, because GET /finance/dashboard is a KPI-only read and D5 of
// docs/modules/revenue-trajectory.md decided deliberately that it "should not
// pay for a scan it never renders" (which is why collection-by-level is a
// separate endpoint). The admin dashboard is the opposite case: it ALREADY
// fetches every one of these invoice rows for its collection-by-level
// breakdown, so summing them costs it nothing and saves an entire transaction.
//
// Two execution strategies over one definition is a real drift risk, and the
// honest mitigation is a test, not this comment: finance-totals.spec.ts runs
// BOTH paths against the same seeded school and asserts field-by-field
// equality, including PAID / REFUNDED / CANCELLED / DRAFT invoices, a student
// holding several invoices, and an invoice whose student has no enrollment.
// ---------------------------------------------------------------------------

/**
 * Excluded from billed/collected totals. A DRAFT invoice has not been issued
 * to anyone and a CANCELLED one has been withdrawn; counting either would
 * bill a parent on the dashboard for money the school never asked for.
 *
 * Expressed as the EXCLUDED set rather than the included one so it stays
 * correct when a new InvoiceStatus is added: a status nobody thought about
 * lands in "billed" and shows up, rather than being silently dropped from the
 * school's revenue figures with no one noticing.
 */
export const BILLED_EXCLUDED_STATUSES = ["DRAFT", "CANCELLED"] as const satisfies readonly InvoiceStatus[];

/**
 * Counts toward outstanding balance and the debtor count: issued, part-paid,
 * or overdue. PAID has nothing outstanding; REFUNDED is not money owed.
 * A strict subset of the billed set above — relied on by
 * buildFinanceTotalsFromRows, which filters one row array for both.
 */
export const OUTSTANDING_STATUSES = [
  "ISSUED",
  "PARTIALLY_PAID",
  "OVERDUE",
] as const satisfies readonly InvoiceStatus[];

/** The rounding rule. Whole percent; zero when nothing has been billed. */
export function collectionRatePercent(totalInvoiced: number, totalCollected: number): number {
  return totalInvoiced > 0 ? Math.round((totalCollected / totalInvoiced) * 100) : 0;
}

export interface FinanceTotals {
  totalInvoiced: number;
  totalCollected: number;
  collectionRatePercent: number;
  outstandingBalance: number;
  debtorCount: number;
}

/**
 * Derives the same five figures FinanceService.getDashboard() computes with
 * DB-side aggregates, from invoice rows the caller has already fetched.
 *
 * `rows` MUST be the full set for the term with BILLED_EXCLUDED_STATUSES
 * removed — the same predicate FinanceService uses. Passing a narrower set
 * (say, only unpaid invoices) silently understates billed totals.
 *
 * Money stays Int kobo throughout; no float arithmetic enters here.
 */
export function buildFinanceTotalsFromRows(
  rows: Array<{ status: InvoiceStatus; totalDue: number; totalPaid: number }>,
): FinanceTotals {
  let totalInvoiced = 0;
  let totalCollected = 0;
  let outstandingDue = 0;
  let outstandingPaid = 0;
  let debtorCount = 0;

  const outstanding = new Set<InvoiceStatus>(OUTSTANDING_STATUSES);

  for (const row of rows) {
    totalInvoiced += row.totalDue;
    totalCollected += row.totalPaid;
    if (outstanding.has(row.status)) {
      outstandingDue += row.totalDue;
      outstandingPaid += row.totalPaid;
      // Counts invoice ROWS, matching FinanceService's `_count` on the same
      // filter exactly. Within a term that is also the number of distinct
      // students, since Invoice carries @@unique([schoolId, studentId,
      // termId]) — so the name is accurate, not a latent off-by-duplicate.
      debtorCount += 1;
    }
  }

  return {
    totalInvoiced,
    totalCollected,
    collectionRatePercent: collectionRatePercent(totalInvoiced, totalCollected),
    outstandingBalance: outstandingDue - outstandingPaid,
    debtorCount,
  };
}
