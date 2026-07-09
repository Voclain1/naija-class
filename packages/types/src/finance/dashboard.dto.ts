import { z } from "zod";

// Phase 3 / Slice 14 — finance dashboard. Mirrors listDebtorsSchema exactly:
// termId required, no server-side "current term" fallback — the web UI
// resolves "current" the same way the debtors page already does, via its
// year/term selector.
export const financeDashboardQuerySchema = z.object({
  termId: z.string().uuid(),
});
export type FinanceDashboardQuery = z.infer<typeof financeDashboardQuerySchema>;

export interface FinanceDashboardDto {
  termId: string;
  termName: string;
  // Collections vs "target" — target is what was actually invoiced
  // (totalDue), not a separate budget entity; none exists in the schema.
  totalInvoiced: number; // kobo — sum(totalDue), invoices that were issued and not voided
  totalCollected: number; // kobo — sum(totalPaid), same set
  collectionRatePercent: number; // round(totalCollected / totalInvoiced * 100); 0 if totalInvoiced is 0
  // Debtors — ISSUED/PARTIALLY_PAID/OVERDUE only. REFUNDED is terminal and
  // not collectible, so it contributes to totalInvoiced but not here.
  outstandingBalance: number; // kobo — sum(totalDue - totalPaid)
  debtorCount: number; // count of invoices in that same set (one per student per term)
  // Expenses — Expense has no termId; scoped by the term's own date range.
  totalExpenses: number; // kobo — sum(Expense.amount) where incurredAt is within [term.startDate, term.endDate]
  netPosition: number; // totalCollected - totalExpenses
}
