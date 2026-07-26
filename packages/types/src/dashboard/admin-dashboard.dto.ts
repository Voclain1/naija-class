import { z } from "zod";

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
  percentPresent: number; // round(present / totalMarked * 100); 0 if totalMarked is 0
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
}
