import { z } from "zod";

import type { DashboardSchoolProfileDto } from "./school-profile.dto.js";

// Admin dashboard — the "visual/UX overhaul" initiative's first slice
// (not tied to a numbered Phase; Phase 4 is closed, Phase 5 is AI). Mirrors
// financeDashboardQuerySchema exactly: termId required, no server-side
// "current term" fallback — the web UI resolves "current" itself.
export const adminDashboardQuerySchema = z.object({
  termId: z.string().uuid(),
});
export type AdminDashboardQuery = z.infer<typeof adminDashboardQuerySchema>;

// "Collection by campus" in the mockup, generalised to "collection by group"
// so a single-school tenant (today) and a future multi-campus tenant share
// one response shape. Today groupId/label come from ClassLevel (the closest
// real, already-modelled dimension); when multi-campus ships, the same shape
// re-keys on Branch without a frontend contract change — see CLAUDE.md
// "Design system" section for the full rationale.
export interface DashboardCollectionGroupDto {
  /**
   * A ClassLevel.id today (a Branch.id when multi-campus ships), or the
   * literal `"unassigned"` for the synthetic bucket holding invoices whose
   * student has no ENROLLED row for the term.
   *
   * That bucket exists so these rows SUM to `fees.billed`/`fees.collected`
   * above them. Previously such invoices were silently dropped, so the
   * breakdown quietly disagreed with the KPI card on the same screen with
   * nothing on the page explaining the difference.
   */
  groupId: string;
  label: string;
  billed: number; // kobo
  collected: number; // kobo
  percent: number; // round(collected / billed * 100); 0 if billed is 0
}

export type DashboardAlertType =
  | "overdue_fees"
  | "pending_report_card_approval"
  | "pending_staff_invitations";

export interface DashboardAlertDto {
  type: DashboardAlertType;
  count: number;
  href: string;
}

export interface DashboardAttendanceWeekDto {
  weekStart: string; // ISO date (Monday of that week)
  /**
   * How many attendance records exist in this week at all. The denominator,
   * exposed so the chart can tell "no school this week" apart from "school
   * ran and nobody came".
   */
  totalMarked: number;
  /**
   * round(present / totalMarked * 100), or `null` when totalMarked is 0.
   *
   * `null` means no register was taken that week — a holiday, a mid-term
   * break, or a week the school simply did not mark. It is NOT 0.
   *
   * This previously returned 0 for an unmarked week, which plotted a dive to
   * the axis indistinguishable from a week where every single student was
   * absent. The frontend could not tell them apart because this DTO did not
   * carry the denominator. Same no-data-vs-zero distinction the revenue
   * trajectory encodes for future weeks.
   */
  percentPresent: number | null;
}

export interface AdminDashboardDto {
  termId: string;
  termName: string;
  asOf: string; // ISO timestamp — when this response was computed (live query, not a cached snapshot)

  enrolled: {
    count: number;
    previousTermCount: number | null; // null when there is no earlier term to compare against
  };

  fees: {
    collected: number; // kobo
    billed: number; // kobo
    percent: number; // same definition as FinanceDashboardDto.collectionRatePercent
  };

  attendanceToday: {
    date: string; // ISO date
    presentCount: number;
    absentCount: number;
    totalMarked: number;
    percentPresent: number; // 0 if totalMarked is 0 (nothing marked yet today)
  };

  outstanding: {
    amount: number; // kobo
    debtorCount: number;
  };

  collectionByGroup: DashboardCollectionGroupDto[];

  needsYouToday: DashboardAlertDto[];

  attendanceTrend: DashboardAttendanceWeekDto[]; // last 8 weeks, oldest first

  /**
   * The school's actual state right now — facts, completeness ratios with
   * real denominators, and timestamps of real activity. Deliberately NOT a
   * health/uptime indicator; see school-profile.dto.ts for why.
   */
  schoolProfile: DashboardSchoolProfileDto;
}
