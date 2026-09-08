// School profile card — the admin dashboard's "what is this school's actual
// state right now" panel.
//
// WHAT THIS DELIBERATELY IS NOT: a health/uptime indicator. There is no
// "system status" here and no green dot, because a status light on this card
// could only ever render when the API is already up — it would be
// tautological, and worse, tautology dressed as assurance.
//
// There is also no "last synced" timestamp. This codebase has no sync concept
// at all (no lastSync/syncedAt/synced_at anywhere in the schema; the web app
// reads Postgres directly and mobile offline sync is still undecided in
// CLAUDE.md), so such a field could only be invented. It was proposed and
// deliberately rejected on that basis.
//
// What replaces both is three groups of things that are actually true and
// actually checkable: plain facts, completeness ratios that each carry a real
// denominator, and timestamps of real recorded activity. If a school stopped
// marking attendance three weeks ago, this card says so. A status light never
// would.
//
// EVERYTHING HERE IS "RIGHT NOW", not scoped to the term the admin happens to
// be browsing in the KPI row — same rule as needsYouToday and attendanceToday.
// The year and term reported are the CURRENT ones (isCurrent), which is what
// "active academic year" means to a proprietor.

/**
 * A completeness ratio. Always carries its denominator, so the frontend can
 * render "6 of 9" rather than a bare percentage that hides how much of the
 * school it actually describes. `total` of 0 means the denominator itself is
 * missing (no active classes, nobody enrolled) — render that as "—", never as
 * 0% or 100%, both of which would be assertions the data does not support.
 */
export interface DashboardRatioDto {
  done: number;
  total: number;
}

/**
 * A precondition that is currently unmet and silently breaks things.
 *
 * `no_current_academic_year` / `no_current_term` are the highest-value rows
 * here: `isCurrent` is a MANUALLY set flag, never derived from dates, and when
 * it is unset the finance dashboard, the student roster and enrollment all go
 * quietly empty with no error anywhere. Newly provisioned schools land in
 * exactly this state through both onboarding paths (a known open root cause),
 * and until now nothing on the dashboard named it.
 */
export type DashboardSetupBlockerType =
  | "no_academic_year"
  | "no_current_academic_year"
  | "no_current_term"
  | "no_fee_structure";

export interface DashboardSetupBlockerDto {
  type: DashboardSetupBlockerType;
  /** Where to go to fix it. */
  href: string;
}

export interface DashboardSchoolProfileDto {
  // ─── Facts ────────────────────────────────────────────────────────────────
  academicYear: { id: string; label: string } | null;
  term: {
    id: string;
    name: string;
    startDate: string; // ISO date
    endDate: string; // ISO date
  } | null;
  /** Active user accounts at this school (any role). */
  staffCount: number;
  /** ClassArm rows with isActive true. */
  activeClassCount: number;

  // ─── Completeness — real numerators over real denominators ────────────────
  completeness: {
    /** Distinct class arms with any attendance record dated today, over active arms. */
    attendanceToday: DashboardRatioDto;
    /** Students with an invoice for the current term, over students enrolled in it. */
    studentsInvoiced: DashboardRatioDto;
  };

  // ─── Last real activity — recorded rows, not health pings ─────────────────
  lastActivity: {
    /** max(AttendanceRecord.markedAt), or null if a register has never been taken. */
    attendanceMarkedAt: string | null;
    /** max(Payment.paidAt) over SUCCESS payments, or null if none recorded. */
    paymentRecordedAt: string | null;
  };

  /** Empty when the school is fully set up. Only ever contains real blockers. */
  setupBlockers: DashboardSetupBlockerDto[];
}
