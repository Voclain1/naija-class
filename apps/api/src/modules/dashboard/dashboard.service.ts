import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import { NotFoundError, type AdminDashboardDto, type DashboardCollectionGroupDto } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { FinanceService } from "../finance/finance.service.js";

const TREND_WEEKS = 8;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// UTC, not local time — AttendanceRecord.date is `@db.Date` (no timezone;
// see CLAUDE.md's "midnight in which zone?" rule). Using local-time mutators
// here (setHours/getDay/setDate) would compare against the wrong calendar
// day whenever the server's local timezone isn't UTC+0, which is exactly
// the trap that rule exists to avoid.
function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Monday of the week containing `d` (ISO week start), at UTC midnight.
function weekStart(d: Date): Date {
  const out = startOfDay(d);
  const day = out.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  out.setUTCDate(out.getUTCDate() + diff);
  return out;
}

// ---------------------------------------------------------------------------
// DashboardService — the admin dashboard rebuild's aggregation layer.
//
// This is deliberately a thin composition over existing per-module services
// and queries, not a new source of truth: fees/outstanding are delegated to
// FinanceService.getDashboard() (Phase 3 / Slice 14) rather than re-computed
// here, so there is exactly one place that knows how "collection rate" is
// defined.
//
// "needsYouToday" and "attendanceToday" deliberately do NOT scope by the
// selected termId — they reflect the current real-world moment regardless of
// which historical term the admin is browsing in the KPI row above them.
// Everything else (enrolled, fees, collectionByGroup) IS term-scoped, same as
// every other per-term report in the app.
// ---------------------------------------------------------------------------
@Injectable()
export class DashboardService {
  constructor(private readonly finance: FinanceService) {}

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
        enrolledCount,
        previousTerm,
        financeDashboard,
        attendanceAgg,
        enrollmentsForGroups,
        invoicesForGroups,
        overdueCount,
        pendingReportCardCount,
        pendingInvitationCount,
        attendanceForTrend,
      ] = await Promise.all([
        db.enrollment.count({ where: { termId, status: "ENROLLED" } }),
        db.term.findFirst({
          where: { startDate: { lt: term.startDate } },
          orderBy: { startDate: "desc" },
          select: { id: true },
        }),
        this.finance.getDashboard(authCtx, termId),
        db.attendanceRecord.groupBy({ by: ["status"], where: { date: today }, _count: true }),
        db.enrollment.findMany({
          where: { termId, status: "ENROLLED" },
          select: {
            studentId: true,
            classArm: { select: { classLevel: { select: { id: true, name: true, orderIndex: true } } } },
          },
        }),
        db.invoice.findMany({
          where: { termId, status: { notIn: ["DRAFT", "CANCELLED"] } },
          select: { studentId: true, totalDue: true, totalPaid: true },
        }),
        db.invoice.count({ where: { status: "OVERDUE" } }),
        db.reportCard.count({ where: { status: "FORM_REVIEWED" } }),
        db.invitation.count({ where: { acceptedAt: null, expiresAt: { gt: now } } }),
        db.attendanceRecord.findMany({
          where: { date: { gte: weekStart(new Date(today.getTime() - (TREND_WEEKS - 1) * 7 * MS_PER_DAY)) } },
          select: { date: true, status: true },
        }),
      ]);

      let previousTermCount: number | null = null;
      if (previousTerm) {
        previousTermCount = await db.enrollment.count({
          where: { termId: previousTerm.id, status: "ENROLLED" },
        });
      }

      const presentCount = attendanceAgg.find((a) => a.status === "PRESENT")?._count ?? 0;
      const absentCount = attendanceAgg.find((a) => a.status === "ABSENT")?._count ?? 0;
      const totalMarked = attendanceAgg.reduce((sum, a) => sum + a._count, 0);
      const percentPresent = totalMarked > 0 ? Math.round((presentCount / totalMarked) * 100) : 0;

      const collectionByGroup = buildCollectionByGroup(enrollmentsForGroups, invoicesForGroups);

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

      return {
        termId: term.id,
        termName: term.name,
        asOf: now.toISOString(),
        enrolled: { count: enrolledCount, previousTermCount },
        fees: {
          collected: financeDashboard.totalCollected,
          billed: financeDashboard.totalInvoiced,
          percent: financeDashboard.collectionRatePercent,
        },
        attendanceToday: {
          date: today.toISOString().slice(0, 10),
          presentCount,
          absentCount,
          totalMarked,
          percentPresent,
        },
        outstanding: {
          amount: financeDashboard.outstandingBalance,
          debtorCount: financeDashboard.debtorCount,
        },
        collectionByGroup,
        needsYouToday,
        attendanceTrend,
      };
    });
  }
}

function buildCollectionByGroup(
  enrollments: Array<{
    studentId: string;
    classArm: { classLevel: { id: string; name: string; orderIndex: number } };
  }>,
  invoices: Array<{ studentId: string; totalDue: number; totalPaid: number }>,
): DashboardCollectionGroupDto[] {
  const studentToLevel = new Map<string, { id: string; name: string; orderIndex: number }>();
  for (const e of enrollments) {
    studentToLevel.set(e.studentId, e.classArm.classLevel);
  }

  const groups = new Map<string, { label: string; orderIndex: number; billed: number; collected: number }>();
  for (const inv of invoices) {
    const level = studentToLevel.get(inv.studentId);
    if (!level) continue; // invoice for a student with no ENROLLED row this term — nothing to group by
    const existing = groups.get(level.id) ?? {
      label: level.name,
      orderIndex: level.orderIndex,
      billed: 0,
      collected: 0,
    };
    existing.billed += inv.totalDue;
    existing.collected += inv.totalPaid;
    groups.set(level.id, existing);
  }

  return Array.from(groups.entries())
    .sort((a, b) => a[1].orderIndex - b[1].orderIndex)
    .map(([groupId, g]) => ({
      groupId,
      label: g.label,
      billed: g.billed,
      collected: g.collected,
      percent: g.billed > 0 ? Math.round((g.collected / g.billed) * 100) : 0,
    }));
}

function buildAttendanceTrend(
  records: Array<{ date: Date; status: string }>,
  today: Date,
): Array<{ weekStart: string; percentPresent: number }> {
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
      percentPresent: bucket.total > 0 ? Math.round((bucket.present / bucket.total) * 100) : 0,
    };
  });
}
