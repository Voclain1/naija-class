import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  NotFoundError,
  type AdminDashboardDto,
  type DashboardSchoolProfileDto,
  type DashboardSetupBlockerDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { MS_PER_DAY, startOfDay, weekStart } from "../../common/dates/week.util.js";
import { buildCollectionByGroup } from "../finance/collection-by-group.js";
import {
  BILLED_EXCLUDED_STATUSES,
  buildFinanceTotalsFromRows,
} from "../finance/finance-totals.js";

const TREND_WEEKS = 8;

// Overrides Prisma's 5000ms interactive-transaction default, the same way
// BULK_SAVE_TRANSACTION_TIMEOUT_MS does for bulkUpsertScores after the
// 2026-08-04 gradebook incident — and for the same reason, which this endpoint
// should have learned from at the time and did not.
//
// This read serialises ~20 round trips on ONE connection (a transaction is one
// connection; a connection runs one statement at a time). Against production's
// Fly-Johannesburg -> Neon-Frankfurt hop, 5000ms across 20 sequential round
// trips is a budget of 250ms each, with Neon's Free-tier autosuspend wake
// sitting on top of it. That is no headroom at all, and a P2028 body-timeout
// here surfaces as "Could not load dashboard" on the most-viewed page in the
// app.
//
// This is a safety net, not the fix — the round-trip reduction is. And it is
// only SAFE because the nested withTenant is gone: holding a connection longer
// while also waiting on a second connection is strictly worse. A longer hold
// that waits on nothing can stall; it cannot deadlock.
const DASHBOARD_TRANSACTION_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// DashboardService — the admin dashboard rebuild's aggregation layer.
//
// This is deliberately a thin composition over existing per-module queries,
// not a new source of truth: fees/outstanding are derived through
// finance-totals.ts, which is also what FinanceService.getDashboard() uses for
// its status sets and arithmetic, so there is exactly one place that knows how
// "collection rate" is defined.
//
// It used to CALL FinanceService.getDashboard() instead. That was a second
// withTenant inside this one — a second pooled connection acquired while this
// transaction still held the first — and it deadlocked production whenever
// concurrent dashboard loads reached the pool size. FinanceService is no
// longer injected here AT ALL, so the nesting cannot be reintroduced by
// accident; dashboard-transaction.spec.ts gates the invariant directly.
//
// "needsYouToday" and "attendanceToday" deliberately do NOT scope by the
// selected termId — they reflect the current real-world moment regardless of
// which historical term the admin is browsing in the KPI row above them.
// Everything else (enrolled, fees, collectionByGroup) IS term-scoped, same as
// every other per-term report in the app.
// ---------------------------------------------------------------------------
@Injectable()
export class DashboardService {
  async getAdminDashboard(authCtx: AuthContext, termId: string): Promise<AdminDashboardDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const term = await db.term.findUnique({
        where: { id: termId },
        select: { id: true, name: true, startDate: true },
      });
      if (!term) throw new NotFoundError("Term not found.");

      const now = new Date();
      const today = startOfDay(now);

      const [
        previousTerm,
        enrollmentsForGroups,
        invoicesForGroups,
        currentTerm,
        pendingReportCardCount,
        pendingInvitationCount,
        attendanceForTrend,
        staffCount,
        activeClassCount,
        lastAttendanceAgg,
        lastPaymentAgg,
        academicYearCount,
      ] = await Promise.all([
        db.term.findFirst({
          where: { startDate: { lt: term.startDate } },
          orderBy: { startDate: "desc" },
          select: { id: true },
        }),
        db.enrollment.findMany({
          where: { termId, status: "ENROLLED" },
          select: {
            studentId: true,
            classArm: { select: { classLevel: { select: { id: true, name: true, orderIndex: true } } } },
          },
        }),
        // `status` is selected so buildFinanceTotalsFromRows can derive the
        // fees/outstanding KPIs from these same rows. The predicate is
        // BILLED_EXCLUDED_STATUSES, which is exactly what that function
        // requires as input, and exactly what FinanceService aggregates over.
        db.invoice.findMany({
          where: { termId, status: { notIn: [...BILLED_EXCLUDED_STATUSES] } },
          select: { studentId: true, status: true, totalDue: true, totalPaid: true },
        }),
        db.term.findFirst({
          where: { isCurrent: true },
          select: {
            id: true,
            name: true,
            startDate: true,
            endDate: true,
            academicYear: { select: { id: true, label: true, isCurrent: true } },
          },
        }),
        db.reportCard.count({ where: { status: "FORM_REVIEWED" } }),
        db.invitation.count({ where: { acceptedAt: null, expiresAt: { gt: now } } }),
        // The 8-week trend window INCLUDES today, so this one read also
        // answers both of today's aggregates — the present/absent split and
        // the set of arms with a register — which used to be two separate
        // groupBy round trips. `classArmId` is selected for the second of
        // those. Cheaper on a cross-continent hop to carry one extra column
        // on rows already in flight than to ask twice more.
        db.attendanceRecord.findMany({
          where: { date: { gte: weekStart(new Date(today.getTime() - (TREND_WEEKS - 1) * 7 * MS_PER_DAY)) } },
          select: { date: true, status: true, classArmId: true },
        }),
        // ─── School profile card ────────────────────────────────────────────
        db.user.count({ where: { isActive: true } }),
        db.classArm.count({ where: { isActive: true } }),
        db.attendanceRecord.aggregate({ _max: { markedAt: true } }),
        db.payment.aggregate({ where: { status: "SUCCESS" }, _max: { paidAt: true } }),
        db.academicYear.count(),
      ]);

      // ─── Second (and ONLY second) query stage ────────────────────────────
      //
      // Everything here depends on a row resolved by the Promise.all above
      // (previousTerm, currentTerm), so it cannot join that batch.
      //
      // NOTE ON "PARALLEL": Promise.all inside an interactive transaction is
      // cosmetic. A transaction is ONE connection and a connection runs one
      // statement at a time, so every query here serialises no matter how it
      // is grouped. Only the COUNT matters. That is why the work here is to
      // REMOVE queries rather than to rearrange them.
      //
      // The common case is an admin looking at the CURRENT term — what the
      // topbar selects by default. When that holds, all three current-term
      // counts below are already answerable from rows stage 1 fetched, so
      // they are skipped. Browsing a different term pays for them again, and
      // is the rarer path.
      const viewingCurrentTerm = currentTerm !== null && currentTerm.id === termId;

      const [previousTermCount, overdueCountQueried, profileTermCounts] = await Promise.all([
        previousTerm
          ? db.enrollment.count({ where: { termId: previousTerm.id, status: "ENROLLED" } })
          : Promise.resolve(null),
        // Scoped to the current term so this count agrees with the page it
        // links to. No current term flagged yields 0 rather than a cross-term
        // total nothing on screen can account for.
        currentTerm && !viewingCurrentTerm
          ? db.invoice.count({ where: { status: "OVERDUE", termId: currentTerm.id } })
          : Promise.resolve(null),
        // The profile card's invoiced ratio plus the fee-structure blocker.
        // With no current term there is nothing to be complete OR incomplete
        // about, and the blocker list says so instead.
        currentTerm
          ? Promise.all([
              viewingCurrentTerm
                ? Promise.resolve(null)
                : db.invoice.count({
                    where: {
                      termId: currentTerm.id,
                      status: { notIn: [...BILLED_EXCLUDED_STATUSES] },
                    },
                  }),
              viewingCurrentTerm
                ? Promise.resolve(null)
                : db.enrollment.count({ where: { termId: currentTerm.id, status: "ENROLLED" } }),
              // termId null means "applies to every term", which is how a
              // school with one global fee structure is modelled — so it counts.
              db.feeItem.count({
                where: { active: true, OR: [{ termId: null }, { termId: currentTerm.id }] },
              }),
            ])
          : Promise.resolve([null, null, 0] as [number | null, number | null, number]),
      ]);

      const [invoicedCountQueried, currentTermEnrolledQueried, activeFeeItemCount] =
        profileTermCounts;

      // invoicesForGroups is already the termId rows filtered to
      // BILLED_EXCLUDED_STATUSES — the same predicate the skipped count used —
      // and Invoice carries @@unique([schoolId, studentId, termId]), so its
      // length IS that term's invoiced-student count.
      const invoicedStudentCount = viewingCurrentTerm
        ? invoicesForGroups.length
        : (invoicedCountQueried ?? 0);
      const currentTermEnrolledCount = viewingCurrentTerm
        ? enrollmentsForGroups.length
        : (currentTermEnrolledQueried ?? 0);
      const overdueCount = viewingCurrentTerm
        ? invoicesForGroups.filter((i) => i.status === "OVERDUE").length
        : (overdueCountQueried ?? 0);

      // Same predicate as the enrollment.count this replaces, over rows already
      // fetched for the collection-by-level breakdown.
      const enrolledCount = enrollmentsForGroups.length;

      // Today's register, derived from the trend rows rather than re-queried.
      // AttendanceRecord.date is @db.Date and `today` is startOfDay, so an
      // exact match is the same comparison the dropped `where: { date: today }`
      // performed — not a date-range approximation.
      const todayTime = today.getTime();
      const todayRecords = attendanceForTrend.filter((r) => r.date.getTime() === todayTime);
      const presentCount = todayRecords.filter((r) => r.status === "PRESENT").length;
      const absentCount = todayRecords.filter((r) => r.status === "ABSENT").length;
      const totalMarked = todayRecords.length;
      const percentPresent = totalMarked > 0 ? Math.round((presentCount / totalMarked) * 100) : 0;
      // Distinct arms with a register today — what the dropped groupBy counted.
      const armsMarkedTodayCount = new Set(todayRecords.map((r) => r.classArmId)).size;

      const collectionByGroup = buildCollectionByGroup(enrollmentsForGroups, invoicesForGroups);

      // Same five figures FinanceService.getDashboard() computes with DB-side
      // aggregates, from rows this request already had in hand. Costs zero
      // extra queries and, more to the point, zero extra transactions.
      const financeTotals = buildFinanceTotalsFromRows(invoicesForGroups);

      const needsYouToday = [
        { type: "overdue_fees" as const, count: overdueCount, href: "/finance/debtors" },
        {
          type: "pending_report_card_approval" as const,
          count: pendingReportCardCount,
          href: "/report-cards",
        },
        {
          type: "pending_staff_invitations" as const,
          count: pendingInvitationCount,
          href: "/staff",
        },
      ];

      const attendanceTrend = buildAttendanceTrend(attendanceForTrend, today);

      const schoolProfile = buildSchoolProfile({
        currentTerm,
        academicYearCount,
        staffCount,
        activeClassCount,
        armsMarkedTodayCount,
        invoicedStudentCount,
        currentTermEnrolledCount,
        activeFeeItemCount,
        lastAttendanceMarkedAt: lastAttendanceAgg._max.markedAt ?? null,
        lastPaymentRecordedAt: lastPaymentAgg._max.paidAt ?? null,
      });

      return {
        termId: term.id,
        termName: term.name,
        asOf: now.toISOString(),
        enrolled: { count: enrolledCount, previousTermCount },
        fees: {
          collected: financeTotals.totalCollected,
          billed: financeTotals.totalInvoiced,
          percent: financeTotals.collectionRatePercent,
        },
        attendanceToday: {
          date: today.toISOString().slice(0, 10),
          presentCount,
          absentCount,
          totalMarked,
          percentPresent,
        },
        outstanding: {
          amount: financeTotals.outstandingBalance,
          debtorCount: financeTotals.debtorCount,
        },
        collectionByGroup,
        needsYouToday,
        attendanceTrend,
        schoolProfile,
      };
      },
      { timeoutMs: DASHBOARD_TRANSACTION_TIMEOUT_MS, label: "dashboard.getAdminDashboard" },
    );
  }
}

function buildSchoolProfile(input: {
  currentTerm: {
    id: string;
    name: string;
    startDate: Date;
    endDate: Date;
    academicYear: { id: string; label: string; isCurrent: boolean };
  } | null;
  academicYearCount: number;
  staffCount: number;
  activeClassCount: number;
  armsMarkedTodayCount: number;
  invoicedStudentCount: number;
  currentTermEnrolledCount: number;
  activeFeeItemCount: number;
  lastAttendanceMarkedAt: Date | null;
  lastPaymentRecordedAt: Date | null;
}): DashboardSchoolProfileDto {
  const { currentTerm } = input;

  // Ordered most-fundamental-first, matching the finance dashboard's existing
  // notice ladder: no year at all, then none flagged current, then no current
  // term, then no fees. Each names the real blocker rather than a symptom.
  const setupBlockers: DashboardSetupBlockerDto[] = [];
  if (input.academicYearCount === 0) {
    setupBlockers.push({ type: "no_academic_year", href: "/settings/academic" });
  } else if (!currentTerm) {
    // No term carries isCurrent. Whether a YEAR is flagged current is a
    // separate question and worth saying separately, because the fix differs.
    setupBlockers.push({ type: "no_current_term", href: "/settings/academic" });
  } else if (!currentTerm.academicYear.isCurrent) {
    setupBlockers.push({ type: "no_current_academic_year", href: "/settings/academic" });
  }
  if (currentTerm && input.activeFeeItemCount === 0) {
    setupBlockers.push({ type: "no_fee_structure", href: "/finance/fees" });
  }

  return {
    academicYear: currentTerm
      ? { id: currentTerm.academicYear.id, label: currentTerm.academicYear.label }
      : null,
    term: currentTerm
      ? {
          id: currentTerm.id,
          name: currentTerm.name,
          startDate: currentTerm.startDate.toISOString().slice(0, 10),
          endDate: currentTerm.endDate.toISOString().slice(0, 10),
        }
      : null,
    staffCount: input.staffCount,
    activeClassCount: input.activeClassCount,
    completeness: {
      attendanceToday: { done: input.armsMarkedTodayCount, total: input.activeClassCount },
      studentsInvoiced: {
        done: input.invoicedStudentCount,
        total: input.currentTermEnrolledCount,
      },
    },
    lastActivity: {
      attendanceMarkedAt: input.lastAttendanceMarkedAt?.toISOString() ?? null,
      paymentRecordedAt: input.lastPaymentRecordedAt?.toISOString() ?? null,
    },
    setupBlockers,
  };
}

function buildAttendanceTrend(
  records: Array<{ date: Date; status: string }>,
  today: Date,
): Array<{ weekStart: string; totalMarked: number; percentPresent: number | null }> {
  const buckets = new Map<string, { present: number; total: number }>();
  const weeks: string[] = [];
  for (let i = TREND_WEEKS - 1; i >= 0; i--) {
    const ws = weekStart(new Date(today.getTime() - i * 7 * MS_PER_DAY));
    const key = ws.toISOString().slice(0, 10);
    weeks.push(key);
    buckets.set(key, { present: 0, total: 0 });
  }

  for (const r of records) {
    const key = weekStart(r.date).toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue; // outside the trend window (defensive; the query already filters this)
    bucket.total += 1;
    if (r.status === "PRESENT") bucket.present += 1;
  }

  return weeks.map((weekStartKey) => {
    const bucket = buckets.get(weekStartKey)!;
    return {
      weekStart: weekStartKey,
      totalMarked: bucket.total,
      // null, NOT 0, when nothing was marked — a holiday week is not a week
      // of total absence, and returning 0 made the two indistinguishable on
      // the chart. See DashboardAttendanceWeekDto.
      percentPresent: bucket.total > 0 ? Math.round((bucket.present / bucket.total) * 100) : null,
    };
  });
}
