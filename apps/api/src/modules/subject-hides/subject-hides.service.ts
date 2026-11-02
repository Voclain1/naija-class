import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type CreateSubjectHideInput,
  type ListSubjectHidesInput,
  type SubjectHideDto,
  type SubjectHideScope,
  type SubjectHideUntil,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { getActiveUserRoleKeys } from "../../common/auth/role-check";

// Hidden subjects (2026-11-02, docs/modules/subjects-by-class.md).
//
// Owners and admins hide a subject for an arm, a whole class level or the
// whole school. A teacher may hide only for the arm they are form teacher of,
// and unhide only those. Every hide and unhide is audited. Rows are never
// deleted: unhiding stamps unhidden_at, so the list keeps the record.

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

type TenantDb = Parameters<Parameters<typeof withTenant>[1]>[0];

const AUDIT = { hide: "subject.hidden", unhide: "subject.unhidden" } as const;

const HIDE_SELECT = {
  id: true,
  subjectId: true,
  scope: true,
  classArmId: true,
  classLevelId: true,
  until: true,
  termId: true,
  academicYearId: true,
  hiddenBy: true,
  createdAt: true,
  unhiddenAt: true,
  subject: { select: { name: true } },
  term: {
    select: {
      name: true,
      startDate: true,
      endDate: true,
      isCurrent: true,
      academicYear: { select: { label: true, endDate: true, isCurrent: true } },
    },
  },
} as const;

@Injectable()
export class SubjectHidesService {
  async list(authCtx: AuthContext, query: ListSubjectHidesInput): Promise<SubjectHideDto[]> {
    const roles = await getActiveUserRoleKeys(authCtx);
    const admin = roles.includes("owner") || roles.includes("admin");
    return withTenant(authCtx.schoolId, async (db) => {
      const formArms = admin ? [] : await this.formArmIds(db, authCtx.userId);
      const rows = await db.subjectHide.findMany({
        where: {
          ...(query.current === "true" ? { unhiddenAt: null } : {}),
          ...(query.classArmId ? { OR: [{ classArmId: query.classArmId }, { scope: { not: "ARM" } }] } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 500,
        select: HIDE_SELECT,
      });

      let visible = rows;
      if (query.current === "true") {
        const today = new Date();
        visible = rows.filter((r) => stillCurrent(r, today));
      }
      if (!admin) {
        // A form teacher sees what touches their arms: their own arm hides, and
        // level or school hides (so they know why a subject is missing).
        visible = visible.filter((r) => r.scope !== "ARM" || (r.classArmId !== null && formArms.includes(r.classArmId)));
      }
      return this.toDtos(db, visible, (r) => admin || (r.scope === "ARM" && r.classArmId !== null && formArms.includes(r.classArmId)));
    });
  }

  async create(authCtx: AuthContext, input: CreateSubjectHideInput, reqCtx: RequestContext): Promise<SubjectHideDto> {
    const roles = await getActiveUserRoleKeys(authCtx);
    const admin = roles.includes("owner") || roles.includes("admin");
    return withTenant(authCtx.schoolId, async (db) => {
      const [subject, term] = await Promise.all([
        db.subject.findUnique({ where: { id: input.subjectId }, select: { id: true } }),
        db.term.findUnique({ where: { id: input.termId }, select: { id: true, academicYearId: true } }),
      ]);
      if (!subject) throw new NotFoundError("Subject not found.");
      if (!term) throw new NotFoundError("Term not found.");

      let classArmId: string | null = null;
      let classLevelId: string | null = null;
      if (input.scope === "ARM") {
        const arm = await db.classArm.findUnique({ where: { id: input.classArmId! }, select: { id: true, classTeacherId: true } });
        if (!arm) throw new NotFoundError("Class arm not found.");
        if (!admin && arm.classTeacherId !== authCtx.userId) {
          throw new ForbiddenError("NOT_FORM_TEACHER", "Only this class's form teacher or an admin can hide its subjects.");
        }
        classArmId = arm.id;
      } else {
        if (!admin) throw new ForbiddenError("ADMIN_ONLY", "Only an admin can hide a subject for a whole class or the school.");
        if (input.scope === "LEVEL") {
          const level = await db.classLevel.findUnique({ where: { id: input.classLevelId! }, select: { id: true } });
          if (!level) throw new NotFoundError("Class not found.");
          classLevelId = level.id;
        }
      }

      const duplicate = await db.subjectHide.findFirst({
        where: { subjectId: input.subjectId, scope: input.scope, classArmId, classLevelId, until: input.until, termId: input.termId, unhiddenAt: null },
        select: { id: true },
      });
      if (duplicate) throw new ValidationError("ALREADY_HIDDEN", "This subject is already hidden there.");

      const created = await db.subjectHide.create({
        data: {
          schoolId: authCtx.schoolId,
          subjectId: input.subjectId,
          scope: input.scope,
          classArmId,
          classLevelId,
          until: input.until,
          termId: input.termId,
          academicYearId: term.academicYearId,
          hiddenBy: authCtx.userId,
        },
        select: HIDE_SELECT,
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.hide,
          entityType: "subject_hide",
          entityId: created.id,
          ipAddress: reqCtx.ipAddress,
          metadata: { subjectId: input.subjectId, scope: input.scope, classArmId, classLevelId, until: input.until, termId: input.termId },
        },
      });
      const [dto] = await this.toDtos(db, [created], () => true);
      return dto!;
    });
  }

  async unhide(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<SubjectHideDto> {
    const roles = await getActiveUserRoleKeys(authCtx);
    const admin = roles.includes("owner") || roles.includes("admin");
    return withTenant(authCtx.schoolId, async (db) => {
      const hide = await db.subjectHide.findUnique({ where: { id }, select: { id: true, scope: true, classArmId: true, unhiddenAt: true } });
      if (!hide) throw new NotFoundError("Hidden subject not found.");
      if (!admin) {
        const formArms = await this.formArmIds(db, authCtx.userId);
        if (hide.scope !== "ARM" || !hide.classArmId || !formArms.includes(hide.classArmId)) {
          throw new ForbiddenError("NOT_FORM_TEACHER", "Only an admin, or this class's form teacher, can unhide it.");
        }
      }
      const updated = hide.unhiddenAt
        ? await db.subjectHide.findUniqueOrThrow({ where: { id }, select: HIDE_SELECT })
        : await db.subjectHide.update({
            where: { id },
            data: { unhiddenAt: new Date(), unhiddenBy: authCtx.userId },
            select: HIDE_SELECT,
          });
      if (!hide.unhiddenAt) {
        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.unhide,
            entityType: "subject_hide",
            entityId: id,
            ipAddress: reqCtx.ipAddress,
            metadata: { subjectId: updated.subjectId },
          },
        });
      }
      const [dto] = await this.toDtos(db, [updated], () => true);
      return dto!;
    });
  }

  private async formArmIds(db: TenantDb, userId: string): Promise<string[]> {
    const arms = await db.classArm.findMany({ where: { classTeacherId: userId }, select: { id: true } });
    return arms.map((a) => a.id);
  }

  private async toDtos(
    db: TenantDb,
    rows: HideRow[],
    canUnhide: (r: HideRow) => boolean,
  ): Promise<SubjectHideDto[]> {
    const armIds = [...new Set(rows.flatMap((r) => (r.classArmId ? [r.classArmId] : [])))];
    const levelIds = [...new Set(rows.flatMap((r) => (r.classLevelId ? [r.classLevelId] : [])))];
    const userIds = [...new Set(rows.map((r) => r.hiddenBy))];
    const [arms, levels, users] = await Promise.all([
      db.classArm.findMany({ where: { id: { in: armIds } }, select: { id: true, name: true } }),
      db.classLevel.findMany({ where: { id: { in: levelIds } }, select: { id: true, name: true } }),
      db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }),
    ]);
    const armName = new Map(arms.map((a) => [a.id, a.name]));
    const levelName = new Map(levels.map((l) => [l.id, l.name]));
    const userName = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
    return rows.map((r) => ({
      id: r.id,
      subjectId: r.subjectId,
      subjectName: r.subject.name,
      scope: r.scope as SubjectHideScope,
      classArmId: r.classArmId,
      classArmName: r.classArmId ? (armName.get(r.classArmId) ?? null) : null,
      classLevelId: r.classLevelId,
      classLevelName: r.classLevelId ? (levelName.get(r.classLevelId) ?? null) : null,
      until: r.until as SubjectHideUntil,
      termId: r.termId,
      termName: r.term.name,
      academicYearLabel: r.term.academicYear.label,
      hiddenByName: userName.get(r.hiddenBy) ?? null,
      createdAt: r.createdAt.toISOString(),
      unhiddenAt: r.unhiddenAt?.toISOString() ?? null,
      canUnhide: !r.unhiddenAt && canUnhide(r),
    }));
  }
}

type HideRow = {
  id: string;
  subjectId: string;
  scope: string;
  classArmId: string | null;
  classLevelId: string | null;
  until: string;
  termId: string;
  academicYearId: string;
  hiddenBy: string;
  createdAt: Date;
  unhiddenAt: Date | null;
  subject: { name: string };
  term: { name: string; startDate: Date; endDate: Date; isCurrent: boolean; academicYear: { label: string; endDate: Date; isCurrent: boolean } };
};

/**
 * Still in force: not unhidden, and its term (or session) is the school's
 * current one or has not ended. "Current" counts as well as the dates because
 * schools often keep a term current past its end date while results are
 * finished, and a hide on it still applies to those results.
 */
function stillCurrent(r: HideRow, today: Date): boolean {
  if (r.unhiddenAt) return false;
  const day = startOfDay(today).getTime();
  if (r.until === "TERM") return r.term.isCurrent || r.term.endDate.getTime() >= day;
  if (r.until === "YEAR") return r.term.academicYear.isCurrent || r.term.academicYear.endDate.getTime() >= day;
  return true;
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

