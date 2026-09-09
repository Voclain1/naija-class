import { z } from "zod";

import type { DashboardCollectionGroupDto } from "../dashboard/admin-dashboard.dto.js";

// Collection by class level, for the finance dashboard.
//
// A SEPARATE DTO rather than extra fields on FinanceDashboardDto, and that is
// load-bearing rather than stylistic: `finance.mobile-cp3.spec.ts` pins
// FinanceDashboardDto's exact key set because STAFF MOBILE consumes it, with
// the explicit intent that "the phone must not become the surface where a new
// field quietly reaches a staffroom". A web-only breakdown bolted onto that
// DTO would ship per-class fee data to a screen that never asked for it, and
// the contract test correctly refuses it.
//
// Same split D5 of docs/modules/revenue-trajectory.md already made for the
// trajectory: the KPI read should not pay for a per-level scan it never
// renders, and the two surfaces stay independently changeable.
//
// Mirrors financeDashboardQuerySchema exactly: termId required, no server-side
// "current term" fallback — the web UI resolves "current" itself.
export const collectionByLevelQuerySchema = z.object({
  termId: z.string().uuid(),
});
export type CollectionByLevelQuery = z.infer<typeof collectionByLevelQuerySchema>;

export interface CollectionByLevelDto {
  termId: string;
  termName: string;
  /**
   * Billed vs collected per class level, ordered by `ClassLevel.orderIndex`,
   * with the synthetic `"unassigned"` bucket last.
   *
   * The same `DashboardCollectionGroupDto` rows the admin dashboard returns,
   * built by the same shared function — so the two screens cannot disagree
   * about what a group row means.
   */
  groups: DashboardCollectionGroupDto[];
  /**
   * The totals these rows must SUM to, computed the same way
   * FinanceDashboardDto's are. Returned so the breakdown can be shown against
   * its own total rather than the caller inferring one, and so the spec has a
   * reconciliation target — the "Unassigned" bucket exists precisely to keep
   * this equality true.
   */
  totalInvoiced: number; // kobo
  totalCollected: number; // kobo
}
