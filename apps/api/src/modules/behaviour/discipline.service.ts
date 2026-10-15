import { Injectable, Logger } from "@nestjs/common";

import { withGuardian, withTenant } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  describeDisciplineNotice,
  formatDisciplineDate,
  type CreateDisciplineActionInput,
  type DecideDisciplineActionInput,
  type DisciplineActionDto,
  type DisciplineActionStatus,
  type DisciplineListQuery,
  type DisciplineListResponse,
  type DisciplineNotifiedType,
  type PortalDisciplineNoticeDto,
  type PortalDisciplineNoticeListResponse,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { assertUserActiveAndHasOneOf, getActiveUserRoleKeys } from "../../common/auth/role-check.js";
import { redactPhone } from "../../common/redact.js";
import { smsSenderFor } from "../../common/termii/sms-sender.js";
import { normalizeNigerianPhone, TermiiService } from "../../common/termii/termii.service.js";
import { NotificationDispatchService, type DeliveryChannel } from "../notifications/notification-dispatch.service.js";
import { assertTeachesStudent } from "./teaches-student.js";

// Phase 9 / CP2.3 — discipline actions (docs/modules/phase-9.md §9 CP2-D3,
// CP2-D4, CP2-D6).
//
// A teacher PROPOSES. An owner or admin DECIDES. No one decides their own
// proposal: an admin's waits for the owner or another admin, and the owner's
// own are approved when made, because there is no one above the owner.
// Withdrawn, never deleted.
//
// Parents hear about approved SUSPENSIONS and EXCLUSIONS only, once per
// guardian per action (a unique `discipline_notices` row), by push when they
// have a live app and SMS otherwise. The push text names no child and no
// action; the SMS names the child's first name, the action and its dates, and
// never the reason. Nothing here reaches a model (C15).

const AUDIT = {
  propose: "discipline.propose",
  decide: "discipline.decide",
  withdraw: "discipline.withdraw",
  read: "discipline.read",
  notice: "discipline.notice",
} as const;

/** The locked-screen text (CP2-D4). No child, no action, no dates. */
export const DISCIPLINE_PUSH_BODY = "The school has sent you a notice. Open the app to read it.";

const NOTIFIED_TYPES: ReadonlySet<string> = new Set<DisciplineNotifiedType>(["SUSPENSION", "EXCLUSION"]);

type Db = Parameters<Parameters<typeof withTenant>[1]>[0];

interface RequestContext {
  ipAddress: string | null;
}

const asIsoDate = (value: Date): string => value.toISOString().slice(0, 10);
const fullName = (u: { firstName: string; lastName: string }): string => `${u.firstName} ${u.lastName}`;
const dateFrom = (iso: string | undefined): Date | null => (iso ? new Date(`${iso}T00:00:00.000Z`) : null);

/** The SMS a guardian without a live app receives. No reason text, ever. */
export function buildDisciplineSms(input: {
  schoolName: string;
  kind: "SENT" | "WITHDRAWN";
  studentFirstName: string;
  type: DisciplineNotifiedType;
  startOn: string;
  endOn: string | null;
  decidedOn: string;
}): string {
  if (input.kind === "WITHDRAWN") {
    return `${input.schoolName}: The notice of ${formatDisciplineDate(input.decidedOn)} has been withdrawn.`;
  }
  // "Suspended from 20 Oct to 22 Oct 2026" → "has been suspended from …".
  const what = describeDisciplineNotice(input);
  const phrase = what.charAt(0).toLowerCase() + what.slice(1);
  return `${input.schoolName}: ${input.studentFirstName} has been ${phrase}. Please contact the school.`;
}

type ActionRow = {
  id: string;
  studentId: string;
  recordId: string | null;
  incidentId: string | null;
  type: DisciplineActionDto["type"];
  startOn: Date | null;
  endOn: Date | null;
  reason: string;
  status: DisciplineActionStatus;
  proposedBy: string;
  proposedAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionReason: string | null;
  withdrawnAt: Date | null;
};

@Injectable()
export class DisciplineService {
  private readonly logger = new Logger(DisciplineService.name);

  constructor(
    private readonly dispatch: NotificationDispatchService,
    private readonly termii: TermiiService,
  ) {}

  // =========================================================================
  // POST /behaviour/discipline — propose (the owner's own: approved at once)
  // =========================================================================
  async propose(
    authCtx: AuthContext,
    dto: CreateDisciplineActionInput,
    reqCtx: RequestContext,
  ): Promise<DisciplineActionDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);
    const roles = await getActiveUserRoleKeys(authCtx);
    const isOwner = roles.includes("owner");
    const isAdmin = isOwner || roles.includes("admin");

    const created = await withTenant(authCtx.schoolId, async (db) => {
      const student = await db.student.findUnique({ where: { id: dto.studentId }, select: { id: true } });
      if (!student) throw new NotFoundError("That student could not be found.");
      if (!isAdmin) await assertTeachesStudent(db, authCtx.userId, dto.studentId);

      if (dto.recordId) {
        const record = await db.behaviourRecord.findUnique({ where: { id: dto.recordId }, select: { studentId: true } });
        if (!record || record.studentId !== dto.studentId) {
          throw new ValidationError("That record is not about this student.");
        }
      }
      if (dto.incidentId) {
        const part = await db.behaviourRecord.findFirst({
          where: { incidentId: dto.incidentId, studentId: dto.studentId },
          select: { id: true },
        });
        if (!part) throw new ValidationError("This student is not part of that incident.");
      }

      const now = new Date();
      // CP2-D3: the owner has no one above them, so their own proposal is
      // approved when made, and recorded as proposed and approved by them.
      const row = await db.disciplineAction.create({
        data: {
          schoolId: authCtx.schoolId,
          studentId: dto.studentId,
          recordId: dto.recordId ?? null,
          incidentId: dto.incidentId ?? null,
          type: dto.type,
          startOn: dateFrom(dto.startOn),
          endOn: dateFrom(dto.endOn),
          reason: dto.reason,
          proposedBy: authCtx.userId,
          ...(isOwner ? { status: "APPROVED" as const, decidedBy: authCtx.userId, decidedAt: now } : {}),
        },
      });

      // The type and dates go in the audit log; the reason never does.
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.propose,
          entityType: "discipline_action",
          entityId: row.id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            studentId: dto.studentId,
            type: dto.type,
            startOn: dto.startOn ?? null,
            endOn: dto.endOn ?? null,
            approvedOnProposal: isOwner,
          },
        },
      });
      return row;
    });

    if (created.status === "APPROVED") await this.notifyGuardians(authCtx, created.id, "SENT", reqCtx);
    return this.getOne(authCtx, created.id);
  }

  // =========================================================================
  // POST /behaviour/discipline/:id/decide — approve, or reject with a reason
  // =========================================================================
  async decide(
    authCtx: AuthContext,
    id: string,
    dto: DecideDisciplineActionInput,
    reqCtx: RequestContext,
  ): Promise<DisciplineActionDto> {
    // The guard checked `behaviour.decide`; the role is checked again here,
    // as every other write does (CP2-D5).
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    const status = await withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.disciplineAction.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError("That action could not be found.");
      if (existing.proposedBy === authCtx.userId) {
        throw new ForbiddenError("You cannot decide your own proposal. The owner or another admin decides it.");
      }
      if (existing.status !== "PROPOSED") {
        throw new ConflictError("DISCIPLINE_ALREADY_DECIDED", "That action has already been decided or withdrawn.");
      }
      const next = dto.decision === "APPROVE" ? ("APPROVED" as const) : ("REJECTED" as const);
      // Conditional on still being PROPOSED, so two admins clicking at once
      // cannot both decide it (and cannot both send the parent notice).
      const changed = await db.disciplineAction.updateMany({
        where: { id, status: "PROPOSED" },
        data: {
          status: next,
          decidedBy: authCtx.userId,
          decidedAt: new Date(),
          decisionReason: dto.reason && dto.reason.length > 0 ? dto.reason : null,
        },
      });
      if (changed.count === 0) {
        throw new ConflictError("DISCIPLINE_ALREADY_DECIDED", "That action has already been decided or withdrawn.");
      }
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.decide,
          entityType: "discipline_action",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: { studentId: existing.studentId, type: existing.type, decision: next },
        },
      });
      return next;
    });

    if (status === "APPROVED") await this.notifyGuardians(authCtx, id, "SENT", reqCtx);
    return this.getOne(authCtx, id);
  }

  // =========================================================================
  // POST /behaviour/discipline/:id/withdraw — before or after the decision
  // =========================================================================
  async withdraw(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<DisciplineActionDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);
    const isAdmin = await this.isAdmin(authCtx);

    const wasApproved = await withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.disciplineAction.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError("That action could not be found.");
      if (!isAdmin && existing.proposedBy !== authCtx.userId) {
        throw new ForbiddenError("You can only withdraw an action you proposed.");
      }
      if (existing.status === "WITHDRAWN") {
        throw new ConflictError("DISCIPLINE_ALREADY_WITHDRAWN", "That action was already withdrawn.");
      }
      if (existing.status === "REJECTED") {
        throw new ConflictError("DISCIPLINE_REJECTED", "A rejected action has nothing to withdraw.");
      }
      const changed = await db.disciplineAction.updateMany({
        where: { id, status: existing.status },
        data: { status: "WITHDRAWN", withdrawnBy: authCtx.userId, withdrawnAt: new Date() },
      });
      if (changed.count === 0) {
        throw new ConflictError("DISCIPLINE_ALREADY_WITHDRAWN", "That action was already withdrawn.");
      }
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.withdraw,
          entityType: "discipline_action",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: { studentId: existing.studentId, type: existing.type, previousStatus: existing.status },
        },
      });
      return existing.status === "APPROVED";
    });

    // Guardians who were told get one withdrawal notice; nobody else does.
    if (wasApproved) await this.notifyGuardians(authCtx, id, "WITHDRAWN", reqCtx);
    return this.getOne(authCtx, id);
  }

  // =========================================================================
  // GET /behaviour/discipline?studentId=&status=
  // =========================================================================
  /**
   * An owner or admin sees every action. A teacher sees a student's actions
   * when they teach that student (the same rule as the student's records),
   * and otherwise only the ones they proposed.
   */
  async list(authCtx: AuthContext, query: DisciplineListQuery, reqCtx: RequestContext): Promise<DisciplineListResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);
    const isAdmin = await this.isAdmin(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      if (!isAdmin && query.studentId) await assertTeachesStudent(db, authCtx.userId, query.studentId);
      const rows = await db.disciplineAction.findMany({
        where: {
          ...(query.studentId ? { studentId: query.studentId } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(!isAdmin && !query.studentId ? { proposedBy: authCtx.userId } : {}),
        },
        orderBy: { proposedAt: "desc" },
        take: 200,
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.read,
          entityType: "discipline_action",
          entityId: query.studentId ?? null,
          ipAddress: reqCtx.ipAddress,
          metadata: { count: rows.length, ...(query.status ? { status: query.status } : {}) },
        },
      });
      return { data: await this.toDtos(db, authCtx, isAdmin, rows) };
    });
  }

  // =========================================================================
  // GET /portal/students/:id/discipline-notices — the parent's card
  // =========================================================================
  /**
   * Approved suspensions and exclusions only, and withdrawn ones that had
   * been approved (shown as withdrawn rather than hidden). The returned type
   * has no field for a reason, a note, an incident or a proposer.
   */
  async listNoticesForGuardian(
    guardianCtx: GuardianAuthContext,
    studentId: string,
  ): Promise<PortalDisciplineNoticeListResponse> {
    const rows = await withTenant(guardianCtx.schoolId, (db) =>
      withGuardian(guardianCtx.guardianId, studentId, db, (db2) =>
        db2.disciplineAction.findMany({
          where: {
            studentId,
            type: { in: ["SUSPENSION", "EXCLUSION"] },
            decidedAt: { not: null },
            // A rejected action has a decision too; only approval counts. A
            // withdrawn one with a decision was approved first, since a
            // rejected action cannot be withdrawn.
            status: { in: ["APPROVED", "WITHDRAWN"] },
          },
          select: { id: true, type: true, startOn: true, endOn: true, decidedAt: true, withdrawnAt: true },
          orderBy: { decidedAt: "desc" },
          take: 50,
        }),
      ),
    );
    const data: PortalDisciplineNoticeDto[] = rows
      .filter((r) => r.startOn && r.decidedAt)
      .map((r) => ({
        id: r.id,
        type: r.type as DisciplineNotifiedType,
        startOn: asIsoDate(r.startOn!),
        endOn: r.endOn ? asIsoDate(r.endOn) : null,
        decidedOn: asIsoDate(r.decidedAt!),
        withdrawnOn: r.withdrawnAt ? asIsoDate(r.withdrawnAt) : null,
      }));
    return { data };
  }

  // =========================================================================

  private async getOne(authCtx: AuthContext, id: string): Promise<DisciplineActionDto> {
    const isAdmin = await this.isAdmin(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.disciplineAction.findUnique({ where: { id } });
      if (!row) throw new NotFoundError("That action could not be found.");
      const [dto] = await this.toDtos(db, authCtx, isAdmin, [row]);
      return dto!;
    });
  }

  /**
   * Tell every linked guardian, once each. Runs after the decision has been
   * committed: a crash between the two means a parent was not told (and the
   * staff page shows "0 guardians notified"), never that a parent was told
   * about a decision that did not happen.
   */
  private async notifyGuardians(
    authCtx: AuthContext,
    actionId: string,
    kind: "SENT" | "WITHDRAWN",
    reqCtx: RequestContext,
  ): Promise<void> {
    const ctx = await withTenant(authCtx.schoolId, async (db) => {
      const action = await db.disciplineAction.findUnique({ where: { id: actionId } });
      if (!action || !NOTIFIED_TYPES.has(action.type) || !action.startOn || !action.decidedAt) return null;
      const school = await db.school.findUnique({
        where: { id: authCtx.schoolId },
        select: { name: true, smsSenderId: true, smsSenderStatus: true },
      });
      const student = await db.student.findUnique({ where: { id: action.studentId }, select: { firstName: true } });
      const links = await db.studentGuardian.findMany({
        where: { studentId: action.studentId },
        select: { guardian: { select: { id: true, phone: true } } },
      });
      // A withdrawal goes only to the guardians who were told in the first place.
      const alreadyTold =
        kind === "WITHDRAWN"
          ? new Set(
              (await db.disciplineNotice.findMany({ where: { actionId, kind: "SENT" }, select: { guardianId: true } })).map(
                (n) => n.guardianId,
              ),
            )
          : null;
      return {
        action,
        school,
        studentFirstName: student?.firstName ?? "Your child",
        guardians: links.map((l) => l.guardian).filter((g) => !alreadyTold || alreadyTold.has(g.id)),
      };
    });
    if (!ctx || !ctx.school) return;

    const counts: Record<DeliveryChannel, number> = { PUSH: 0, SMS: 0, NONE: 0 };
    const sender = smsSenderFor(ctx.school);
    const sms = buildDisciplineSms({
      schoolName: ctx.school.name,
      kind,
      studentFirstName: ctx.studentFirstName,
      type: ctx.action.type as DisciplineNotifiedType,
      startOn: asIsoDate(ctx.action.startOn!),
      endOn: ctx.action.endOn ? asIsoDate(ctx.action.endOn) : null,
      decidedOn: asIsoDate(ctx.action.decidedAt!),
    });

    for (const guardian of ctx.guardians) {
      // Claim FIRST: the unique (action, guardian, kind) row is what makes
      // "once" true across retries and double clicks.
      // skipDuplicates rather than catching a unique violation, which would
      // abort the surrounding transaction.
      const claimed = await withTenant(authCtx.schoolId, async (db) => {
        const inserted = await db.disciplineNotice.createMany({
          data: [{ schoolId: authCtx.schoolId, actionId, guardianId: guardian.id, kind, channel: "NONE" }],
          skipDuplicates: true,
        });
        if (inserted.count === 0) return null;
        const row = await db.disciplineNotice.findUnique({
          where: { actionId_guardianId_kind: { actionId, guardianId: guardian.id, kind } },
          select: { id: true },
        });
        return row?.id ?? null;
      });
      if (!claimed) continue;

      const phone = guardian.phone ? normalizeNigerianPhone(guardian.phone) : null;
      let channel = await this.dispatch.notifyGuardian({
        schoolId: authCtx.schoolId,
        guardianId: guardian.id,
        title: ctx.school.name,
        body: DISCIPLINE_PUSH_BODY,
        data: { kind: "discipline-notice", studentId: ctx.action.studentId },
        smsAvailable: this.termii.isConfigured && !!phone,
      });
      if (channel === "SMS" && phone) {
        try {
          await this.termii.sendSms(phone, sms, sender);
        } catch (err) {
          this.logger.error(`Discipline notice SMS to ${redactPhone(guardian.phone)} failed: ${String(err)}`);
          channel = "NONE";
        }
      } else if (channel === "SMS") {
        channel = "NONE";
      }
      counts[channel]++;
      await withTenant(authCtx.schoolId, (db) =>
        db.disciplineNotice.update({ where: { id: claimed }, data: { channel } }),
      );
    }

    await withTenant(authCtx.schoolId, (db) =>
      db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.notice,
          entityType: "discipline_action",
          entityId: actionId,
          ipAddress: reqCtx.ipAddress,
          metadata: { kind, push: counts.PUSH, sms: counts.SMS, none: counts.NONE },
        },
      }),
    );
  }

  private async toDtos(db: Db, authCtx: AuthContext, isAdmin: boolean, rows: ActionRow[]): Promise<DisciplineActionDto[]> {
    if (rows.length === 0) return [];
    const students = await db.student.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.studentId))] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const studentName = new Map(students.map((s) => [s.id, fullName(s)]));
    const userIds = new Set<string>();
    for (const r of rows) {
      userIds.add(r.proposedBy);
      if (r.decidedBy) userIds.add(r.decidedBy);
    }
    const users = await db.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const name = new Map(users.map((u) => [u.id, fullName(u)]));
    const notices = await db.disciplineNotice.groupBy({
      by: ["actionId"],
      where: { actionId: { in: rows.map((r) => r.id) }, kind: "SENT", channel: { not: "NONE" } },
      _count: { _all: true },
    });
    const notified = new Map(notices.map((n) => [n.actionId, n._count._all]));

    return rows.map((r) => ({
      id: r.id,
      studentId: r.studentId,
      studentName: studentName.get(r.studentId) ?? "Student",
      type: r.type,
      startOn: r.startOn ? asIsoDate(r.startOn) : null,
      endOn: r.endOn ? asIsoDate(r.endOn) : null,
      reason: r.reason,
      status: r.status,
      recordId: r.recordId,
      incidentId: r.incidentId,
      proposedByName: name.get(r.proposedBy) ?? null,
      proposedAt: r.proposedAt,
      decidedByName: r.decidedBy ? (name.get(r.decidedBy) ?? null) : null,
      decidedAt: r.decidedAt,
      decisionReason: r.decisionReason,
      withdrawnAt: r.withdrawnAt,
      guardiansNotified: notified.get(r.id) ?? 0,
      canDecide: isAdmin && r.status === "PROPOSED" && r.proposedBy !== authCtx.userId,
      canWithdraw:
        (r.status === "PROPOSED" || r.status === "APPROVED") && (isAdmin || r.proposedBy === authCtx.userId),
    }));
  }

  private async isAdmin(authCtx: AuthContext): Promise<boolean> {
    const roles = await getActiveUserRoleKeys(authCtx);
    return roles.includes("owner") || roles.includes("admin");
  }
}
