import { Injectable, Logger } from "@nestjs/common";

import { withGuardian, withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  SICKBAY_LIMITS,
  ValidationError,
  formatSickbayTime,
  sickbayDayOf,
  type AddSickbayMedicationInput,
  type CreateSickbayVisitInput,
  type PortalSickbayVisitListResponse,
  type SickbayMedicationInput,
  type SickbayVisitDto,
  type SickbayVisitListQuery,
  type SickbayVisitListResponse,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import { redactPhone } from "../../common/redact.js";
import { smsSenderFor } from "../../common/termii/sms-sender.js";
import { normalizeNigerianPhone, TermiiService } from "../../common/termii/termii.service.js";
import { boarderLabels } from "../hostels/hostel-house.service.js";
import { NotificationDispatchService, type DeliveryChannel } from "../notifications/notification-dispatch.service.js";

// Phase 9 / CP3.3 — the sickbay log (docs/modules/phase-9.md §10 CP3-D5,
// CP3-D6).
//
//   - owner, admin and the Health officer record and read visits; teachers
//     never see the log, and there is no teacher route;
//   - medicine given is its own list on the visit;
//   - withdrawn, never deleted;
//   - the child's guardians read the time, "visited the sickbay" and whether
//     the child was sent home; the complaint, action and medicine only when
//     the visit was shared with them.
//
// Parents are told of each visit once (a unique sickbay_notices row): by push
// when they have a live app, and by SMS ONLY when the child was sent home. The
// push names no child and no complaint; the SMS names the child's first name
// and the time, never the complaint or the medicine.
//
// Every read is audited, and the health text never goes into the audit log.

const AUDIT = {
  create: "sickbay.visit.create",
  withdraw: "sickbay.visit.withdraw",
  medication: "sickbay.medication.add",
  read: "sickbay.read",
  portalRead: "sickbay.portal.read",
  notice: "sickbay.notice",
} as const;

const RECORD_ROLES = ["owner", "admin", "health_officer"];

/** The locked-screen text (CP3-D6). No child, no complaint. */
export const SICKBAY_PUSH_BODY = "The school has sent you an update. Open the app to read it.";

/** A clock a few minutes fast is not a visit "in the future". */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
/** How far back a visit may be recorded. */
const MAX_BACKDATE_MS = 30 * 24 * 60 * 60 * 1000;

type Db = Parameters<Parameters<typeof withTenant>[1]>[0];

interface RequestContext {
  ipAddress: string | null;
}

const fullName = (u: { firstName: string; lastName: string }): string => `${u.firstName} ${u.lastName}`;

/** The SMS a guardian receives when their child is sent home. No complaint, no medicine. */
export function buildSickbaySms(input: { schoolName: string; studentFirstName: string; visitedAt: Date }): string {
  return (
    `${input.schoolName}: ${input.studentFirstName} visited the sickbay at ${formatSickbayTime(input.visitedAt)} ` +
    "and is being sent home. Please contact the school."
  );
}

/** Lagos is UTC+1 all year. */
function dayBounds(day: string): { gte: Date; lt: Date } {
  const gte = new Date(`${day}T00:00:00+01:00`);
  if (Number.isNaN(gte.getTime())) throw new ValidationError("Use a date like 2026-10-15.");
  return { gte, lt: new Date(gte.getTime() + 24 * 60 * 60 * 1000) };
}

function assertMedicationTimes(meds: SickbayMedicationInput[], visitedAt: Date, now: number): void {
  for (const m of meds) {
    const at = new Date(m.givenAt).getTime();
    if (at > now + CLOCK_SKEW_MS) throw new ValidationError("A medicine can't be given in the future.");
    if (at < visitedAt.getTime()) throw new ValidationError("A medicine can't be given before the visit.");
  }
}

@Injectable()
export class SickbayService {
  private readonly logger = new Logger(SickbayService.name);

  constructor(
    private readonly dispatch: NotificationDispatchService,
    private readonly termii: TermiiService,
  ) {}

  // =========================================================================
  // POST /health/sickbay/visits — record a visit, then tell the parents
  // =========================================================================
  async createVisit(authCtx: AuthContext, input: CreateSickbayVisitInput, reqCtx: RequestContext): Promise<SickbayVisitDto> {
    await assertUserActiveAndHasOneOf(authCtx, RECORD_ROLES);
    const now = Date.now();
    const visitedAt = new Date(input.visitedAt);
    if (visitedAt.getTime() > now + CLOCK_SKEW_MS) throw new ValidationError("A visit can't be in the future.");
    if (visitedAt.getTime() < now - MAX_BACKDATE_MS) {
      throw new ValidationError("A visit can be recorded up to 30 days after it happened.");
    }
    const medications = input.medications ?? [];
    assertMedicationTimes(medications, visitedAt, now);

    const created = await withTenant(authCtx.schoolId, async (db) => {
      const student = await db.student.findUnique({ where: { id: input.studentId }, select: { id: true } });
      if (!student) throw new NotFoundError("That student could not be found.");
      const visit = await db.sickbayVisit.create({
        data: {
          schoolId: authCtx.schoolId,
          studentId: input.studentId,
          visitedAt,
          complaint: input.complaint,
          actionTaken: input.actionTaken ?? null,
          sentHome: input.sentHome ?? false,
          shareWithParent: input.shareWithParent ?? false,
          recordedBy: authCtx.userId,
          medications: {
            create: medications.map((m) => ({
              schoolId: authCtx.schoolId,
              name: m.name,
              dose: m.dose,
              givenAt: new Date(m.givenAt),
              givenBy: authCtx.userId,
            })),
          },
        },
        select: { id: true },
      });
      // Flags and counts only: the complaint is health data.
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.create,
          entityType: "sickbay_visit",
          entityId: visit.id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            studentId: input.studentId,
            sentHome: input.sentHome ?? false,
            shared: input.shareWithParent ?? false,
            medications: medications.length,
          },
        },
      });
      return visit;
    });

    // After the commit: a crash in between means a parent was not told (and
    // the visit shows "no one told"), never that a parent was told about a
    // visit that was not saved.
    await this.notifyGuardians(authCtx, created.id, reqCtx);
    return withTenant(authCtx.schoolId, async (db) => (await this.toDtos(db, await this.rowsWhere(db, { id: created.id })))[0]!);
  }

  // =========================================================================
  // POST /health/sickbay/visits/:id/medications — medicine given later
  // =========================================================================
  async addMedication(
    authCtx: AuthContext,
    visitId: string,
    input: AddSickbayMedicationInput,
    reqCtx: RequestContext,
  ): Promise<SickbayVisitDto> {
    await assertUserActiveAndHasOneOf(authCtx, RECORD_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const visit = await db.sickbayVisit.findUnique({ where: { id: visitId }, include: { _count: { select: { medications: true } } } });
      if (!visit) throw new NotFoundError("That visit could not be found.");
      if (visit.withdrawnAt) throw new ConflictError("SICKBAY_VISIT_WITHDRAWN", "That visit was withdrawn.");
      if (visit._count.medications >= SICKBAY_LIMITS.medicationsPerVisit) {
        throw new ValidationError(`A visit can list up to ${SICKBAY_LIMITS.medicationsPerVisit} medicines.`);
      }
      assertMedicationTimes([input], visit.visitedAt, Date.now());
      await db.sickbayMedication.create({
        data: {
          schoolId: authCtx.schoolId,
          visitId,
          name: input.name,
          dose: input.dose,
          givenAt: new Date(input.givenAt),
          givenBy: authCtx.userId,
        },
      });
      // The medicine's name and dose stay out of the audit log.
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.medication,
          entityType: "sickbay_visit",
          entityId: visitId,
          ipAddress: reqCtx.ipAddress,
          metadata: { studentId: visit.studentId },
        },
      });
      return (await this.toDtos(db, await this.rowsWhere(db, { id: visitId })))[0]!;
    });
  }

  // =========================================================================
  // POST /health/sickbay/visits/:id/withdraw — kept, marked withdrawn
  // =========================================================================
  /**
   * The parent no longer sees it. No second message goes out: the first one
   * named no complaint, so there is nothing to take back.
   */
  async withdrawVisit(authCtx: AuthContext, visitId: string, reqCtx: RequestContext): Promise<SickbayVisitDto> {
    await assertUserActiveAndHasOneOf(authCtx, RECORD_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const visit = await db.sickbayVisit.findUnique({ where: { id: visitId } });
      if (!visit) throw new NotFoundError("That visit could not be found.");
      if (visit.withdrawnAt) throw new ConflictError("SICKBAY_VISIT_ALREADY_WITHDRAWN", "That visit was already withdrawn.");
      await db.sickbayVisit.update({ where: { id: visitId }, data: { withdrawnAt: new Date(), withdrawnBy: authCtx.userId } });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.withdraw,
          entityType: "sickbay_visit",
          entityId: visitId,
          ipAddress: reqCtx.ipAddress,
          metadata: { studentId: visit.studentId },
        },
      });
      return (await this.toDtos(db, await this.rowsWhere(db, { id: visitId })))[0]!;
    });
  }

  // =========================================================================
  // GET /health/sickbay/visits?date=|studentId= — one day, or one child
  // =========================================================================
  async listVisits(authCtx: AuthContext, query: SickbayVisitListQuery, reqCtx: RequestContext): Promise<SickbayVisitListResponse> {
    await assertUserActiveAndHasOneOf(authCtx, RECORD_ROLES);
    const day = query.studentId ? null : (query.date ?? sickbayDayOf(new Date()));
    return withTenant(authCtx.schoolId, async (db) => {
      const where = query.studentId ? { studentId: query.studentId } : { visitedAt: dayBounds(day!) };
      const rows = await this.rowsWhere(db, where, query.studentId ? 50 : 200);
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.read,
          entityType: query.studentId ? "student" : "sickbay_day",
          entityId: query.studentId ?? day!,
          ipAddress: reqCtx.ipAddress,
          metadata: { ...(query.studentId ? { studentId: query.studentId } : { day }), count: rows.length },
        },
      });
      return { data: await this.toDtos(db, rows) };
    });
  }

  // =========================================================================
  // GET /portal/students/:id/sickbay-visits — the parent's read
  // =========================================================================
  async visitsForGuardian(guardianCtx: GuardianAuthContext, studentId: string): Promise<PortalSickbayVisitListResponse> {
    return withTenant(guardianCtx.schoolId, (db) =>
      withGuardian(guardianCtx.guardianId, studentId, db, async (db2) => {
        const rows = await db2.sickbayVisit.findMany({
          where: { studentId, withdrawnAt: null },
          orderBy: { visitedAt: "desc" },
          take: 30,
          include: { medications: { orderBy: { givenAt: "asc" } } },
        });
        await db2.auditLog.create({
          data: {
            schoolId: guardianCtx.schoolId,
            userId: guardianCtx.guardianId,
            action: AUDIT.portalRead,
            entityType: "student",
            entityId: studentId,
            metadata: { studentId, principal: "guardian", count: rows.length },
          },
        });
        return {
          data: rows.map((v) => ({
            id: v.id,
            visitedAt: v.visitedAt,
            sentHome: v.sentHome,
            // Nothing from the visit's text leaves here unless it was shared.
            details: v.shareWithParent
              ? {
                  complaint: v.complaint,
                  actionTaken: v.actionTaken,
                  medications: v.medications.map((m) => ({ name: m.name, dose: m.dose, givenAt: m.givenAt })),
                }
              : null,
          })),
        };
      }),
    );
  }

  // =========================================================================

  /** Tell every linked guardian of a new visit, once each. */
  private async notifyGuardians(authCtx: AuthContext, visitId: string, reqCtx: RequestContext): Promise<void> {
    const ctx = await withTenant(authCtx.schoolId, async (db) => {
      const visit = await db.sickbayVisit.findUnique({ where: { id: visitId } });
      if (!visit || visit.withdrawnAt) return null;
      const school = await db.school.findUnique({
        where: { id: authCtx.schoolId },
        select: { name: true, smsSenderId: true, smsSenderStatus: true },
      });
      const student = await db.student.findUnique({ where: { id: visit.studentId }, select: { firstName: true } });
      const links = await db.studentGuardian.findMany({
        where: { studentId: visit.studentId },
        select: { guardian: { select: { id: true, phone: true } } },
      });
      return { visit, school, studentFirstName: student?.firstName ?? "Your child", guardians: links.map((l) => l.guardian) };
    });
    if (!ctx || !ctx.school) return;

    const counts: Record<DeliveryChannel, number> = { PUSH: 0, SMS: 0, NONE: 0 };
    const sender = smsSenderFor(ctx.school);
    const sms = buildSickbaySms({
      schoolName: ctx.school.name,
      studentFirstName: ctx.studentFirstName,
      visitedAt: ctx.visit.visitedAt,
    });

    for (const guardian of ctx.guardians) {
      // Claim FIRST: the unique (visit, guardian) row is what makes "once"
      // true across retries. skipDuplicates rather than catching a unique
      // violation, which would abort the surrounding transaction.
      const claimed = await withTenant(authCtx.schoolId, async (db) => {
        const inserted = await db.sickbayNotice.createMany({
          data: [{ schoolId: authCtx.schoolId, visitId, guardianId: guardian.id, channel: "NONE" }],
          skipDuplicates: true,
        });
        if (inserted.count === 0) return null;
        const row = await db.sickbayNotice.findUnique({
          where: { visitId_guardianId: { visitId, guardianId: guardian.id } },
          select: { id: true },
        });
        return row?.id ?? null;
      });
      if (!claimed) continue;

      const phone = guardian.phone ? normalizeNigerianPhone(guardian.phone) : null;
      // SMS only when the child was sent home (CP3-D6); otherwise push or nothing.
      let channel = await this.dispatch.notifyGuardian({
        schoolId: authCtx.schoolId,
        guardianId: guardian.id,
        title: ctx.school.name,
        body: SICKBAY_PUSH_BODY,
        data: { kind: "sickbay-visit", studentId: ctx.visit.studentId },
        smsAvailable: ctx.visit.sentHome && this.termii.isConfigured && !!phone,
      });
      if (channel === "SMS" && phone && ctx.visit.sentHome) {
        try {
          await this.termii.sendSms(phone, sms, sender);
        } catch (err) {
          this.logger.error(`Sickbay SMS to ${redactPhone(guardian.phone)} failed: ${String(err)}`);
          channel = "NONE";
        }
      } else if (channel === "SMS") {
        channel = "NONE";
      }
      counts[channel]++;
      await withTenant(authCtx.schoolId, (db) => db.sickbayNotice.update({ where: { id: claimed }, data: { channel } }));
    }

    await withTenant(authCtx.schoolId, (db) =>
      db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.notice,
          entityType: "sickbay_visit",
          entityId: visitId,
          ipAddress: reqCtx.ipAddress,
          metadata: { sentHome: ctx.visit.sentHome, push: counts.PUSH, sms: counts.SMS, none: counts.NONE },
        },
      }),
    );
  }

  private rowsWhere(db: Db, where: Record<string, unknown>, take = 1) {
    return db.sickbayVisit.findMany({
      where,
      orderBy: { visitedAt: "desc" },
      take,
      include: {
        medications: { orderBy: { givenAt: "asc" } },
        notices: { select: { channel: true } },
      },
    });
  }

  private async toDtos(db: Db, rows: Awaited<ReturnType<SickbayService["rowsWhere"]>>): Promise<SickbayVisitDto[]> {
    if (rows.length === 0) return [];
    const studentIds = [...new Set(rows.map((r) => r.studentId))];
    const students = await db.student.findMany({
      where: { id: { in: studentIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        enrollments: {
          where: { status: "ENROLLED" },
          orderBy: { createdAt: "desc" },
          select: { classArm: { select: { name: true } } },
          take: 1,
        },
      },
    });
    const student = new Map(students.map((s) => [s.id, s]));
    const userIds = [...new Set(rows.flatMap((r) => [r.recordedBy, ...r.medications.map((m) => m.givenBy)]))];
    const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } });
    const userName = new Map(users.map((u) => [u.id, fullName(u)]));
    // Phase 9 / CP6b.2 — a boarder is labelled with their hostel and room, so
    // the health officer knows whom to tell (§15 CP6b-D7).
    const boarder = await boarderLabels(db, rows[0]!.schoolId, studentIds);
    return rows.map((r) => {
      const s = student.get(r.studentId);
      return {
        id: r.id,
        studentId: r.studentId,
        studentName: s ? fullName(s) : "Unknown student",
        className: s?.enrollments[0]?.classArm.name ?? null,
        boarder: boarder.get(r.studentId) ?? null,
        visitedAt: r.visitedAt,
        complaint: r.complaint,
        actionTaken: r.actionTaken,
        sentHome: r.sentHome,
        shareWithParent: r.shareWithParent,
        recordedByName: userName.get(r.recordedBy) ?? null,
        medications: r.medications.map((m) => ({
          id: m.id,
          name: m.name,
          dose: m.dose,
          givenAt: m.givenAt,
          givenByName: userName.get(m.givenBy) ?? null,
        })),
        notices: {
          push: r.notices.filter((n) => n.channel === "PUSH").length,
          sms: r.notices.filter((n) => n.channel === "SMS").length,
          none: r.notices.filter((n) => n.channel === "NONE").length,
        },
        withdrawnAt: r.withdrawnAt,
      };
    });
  }
}
