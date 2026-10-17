import { Injectable } from "@nestjs/common";

import { withGuardian, withTenant, type PrismaClient } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  sickbayDayOf,
  type HostelVisitDto,
  type HostelVisitLeftInput,
  type HouseBoardersDto,
  type HouseHostelDto,
  type ListHostelVisitsInput,
  type LogHostelVisitInput,
  type PortalStudentHostelDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { getActiveUserRoleKeys } from "../../common/auth/role-check.js";

// Phase 9 / CP6b.2 — what a house master keeps (docs/modules/phase-9.md §15
// CP6b-D4, D5, D7, D8; owner's answers §15.8).
//
// WHO. hostel.house is held by admin, teacher and the optional House master
// role. Owner and admin keep every hostel; anyone else keeps only the hostels
// they are assigned to on the hostel's page. Another hostel is "not found", as
// the question bank answers for a subject the teacher does not teach.
//
// THE SICKBAY. A house master sees only that a boarder was SENT HOME by the
// sickbay today, because that changes where the child is. Never the complaint,
// the action or a medicine, and nothing at all for a visit where the child
// stayed in school ("the less info the better", owner, §15.8).
//
// VISITORS. The house master logs who came, when they arrived and when they
// left. Parents do not see the log (owner, §15.8).
//
// FAMILIES. A parent sees their child's hostel, room and bed this term, and
// the house masters' names. No phone numbers, no visits.

const ALL_HOSTELS_ROLES = ["owner", "admin"] as const;
const HOUSE_ROLES = ["owner", "admin", "teacher", "house_master"] as const;
/** A clock a few minutes fast must not stop a visit being logged "now". */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const AUDIT = {
  visitLog: "hostel.visit.log",
  visitLeft: "hostel.visit.left",
  visitDelete: "hostel.visit.delete",
} as const;

type Db = PrismaClient;
interface RequestContext {
  ipAddress: string | null;
}
/** Every hostel, or the ones this person is house master of. */
export type Keeper = { all: true } | { all: false; hostelIds: Set<string> };

@Injectable()
export class HostelHouseService {
  /** The hostels the caller keeps, with this term's boarder counts. */
  async myHostels(authCtx: AuthContext): Promise<HouseHostelDto[]> {
    const keeper = await this.keeper(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const where = keeper.all ? { schoolId: authCtx.schoolId } : { schoolId: authCtx.schoolId, id: { in: [...keeper.hostelIds] } };
      const hostels = await db.hostel.findMany({ where, orderBy: { name: "asc" }, select: { id: true, name: true, forGender: true } });
      const term = await currentTerm(db, authCtx.schoolId);
      const counts = term
        ? await db.hostelBed.groupBy({ by: ["hostelId"], where: { schoolId: authCtx.schoolId, termId: term.id }, _count: { _all: true } })
        : [];
      const byHostel = new Map(counts.map((c) => [c.hostelId, c._count._all]));
      return hostels.map((h) => ({ ...h, boarders: byHostel.get(h.id) ?? 0 }));
    });
  }

  /** A hostel's boarders this term, with the one sickbay fact a house master is told. */
  async boarders(authCtx: AuthContext, hostelId: string): Promise<HouseBoardersDto> {
    const keeper = await this.keeper(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const hostel = await kept(db, authCtx.schoolId, keeper, hostelId);
      const term = await currentTerm(db, authCtx.schoolId);
      if (!term) return { hostel, term: null, boarders: [] };
      const beds = await db.hostelBed.findMany({
        where: { schoolId: authCtx.schoolId, hostelId, termId: term.id },
        include: {
          room: { select: { name: true } },
          student: {
            select: {
              firstName: true,
              lastName: true,
              admissionNumber: true,
              enrollments: { where: { termId: term.id }, select: { classArm: { select: { name: true } } } },
            },
          },
        },
      });
      const sentHome = await sentHomeToday(db, authCtx.schoolId, beds.map((b) => b.studentId));
      beds.sort((a, b) => a.room.name.localeCompare(b.room.name, undefined, { numeric: true }) || a.bedNumber - b.bedNumber);
      return {
        hostel,
        term,
        boarders: beds.map((b) => ({
          bedId: b.id,
          studentId: b.studentId,
          studentName: `${b.student.firstName} ${b.student.lastName}`.trim(),
          admissionNumber: b.student.admissionNumber,
          classArm: b.student.enrollments[0]?.classArm.name ?? null,
          roomName: b.room.name,
          bedNumber: b.bedNumber,
          sentHomeToday: sentHome.has(b.studentId),
        })),
      };
    });
  }

  /** One Lagos day of a hostel's visitor log, earliest first. */
  async visits(authCtx: AuthContext, hostelId: string, query: ListHostelVisitsInput): Promise<HostelVisitDto[]> {
    const keeper = await this.keeper(authCtx);
    const bounds = dayBounds(query.day ?? sickbayDayOf(new Date()));
    return withTenant(authCtx.schoolId, async (db) => {
      await kept(db, authCtx.schoolId, keeper, hostelId);
      const rows = await db.hostelVisit.findMany({
        where: { schoolId: authCtx.schoolId, hostelId, arrivedAt: bounds },
        orderBy: { arrivedAt: "asc" },
        select: { id: true },
      });
      return readVisits(db, rows.map((r) => r.id));
    });
  }

  /** Logs a visitor to a boarder of this hostel this term. */
  async logVisit(authCtx: AuthContext, hostelId: string, input: LogHostelVisitInput, req: RequestContext): Promise<HostelVisitDto> {
    const keeper = await this.keeper(authCtx);
    const now = Date.now();
    const arrivedAt = input.arrivedAt ? new Date(input.arrivedAt) : new Date(now);
    if (arrivedAt.getTime() > now + CLOCK_SKEW_MS) throw new ValidationError("A visitor can't arrive in the future.");
    return withTenant(authCtx.schoolId, async (db) => {
      await kept(db, authCtx.schoolId, keeper, hostelId);
      const term = await currentTerm(db, authCtx.schoolId);
      const bed = term
        ? await db.hostelBed.findFirst({ where: { schoolId: authCtx.schoolId, hostelId, termId: term.id, studentId: input.studentId }, select: { id: true } })
        : null;
      if (!bed) throw new NotFoundError("That student is not a boarder in this hostel this term.");
      const visit = await db.hostelVisit.create({
        data: {
          schoolId: authCtx.schoolId,
          hostelId,
          studentId: input.studentId,
          visitorName: input.visitorName,
          relationship: input.relationship,
          phone: input.phone ?? null,
          arrivedAt,
          loggedBy: authCtx.userId,
        },
      });
      // The visitor's name and phone stay out of the audit row: it records who
      // logged what, not the visitor's contact details.
      await audit(db, authCtx, req, AUDIT.visitLog, visit.id, { hostelId, studentId: input.studentId });
      return (await readVisits(db, [visit.id]))[0]!;
    });
  }

  /** Records when the visitor left. Once only. */
  async visitLeft(authCtx: AuthContext, visitId: string, input: HostelVisitLeftInput, req: RequestContext): Promise<HostelVisitDto> {
    const keeper = await this.keeper(authCtx);
    const now = Date.now();
    const leftAt = input.leftAt ? new Date(input.leftAt) : new Date(now);
    if (leftAt.getTime() > now + CLOCK_SKEW_MS) throw new ValidationError("A visitor can't leave in the future.");
    return withTenant(authCtx.schoolId, async (db) => {
      const visit = await keptVisit(db, authCtx.schoolId, keeper, visitId);
      if (visit.leftAt) throw new ConflictError("VISIT_ALREADY_LEFT", "That visitor's leaving time is already recorded.");
      if (leftAt < visit.arrivedAt) throw new ValidationError("A visitor can't leave before they arrived.");
      await db.hostelVisit.update({ where: { id: visitId }, data: { leftAt } });
      await audit(db, authCtx, req, AUDIT.visitLeft, visitId, { hostelId: visit.hostelId });
      return (await readVisits(db, [visitId]))[0]!;
    });
  }

  /** Removes an entry logged by mistake. Audited. */
  async deleteVisit(authCtx: AuthContext, visitId: string, req: RequestContext): Promise<void> {
    const keeper = await this.keeper(authCtx);
    await withTenant(authCtx.schoolId, async (db) => {
      const visit = await keptVisit(db, authCtx.schoolId, keeper, visitId);
      await db.hostelVisit.delete({ where: { id: visitId } });
      await audit(db, authCtx, req, AUDIT.visitDelete, visitId, { hostelId: visit.hostelId, studentId: visit.studentId });
    });
  }

  /** The parent's card: the child's bed this term and the house masters' names. */
  async hostelForGuardian(guardianCtx: GuardianAuthContext, studentId: string): Promise<PortalStudentHostelDto | null> {
    return withTenant(guardianCtx.schoolId, (db) =>
      withGuardian(guardianCtx.guardianId, studentId, db, async (db2) => {
        const term = await currentTerm(db2, guardianCtx.schoolId);
        if (!term) return null;
        const bed = await db2.hostelBed.findFirst({
          where: { schoolId: guardianCtx.schoolId, studentId, termId: term.id },
          include: {
            room: { select: { name: true } },
            hostel: { select: { name: true, houseMasters: { select: { user: { select: { firstName: true, lastName: true, isActive: true } } } } } },
          },
        });
        if (!bed) return null;
        return {
          termName: term.name,
          hostelName: bed.hostel.name,
          roomName: bed.room.name,
          bedNumber: bed.bedNumber,
          houseMasters: bed.hostel.houseMasters
            .filter((m) => m.user.isActive)
            .map((m) => `${m.user.firstName} ${m.user.lastName}`.trim())
            .sort((a, b) => a.localeCompare(b)),
        };
      }),
    );
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private keeper(authCtx: AuthContext): Promise<Keeper> {
    return houseKeeper(authCtx);
  }
}

/**
 * Which hostels the caller keeps: every one for owner and admin, else those
 * they are house master of. Shared with the exeats service (CP6b.3).
 */
export async function houseKeeper(authCtx: AuthContext): Promise<Keeper> {
  const roles = await getActiveUserRoleKeys(authCtx);
  if (roles.some((r) => (ALL_HOSTELS_ROLES as readonly string[]).includes(r))) return { all: true };
  if (!roles.some((r) => (HOUSE_ROLES as readonly string[]).includes(r))) {
    throw new ForbiddenError(`This action requires one of the following roles: ${HOUSE_ROLES.join(", ")}.`);
  }
  const rows = await withTenant(authCtx.schoolId, (db) =>
    db.hostelHouseMaster.findMany({ where: { schoolId: authCtx.schoolId, userId: authCtx.userId }, select: { hostelId: true } }),
  );
  return { all: false, hostelIds: new Set(rows.map((r) => r.hostelId)) };
}

/** Whether this teacher keeps any hostel, for the teacher portal's and staff app's menus. */
export async function housesAnyHostel(db: Db, schoolId: string, userId: string): Promise<boolean> {
  return (await db.hostelHouseMaster.count({ where: { schoolId, userId } })) > 0;
}

/**
 * Each boarder's hostel and room this term, as "Hostel, Room", for the sickbay
 * page's label (§15 CP6b-D7) so the health officer knows whom to tell.
 */
export async function boarderLabels(db: Db, schoolId: string, studentIds: string[]): Promise<Map<string, string>> {
  if (studentIds.length === 0) return new Map();
  const term = await currentTerm(db, schoolId);
  if (!term) return new Map();
  const beds = await db.hostelBed.findMany({
    where: { schoolId, termId: term.id, studentId: { in: studentIds } },
    select: { studentId: true, hostel: { select: { name: true } }, room: { select: { name: true } } },
  });
  return new Map(beds.map((b) => [b.studentId, `${b.hostel.name}, ${b.room.name}`]));
}

export async function kept(db: Db, schoolId: string, keeper: Keeper, hostelId: string) {
  if (!keeper.all && !keeper.hostelIds.has(hostelId)) throw new NotFoundError("Hostel not found.");
  const hostel = await db.hostel.findFirst({ where: { id: hostelId, schoolId }, select: { id: true, name: true, forGender: true } });
  if (!hostel) throw new NotFoundError("Hostel not found.");
  return hostel;
}

async function keptVisit(db: Db, schoolId: string, keeper: Keeper, visitId: string) {
  const visit = await db.hostelVisit.findFirst({
    where: { id: visitId, schoolId },
    select: { hostelId: true, studentId: true, arrivedAt: true, leftAt: true },
  });
  if (!visit || (!keeper.all && !keeper.hostelIds.has(visit.hostelId))) throw new NotFoundError("Visit not found.");
  return visit;
}

export async function currentTerm(db: Db, schoolId: string) {
  return db.term.findFirst({ where: { schoolId, isCurrent: true }, select: { id: true, name: true } });
}

/** Students the sickbay sent home today (Lagos), from visits not withdrawn. */
async function sentHomeToday(db: Db, schoolId: string, studentIds: string[]): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();
  const rows = await db.sickbayVisit.findMany({
    where: { schoolId, studentId: { in: studentIds }, sentHome: true, withdrawnAt: null, visitedAt: dayBounds(sickbayDayOf(new Date())) },
    select: { studentId: true },
  });
  return new Set(rows.map((r) => r.studentId));
}

/** Lagos is UTC+1 all year. */
function dayBounds(day: string): { gte: Date; lt: Date } {
  const gte = new Date(`${day}T00:00:00+01:00`);
  if (Number.isNaN(gte.getTime())) throw new ValidationError("Use a date like 2026-10-15.");
  return { gte, lt: new Date(gte.getTime() + 24 * 60 * 60 * 1000) };
}

async function readVisits(db: Db, ids: string[]): Promise<HostelVisitDto[]> {
  if (ids.length === 0) return [];
  const rows = await db.hostelVisit.findMany({
    where: { id: { in: ids } },
    orderBy: { arrivedAt: "asc" },
    include: { student: { select: { firstName: true, lastName: true } } },
  });
  const loggers = await db.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.loggedBy))] } },
    select: { id: true, firstName: true, lastName: true },
  });
  const nameOf = new Map(loggers.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  return rows.map((r) => ({
    id: r.id,
    studentId: r.studentId,
    studentName: `${r.student.firstName} ${r.student.lastName}`.trim(),
    visitorName: r.visitorName,
    relationship: r.relationship,
    phone: r.phone,
    arrivedAt: r.arrivedAt,
    leftAt: r.leftAt,
    loggedByName: nameOf.get(r.loggedBy) ?? null,
  }));
}

async function audit(db: Db, authCtx: AuthContext, req: RequestContext, action: string, entityId: string, metadata: Record<string, string | number | null>) {
  await db.auditLog.create({
    data: { schoolId: authCtx.schoolId, userId: authCtx.userId, action, entityType: "hostel", entityId, ipAddress: req.ipAddress, metadata },
  });
}
