import { Injectable, Logger } from "@nestjs/common";

import { withGuardian, withTenant, type PrismaClient } from "@school-kit/db";
import {
  ConflictError,
  formatSickbayDay,
  NotFoundError,
  ValidationError,
  HOSTEL_EXEAT_LIMITS,
  type ApproveHostelExeatInput,
  type HostelExeatBackInput,
  type HostelExeatDto,
  type HostelExeatLeftInput,
  type HostelExeatStatus,
  type ListHostelExeatsInput,
  type PortalHostelExeatDto,
  type RefuseHostelExeatInput,
  type RequestHostelExeatInput,
  type StaffHostelExeatInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { redactPhone } from "../../common/redact.js";
import { smsSenderFor } from "../../common/termii/sms-sender.js";
import { normalizeNigerianPhone, TermiiService } from "../../common/termii/termii.service.js";
import { NotificationDispatchService, type DeliveryChannel } from "../notifications/notification-dispatch.service.js";
import { currentTerm, houseKeeper, kept, type Keeper } from "./hostel-house.service.js";

// Phase 9 / CP6b.3 — exeats, a boarder's leave out (docs/modules/phase-9.md
// §15 CP6b-D6; owner's answer 5 in §15.8).
//
// ASKING. Any guardian linked to the child may ask, through withGuardian,
// naming who will collect. The school may enter a request taken by phone. The
// child must hold a bed this term, and may not have another open leave out
// overlapping the same time.
//
// DECIDING. The house master of the child's hostel (or owner or admin)
// approves, or refuses with a note. Every linked guardian is told: push when
// the app can reach them, else SMS where the school sends SMS.
//
// THE DAY. Left (and who actually collected the child, if not the person
// named), then back. Out past the time agreed shows as LATE, on the list and
// to the parent, in words; nothing is sent automatically.
//
// STATUSES only move forward: REQUESTED → APPROVED or REFUSED → OUT → BACK,
// or CANCELLED before the child leaves. Each move is a conditional update on
// the status it expects, so two people acting at once cannot both win.

const OPEN: HostelExeatStatus[] = ["REQUESTED", "APPROVED", "OUT"];
const PAST: HostelExeatStatus[] = ["REFUSED", "BACK", "CANCELLED"];
const CANCELLABLE: HostelExeatStatus[] = ["REQUESTED", "APPROVED"];
/** A clock a few minutes fast must not refuse "now". */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const AUDIT = {
  request: "hostel.exeat.request",
  approve: "hostel.exeat.approve",
  refuse: "hostel.exeat.refuse",
  out: "hostel.exeat.out",
  back: "hostel.exeat.back",
  cancel: "hostel.exeat.cancel",
  notice: "hostel.exeat.notice",
} as const;

type Db = PrismaClient;
interface RequestContext {
  ipAddress: string | null;
}
type Actor = { userId: string } | { guardianId: string };

@Injectable()
export class HostelExeatService {
  private readonly logger = new Logger(HostelExeatService.name);

  constructor(
    private readonly dispatch: NotificationDispatchService,
    private readonly termii: TermiiService,
  ) {}

  // ─── The house master's side ──────────────────────────────────────────────

  /** A hostel's open leave outs (waiting, approved, out), or its recent past ones. */
  async list(authCtx: AuthContext, hostelId: string, query: ListHostelExeatsInput): Promise<HostelExeatDto[]> {
    const keeper = await houseKeeper(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      await kept(db, authCtx.schoolId, keeper, hostelId);
      const past = query.view === "past";
      const rows = await db.hostelExeat.findMany({
        where: { schoolId: authCtx.schoolId, hostelId, status: { in: past ? PAST : OPEN } },
        orderBy: past ? { outAt: "desc" } : { outAt: "asc" },
        take: past ? 50 : 200,
        select: { id: true },
      });
      return readExeats(db, rows.map((r) => r.id));
    });
  }

  /** A request taken by phone, entered by the school. */
  async createForStaff(authCtx: AuthContext, hostelId: string, input: StaffHostelExeatInput, req: RequestContext): Promise<HostelExeatDto> {
    const keeper = await houseKeeper(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      await kept(db, authCtx.schoolId, keeper, hostelId);
      const bed = await boarderBed(db, authCtx.schoolId, input.studentId);
      if (!bed || bed.hostelId !== hostelId) throw new NotFoundError("That student is not a boarder in this hostel this term.");
      const id = await createExeat(db, authCtx.schoolId, bed.hostelId, input.studentId, input, { userId: authCtx.userId });
      await audit(db, authCtx.schoolId, authCtx.userId, req, AUDIT.request, id, { studentId: input.studentId, by: "school" });
      return (await readExeats(db, [id]))[0]!;
    });
  }

  async approve(authCtx: AuthContext, id: string, input: ApproveHostelExeatInput, req: RequestContext): Promise<HostelExeatDto> {
    const dto = await this.move(authCtx, id, ["REQUESTED"], "APPROVED", req, AUDIT.approve, {
      decidedBy: authCtx.userId,
      decidedAt: new Date(),
      decisionNote: input.note ?? null,
    });
    await this.tellParents(authCtx, dto, req);
    return dto;
  }

  /** Refused, with a note the parent will read. Also withdraws an approval before the child leaves. */
  async refuse(authCtx: AuthContext, id: string, input: RefuseHostelExeatInput, req: RequestContext): Promise<HostelExeatDto> {
    const dto = await this.move(authCtx, id, ["REQUESTED", "APPROVED"], "REFUSED", req, AUDIT.refuse, {
      decidedBy: authCtx.userId,
      decidedAt: new Date(),
      decisionNote: input.note,
    });
    await this.tellParents(authCtx, dto, req);
    return dto;
  }

  async left(authCtx: AuthContext, id: string, input: HostelExeatLeftInput, req: RequestContext): Promise<HostelExeatDto> {
    return this.move(authCtx, id, ["APPROVED"], "OUT", req, AUDIT.out, {
      leftAt: momentNotInFuture(input.at, "The child can't leave in the future."),
      collectedBy: input.collectedBy ?? null,
    });
  }

  async back(authCtx: AuthContext, id: string, input: HostelExeatBackInput, req: RequestContext): Promise<HostelExeatDto> {
    const at = momentNotInFuture(input.at, "The child can't come back in the future.");
    return this.move(authCtx, id, ["OUT"], "BACK", req, AUDIT.back, { backAt: at }, (row) => {
      if (row.leftAt && at < row.leftAt) throw new ValidationError("The child can't come back before they left.");
    });
  }

  async cancelForStaff(authCtx: AuthContext, id: string, req: RequestContext): Promise<HostelExeatDto> {
    return this.move(authCtx, id, CANCELLABLE, "CANCELLED", req, AUDIT.cancel, { cancelledAt: new Date() });
  }

  // ─── The parent's side ────────────────────────────────────────────────────

  async listForGuardian(guardianCtx: GuardianAuthContext, studentId: string): Promise<PortalHostelExeatDto[]> {
    return withTenant(guardianCtx.schoolId, (db) =>
      withGuardian(guardianCtx.guardianId, studentId, db, async (db2) => {
        const rows = await db2.hostelExeat.findMany({
          where: { schoolId: guardianCtx.schoolId, studentId },
          orderBy: { outAt: "desc" },
          take: 20,
          select: { id: true },
        });
        return (await readExeats(db2, rows.map((r) => r.id))).map(portalDto);
      }),
    );
  }

  async requestForGuardian(guardianCtx: GuardianAuthContext, studentId: string, input: RequestHostelExeatInput, req: RequestContext): Promise<PortalHostelExeatDto> {
    return withTenant(guardianCtx.schoolId, (db) =>
      withGuardian(guardianCtx.guardianId, studentId, db, async (db2) => {
        const bed = await boarderBed(db2, guardianCtx.schoolId, studentId);
        if (!bed) throw new ConflictError("NOT_A_BOARDER", "Your child does not have a hostel bed this term.");
        const id = await createExeat(db2, guardianCtx.schoolId, bed.hostelId, studentId, input, { guardianId: guardianCtx.guardianId });
        await audit(db2, guardianCtx.schoolId, null, req, AUDIT.request, id, { studentId, by: "parent", guardianId: guardianCtx.guardianId });
        return portalDto((await readExeats(db2, [id]))[0]!);
      }),
    );
  }

  async cancelForGuardian(guardianCtx: GuardianAuthContext, studentId: string, id: string, req: RequestContext): Promise<PortalHostelExeatDto> {
    return withTenant(guardianCtx.schoolId, (db) =>
      withGuardian(guardianCtx.guardianId, studentId, db, async (db2) => {
        const row = await db2.hostelExeat.findFirst({ where: { id, schoolId: guardianCtx.schoolId, studentId }, select: { status: true } });
        if (!row) throw new NotFoundError("Leave out not found.");
        const done = await db2.hostelExeat.updateMany({
          where: { id, status: { in: CANCELLABLE } },
          data: { status: "CANCELLED", cancelledAt: new Date() },
        });
        if (done.count === 0) throw stateError(row.status, "CANCELLED");
        await audit(db2, guardianCtx.schoolId, null, req, AUDIT.cancel, id, { by: "parent", guardianId: guardianCtx.guardianId });
        return portalDto((await readExeats(db2, [id]))[0]!);
      }),
    );
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  /** One forward move, conditional on the status it expects. */
  private async move(
    authCtx: AuthContext,
    id: string,
    from: HostelExeatStatus[],
    to: HostelExeatStatus,
    req: RequestContext,
    action: string,
    data: Record<string, unknown>,
    check?: (row: { leftAt: Date | null }) => void,
  ): Promise<HostelExeatDto> {
    const keeper = await houseKeeper(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await keptExeat(db, authCtx.schoolId, keeper, id);
      check?.(row);
      const done = await db.hostelExeat.updateMany({ where: { id, status: { in: from } }, data: { status: to, ...data } });
      if (done.count === 0) throw stateError(row.status, to);
      await audit(db, authCtx.schoolId, authCtx.userId, req, action, id, { hostelId: row.hostelId, studentId: row.studentId });
      return (await readExeats(db, [id]))[0]!;
    });
  }

  /** Tells every linked guardian of the decision: push if the app reaches them, else SMS. */
  private async tellParents(authCtx: AuthContext, exeat: HostelExeatDto, req: RequestContext): Promise<void> {
    const ctx = await withTenant(authCtx.schoolId, async (db) => {
      const school = await db.school.findUnique({
        where: { id: authCtx.schoolId },
        select: { name: true, smsSenderId: true, smsSenderStatus: true },
      });
      const student = await db.student.findUnique({ where: { id: exeat.studentId }, select: { firstName: true } });
      const links = await db.studentGuardian.findMany({
        where: { studentId: exeat.studentId },
        select: { guardian: { select: { id: true, phone: true } } },
      });
      return { school, firstName: student?.firstName ?? "Your child", guardians: links.map((l) => l.guardian) };
    });
    if (!ctx.school) return;
    const message = exeatDecisionMessage(ctx.firstName, exeat);
    const counts: Record<DeliveryChannel, number> = { PUSH: 0, SMS: 0, NONE: 0 };
    for (const guardian of ctx.guardians) {
      const phone = guardian.phone ? normalizeNigerianPhone(guardian.phone) : null;
      let channel = await this.dispatch.notifyGuardian({
        schoolId: authCtx.schoolId,
        guardianId: guardian.id,
        title: ctx.school.name,
        body: message,
        data: { kind: "hostel-exeat", studentId: exeat.studentId },
        smsAvailable: this.termii.isConfigured && !!phone,
      });
      if (channel === "SMS" && phone) {
        try {
          await this.termii.sendSms(phone, `${ctx.school.name}: ${message}`, smsSenderFor(ctx.school));
        } catch (err) {
          this.logger.error(`Exeat SMS to ${redactPhone(guardian.phone)} failed: ${String(err)}`);
          channel = "NONE";
        }
      } else if (channel === "SMS") {
        channel = "NONE";
      }
      counts[channel]++;
    }
    await withTenant(authCtx.schoolId, (db) =>
      audit(db, authCtx.schoolId, authCtx.userId, req, AUDIT.notice, exeat.id, { status: exeat.status, push: counts.PUSH, sms: counts.SMS, none: counts.NONE }),
    );
  }
}

/** "Adaeze's leave out on 18 Oct 2026 was approved." The refusal note stays in the app. */
export function exeatDecisionMessage(firstName: string, exeat: Pick<HostelExeatDto, "status" | "outAt">): string {
  const day = formatSickbayDay(exeat.outAt);
  return exeat.status === "APPROVED"
    ? `${firstName}'s leave out on ${day} was approved.`
    : `${firstName}'s leave out on ${day} was not approved. Open the app to see why.`;
}

async function boarderBed(db: Db, schoolId: string, studentId: string) {
  const term = await currentTerm(db, schoolId);
  if (!term) return null;
  const student = await db.student.findFirst({ where: { id: studentId, schoolId }, select: { status: true } });
  if (!student || student.status !== "ACTIVE") return null;
  return db.hostelBed.findFirst({ where: { schoolId, studentId, termId: term.id }, select: { hostelId: true } });
}

async function createExeat(db: Db, schoolId: string, hostelId: string, studentId: string, input: RequestHostelExeatInput, by: Actor): Promise<string> {
  const outAt = new Date(input.outAt);
  const backBy = new Date(input.backBy);
  const now = Date.now();
  if (backBy <= outAt) throw new ValidationError("The time back must be after the time out.");
  if (backBy.getTime() < now - CLOCK_SKEW_MS) throw new ValidationError("The time back has already passed.");
  if (backBy.getTime() - outAt.getTime() > HOSTEL_EXEAT_LIMITS.maxDays * DAY_MS) {
    throw new ValidationError(`A leave out can be at most ${HOSTEL_EXEAT_LIMITS.maxDays} days.`);
  }
  if (outAt.getTime() > now + HOSTEL_EXEAT_LIMITS.aheadDays * DAY_MS) {
    throw new ValidationError(`Ask at most ${HOSTEL_EXEAT_LIMITS.aheadDays} days ahead.`);
  }
  const overlapping = await db.hostelExeat.count({
    where: { schoolId, studentId, status: { in: OPEN }, outAt: { lt: backBy }, backBy: { gt: outAt } },
  });
  if (overlapping > 0) throw new ConflictError("EXEAT_OVERLAPS", "There is already a leave out for this child at that time.");
  const row = await db.hostelExeat.create({
    data: {
      schoolId,
      hostelId,
      studentId,
      outAt,
      backBy,
      reason: input.reason,
      collectorName: input.collectorName,
      collectorRelationship: input.collectorRelationship,
      collectorPhone: input.collectorPhone,
      requestedByGuardianId: "guardianId" in by ? by.guardianId : null,
      requestedByUserId: "userId" in by ? by.userId : null,
    },
    select: { id: true },
  });
  return row.id;
}

async function keptExeat(db: Db, schoolId: string, keeper: Keeper, id: string) {
  const row = await db.hostelExeat.findFirst({
    where: { id, schoolId },
    select: { hostelId: true, studentId: true, status: true, leftAt: true },
  });
  if (!row || (!keeper.all && !keeper.hostelIds.has(row.hostelId))) throw new NotFoundError("Leave out not found.");
  return row;
}

function momentNotInFuture(at: string | undefined, message: string): Date {
  const now = Date.now();
  const when = at ? new Date(at) : new Date(now);
  if (when.getTime() > now + CLOCK_SKEW_MS) throw new ValidationError(message);
  return when;
}

const STATE_MESSAGES: Record<HostelExeatStatus, string> = {
  REQUESTED: "That leave out is still waiting for a decision.",
  APPROVED: "That leave out was already approved.",
  REFUSED: "That leave out was not approved.",
  OUT: "The child has already left.",
  BACK: "The child is already back.",
  CANCELLED: "That leave out was cancelled.",
};

/** Why a move did not happen, said from where the leave out now stands. */
function stateError(current: HostelExeatStatus, wanted: HostelExeatStatus): ConflictError {
  const message = wanted === "OUT" && current === "REQUESTED" ? "Approve the leave out before the child leaves." : STATE_MESSAGES[current];
  return new ConflictError("EXEAT_WRONG_STATUS", message);
}

async function readExeats(db: Db, ids: string[]): Promise<HostelExeatDto[]> {
  if (ids.length === 0) return [];
  const rows = await db.hostelExeat.findMany({
    where: { id: { in: ids } },
    include: { student: { select: { firstName: true, lastName: true } }, hostel: { select: { name: true } } },
  });
  const userIds = [...new Set(rows.flatMap((r) => [r.requestedByUserId, r.decidedBy]).filter((v): v is string => !!v))];
  const guardianIds = [...new Set(rows.map((r) => r.requestedByGuardianId).filter((v): v is string => !!v))];
  type Named = { id: string; firstName: string; lastName: string };
  const none: Promise<Named[]> = Promise.resolve([]);
  const [users, guardians] = await Promise.all([
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }) : none,
    guardianIds.length ? db.guardian.findMany({ where: { id: { in: guardianIds } }, select: { id: true, firstName: true, lastName: true } }) : none,
  ]);
  const userName = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  const guardianName = new Map(guardians.map((g) => [g.id, `${g.firstName} ${g.lastName}`.trim()]));
  const order = new Map(ids.map((id, i) => [id, i]));
  const now = Date.now();
  return rows
    .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
    .map((r) => ({
      id: r.id,
      studentId: r.studentId,
      studentName: `${r.student.firstName} ${r.student.lastName}`.trim(),
      hostelName: r.hostel.name,
      outAt: r.outAt,
      backBy: r.backBy,
      reason: r.reason,
      collector: { name: r.collectorName, relationship: r.collectorRelationship, phone: r.collectorPhone },
      status: r.status,
      late: r.status === "OUT" && r.backBy.getTime() < now,
      returnedLate: r.status === "BACK" && !!r.backAt && r.backAt > r.backBy,
      requestedBy: r.requestedByGuardianId
        ? `Parent: ${guardianName.get(r.requestedByGuardianId) ?? "a parent"}`
        : `School: ${userName.get(r.requestedByUserId ?? "") ?? "staff"}`,
      decidedByName: r.decidedBy ? (userName.get(r.decidedBy) ?? null) : null,
      decidedAt: r.decidedAt,
      decisionNote: r.decisionNote,
      leftAt: r.leftAt,
      collectedBy: r.collectedBy,
      backAt: r.backAt,
      cancelledAt: r.cancelledAt,
    }));
}

function portalDto(e: HostelExeatDto): PortalHostelExeatDto {
  return {
    id: e.id,
    outAt: e.outAt,
    backBy: e.backBy,
    reason: e.reason,
    collector: e.collector,
    status: e.status,
    late: e.late,
    decisionNote: e.decisionNote,
    leftAt: e.leftAt,
    collectedBy: e.collectedBy,
    backAt: e.backAt,
    canCancel: CANCELLABLE.includes(e.status),
  };
}

async function audit(
  db: Db,
  schoolId: string,
  userId: string | null,
  req: RequestContext,
  action: string,
  entityId: string,
  metadata: Record<string, string | number | null>,
) {
  await db.auditLog.create({ data: { schoolId, userId, action, entityType: "hostel", entityId, ipAddress: req.ipAddress, metadata } });
}
