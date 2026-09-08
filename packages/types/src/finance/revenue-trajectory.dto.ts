import { z } from "zod";

// Revenue trajectory — the term's collections story over time.
// Plan-first: docs/modules/revenue-trajectory.md.
//
// Mirrors financeDashboardQuerySchema exactly: termId required, no
// server-side "current term" fallback — the web UI resolves "current" itself,
// the same way /finance/dashboard and /finance/debtors already do.
export const revenueTrajectoryQuerySchema = z.object({
  termId: z.string().uuid(),
});
export type RevenueTrajectoryQuery = z.infer<typeof revenueTrajectoryQuerySchema>;

/**
 * BEFORE_TERM / AFTER_TERM are the out-of-term buckets that make the series
 * reconcile against FinanceDashboardDto (see D2 in the module doc). They are
 * emitted only when rows actually fall outside the term's own week span —
 * `totalCollected` carries no date filter at all, so money paid early (a
 * parent settling next term's fees in the holidays) or late (arrears chased
 * months afterwards) belongs to the term's totals while falling outside every
 * in-term week. Without these two buckets the curve ends below the KPI card
 * sitting beside it and nothing errors.
 */
export type RevenueTrajectoryBucketKind = "BEFORE_TERM" | "IN_TERM" | "AFTER_TERM";

export interface RevenueTrajectoryBucketDto {
  /** ISO date (YYYY-MM-DD). Monday of the bucket's UTC week for IN_TERM. */
  weekStart: string;
  kind: RevenueTrajectoryBucketKind;
  /** "Week 1"… for IN_TERM; "Before term" / "After term" for the others. */
  label: string;
  /**
   * Cumulative kobo, or `null` for a week that has not happened yet.
   *
   * `null` means "no data yet"; `0` means "genuinely nothing collected".
   * These are deliberately different values and must stay different all the
   * way to the axis — a future week rendered as 0 draws a flat line along the
   * bottom of the chart that reads as catastrophic collection, when in fact
   * the week simply hasn't arrived. Only the contiguous run of trailing
   * future weeks is nulled, so the cumulative series never has a hole in the
   * middle.
   */
  invoiced: number | null;
  collected: number | null;
  /** True when this week lies entirely after today and holds no rows. */
  isFuture: boolean;
}

export interface RevenueTrajectoryDto {
  termId: string;
  termName: string;
  termStartDate: string; // ISO date — the real stored Term.startDate
  termEndDate: string; // ISO date — the real stored Term.endDate
  /** When this response was computed (live query, not a cached snapshot). */
  asOf: string;
  /**
   * Week count is derived from the term's own stored dates, never assumed to
   * be a fixed number — Nigerian terms are not a uniform length and a school
   * may set any span it likes.
   */
  buckets: RevenueTrajectoryBucketDto[];
  /**
   * Reconciliation anchors. These are computed the same way
   * FinanceDashboardDto's are and MUST equal them for the same termId; the
   * last non-null cumulative bucket value must equal them too. Returned
   * explicitly so the frontend can show the curve against its own total
   * rather than inferring it, and so the spec has something to assert on.
   */
  totalInvoiced: number; // kobo
  totalCollected: number; // kobo
}
