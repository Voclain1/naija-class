import { Injectable } from "@nestjs/common";

import { withGuardian, withTenant } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  HOMEWORK_WINDOW_DAYS,
  lagosTodayIso,
  type CreateHomeworkInput,
  type HomeworkDto,
  type HomeworkFeedItemDto,
  type HomeworkFeedResponse,
  type HomeworkListQuery,
  type HomeworkListResponse,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf, getActiveUserRoleKeys } from "../../common/auth/role-check.js";
import { getTeacherScope } from "../teacher-scope/teacher-scope.helper.js";

// Homework (docs/modules/the-school-day.md Part B).
//
// B7: information, not workflow. A teacher posts what is due and when; nothing
// is submitted, uploaded or marked. The absence of a submission path is the
// design, not an omission.
//
// B8: a teacher may post only for a class and subject their OWN teacher scope
// lists — the same gate the gradebook uses, not a new one. Owner and admin may
// post for any, as they may enter marks for any.
//
// B9: posting sends NO push. Five subjects posting daily is five buzzes and a
// silenced app, which would take the absence alert (Part A) down with it. The
// student's Today band and the parent's child card carry it instead.

const AUDIT = {
  create: "homework.create",
  withdraw: "homework.withdraw",
} as const;

interface RequestContext {
  ipAddress: string | null;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const asIsoDate = (value: Date): string => value.toISOString().slice(0, 10);

@Injectable()
export class HomeworkService {
  // =========================================================================
  // POST /homework
  // =========================================================================
  async create(
    authCtx: AuthContext,
    dto: CreateHomeworkInput,
    reqCtx: RequestContext,
  ): Promise<HomeworkDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);
    const isAdmin = await this.isAdmin(authCtx);

    return withTenant(authCtx.schoolId, async (db) => {
      const arm = await db.classArm.findUnique({
        where: { id: dto.classArmId },
        select: { id: true, name: true, isActive: true },
      });
      if (!arm) throw new NotFoundError("That class could not be found.");
      if (!arm.isActive) {
        // Posting into a class nobody is in reads as working, and the work
        // would never be seen.
        throw new ConflictError("CLASS_INACTIVE", "That class is no longer active.");
      }

      const subject = await db.subject.findUnique({
        where: { id: dto.subjectId },
        select: { id: true, name: true },
      });
      if (!subject) throw new NotFoundError("That subject could not be found.");

      // B8 — the scope gate. An admin is trusted with any class; a teacher is
      // held to the pairs their own assignments list, so "homework for a class
      // I do not teach" is refused rather than quietly accepted.
      if (!isAdmin) {
        const scope = await getTeacherScope(db as never, authCtx.userId);
        const subjects = scope.subjectsByArm.get(dto.classArmId) ?? [];
        const teachesPair = subjects.some((s) => s.id === dto.subjectId);
        if (!teachesPair) {
          throw new ForbiddenError("You can only set homework for a class and subject you teach.");
        }
      }

      const created = await db.assignment.create({
        data: {
          schoolId: authCtx.schoolId,
          classArmId: dto.classArmId,
          subjectId: dto.subjectId,
          createdBy: authCtx.userId,
          title: dto.title,
          instructions: dto.instructions ?? null,
          dueDate: new Date(`${dto.dueDate}T00:00:00.000Z`),
        },
        select: { id: true, postedAt: true },
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.create,
          entityType: "homework",
          entityId: created.id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            classArmId: dto.classArmId,
            subjectId: dto.subjectId,
            dueDate: dto.dueDate,
          },
        },
      });

      const poster = await db.user.findUnique({
        where: { id: authCtx.userId },
        select: { firstName: true, lastName: true },
      });

      return {
        id: created.id,
        classArmId: dto.classArmId,
        className: arm.name,
        subjectId: dto.subjectId,
        subjectName: subject.name,
        title: dto.title,
        instructions: dto.instructions ?? null,
        dueDate: dto.dueDate,
        postedAt: created.postedAt,
        postedByName: poster ? `${poster.firstName} ${poster.lastName}` : null,
        withdrawnAt: null,
      };
    });
  }

  // =========================================================================
  // GET /homework — a teacher's own by default; the school's with ?all=true
  // =========================================================================
  async list(authCtx: AuthContext, query: HomeworkListQuery): Promise<HomeworkListResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher", "bursar"]);
    const roles = await getActiveUserRoleKeys(authCtx);
    const isAdmin = roles.includes("owner") || roles.includes("admin");

    // Refused, not narrowed: a teacher asking for the whole school's homework
    // should be told no. Silently returning their own would look like the
    // school had set nothing.
    if (query.all && !isAdmin) {
      throw new ForbiddenError("Only an owner or admin can see every class's homework.");
    }

    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.assignment.findMany({
        where: {
          ...(query.classArmId ? { classArmId: query.classArmId } : {}),
          // A bursar holds read but teaches nothing, so "my own" would be
          // empty for them; they get the school's list, which is what the
          // permission is for.
          ...(isAdmin || roles.includes("bursar") || query.all ? {} : { createdBy: authCtx.userId }),
        },
        orderBy: [{ dueDate: "desc" }, { postedAt: "desc" }],
        take: 200,
      });

      return { data: await this.decorate(db, rows) };
    });
  }

  // =========================================================================
  // POST /homework/:id/withdraw — B10: withdrawn, never deleted
  // =========================================================================
  async withdraw(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<HomeworkDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);
    const isAdmin = await this.isAdmin(authCtx);

    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.assignment.findUnique({
        where: { id },
        select: { id: true, createdBy: true, withdrawnAt: true },
      });
      if (!existing) throw new NotFoundError("That homework could not be found.");
      // A teacher withdraws their own. An admin withdraws anyone's — they are
      // who a parent complains to, and they can already post for any class.
      if (!isAdmin && existing.createdBy !== authCtx.userId) {
        throw new ForbiddenError("You can only withdraw homework you set.");
      }
      if (existing.withdrawnAt) {
        throw new ConflictError("HOMEWORK_ALREADY_WITHDRAWN", "That homework was already withdrawn.");
      }

      await db.assignment.update({
        where: { id },
        data: { withdrawnAt: new Date(), withdrawnBy: authCtx.userId },
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.withdraw,
          entityType: "homework",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: {},
        },
      });

      const [row] = await db.assignment.findMany({ where: { id } });
      const [dto] = await this.decorate(db, row ? [row] : []);
      if (!dto) throw new NotFoundError("That homework could not be found.");
      return dto;
    });
  }

  // =========================================================================
  // The family reads. One shape, two callers (guardian's child, student's own).
  // =========================================================================

  /**
   * A GUARDIAN's view of one child's homework.
   *
   * withGuardian, nested inside withTenant, is what stops a parent reading
   * another family's child: RLS knows school_id and nothing about which
   * guardian may see which student, so cross-family isolation is this call's
   * job and not the policy's.
   */
  async forGuardianChild(
    guardianCtx: { schoolId: string; guardianId: string },
    studentId: string,
  ): Promise<HomeworkFeedResponse> {
    return withTenant(guardianCtx.schoolId, (db) =>
      withGuardian(guardianCtx.guardianId, studentId, db as never, (db2) =>
        this.readForStudent(db2 as never, studentId),
      ),
    );
  }

  /**
   * A STUDENT's view of their own.
   *
   * No withGuardian: the student id comes from their own session, so there is
   * no other family's row it could reach.
   */
  async forStudentSelf(schoolId: string, studentId: string): Promise<HomeworkFeedResponse> {
    return withTenant(schoolId, (db) => this.readForStudent(db as never, studentId));
  }

  /** The one read both family surfaces share, so they cannot diverge. */
  private async readForStudent(
    db: Parameters<Parameters<typeof withTenant>[1]>[0],
    studentId: string,
  ): Promise<HomeworkFeedResponse> {
    {
      const today = lagosTodayIso();
      const enrollment = await db.enrollment.findFirst({
        where: { studentId, status: "ENROLLED" },
        orderBy: { enrolledAt: "desc" },
        select: { classArmId: true },
      });
      // A child between classes has no homework rather than an error: this is
      // a read a parent opens, not an action they took.
      if (!enrollment?.classArmId) return { data: [], dueSoonCount: 0 };

      const rows = await db.assignment.findMany({
        where: {
          classArmId: enrollment.classArmId,
          withdrawnAt: null,
          dueDate: {
            // Yesterday's work still shows, marked overdue — a child who
            // forgot it needs to see it, and hiding it at midnight is how a
            // parent finds out a week later.
            gte: new Date(`${addDays(today, -3)}T00:00:00.000Z`),
            lte: new Date(`${addDays(today, HOMEWORK_WINDOW_DAYS)}T00:00:00.000Z`),
          },
        },
        orderBy: [{ dueDate: "asc" }, { postedAt: "asc" }],
      });

      const decorated = await this.decorate(db, rows);
      const tomorrow = addDays(today, 1);
      const data: HomeworkFeedItemDto[] = decorated.map((item) => ({
        ...item,
        // The SERVER decides overdue, against the school's day — a handset's
        // clock is not the school's, and a wrong "overdue" is an argument.
        overdue: item.dueDate < today,
      }));
      return {
        data,
        dueSoonCount: data.filter((item) => item.dueDate === today || item.dueDate === tomorrow).length,
      };
    }
  }

  // =========================================================================

  /**
   * The role gate, plus the keys the ownership rules need.
   *
   * Two calls, deliberately. `assertUserActiveAndHasOneOf` with a LITERAL
   * array is what `rbac-two-gate-conformance.spec.ts` parses out of the
   * source, so it cannot be replaced by a role-keys check that happens to
   * throw; `getActiveUserRoleKeys` is what tells a teacher from an admin once
   * past the gate. The second read is small and these are not hot paths —
   * homework is posted a handful of times a day per teacher.
   */
  private async isAdmin(authCtx: AuthContext): Promise<boolean> {
    const roles = await getActiveUserRoleKeys(authCtx);
    return roles.includes("owner") || roles.includes("admin");
  }

  private async decorate(
    db: Parameters<Parameters<typeof withTenant>[1]>[0],
    rows: {
      id: string;
      classArmId: string;
      subjectId: string;
      createdBy: string;
      title: string;
      instructions: string | null;
      dueDate: Date;
      postedAt: Date;
      withdrawnAt: Date | null;
    }[],
  ): Promise<HomeworkDto[]> {
    if (rows.length === 0) return [];
    // Three small lookups rather than three joins per row: the lists here are
    // short (a class's term, a teacher's own), and the names are what make a
    // row readable.
    const [arms, subjects, users] = await Promise.all([
      db.classArm.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.classArmId))] } },
        select: { id: true, name: true },
      }),
      db.subject.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.subjectId))] } },
        select: { id: true, name: true },
      }),
      db.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.createdBy))] } },
        select: { id: true, firstName: true, lastName: true },
      }),
    ]);
    const armName = new Map(arms.map((a) => [a.id, a.name]));
    const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
    const userName = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));

    return rows.map((row) => ({
      id: row.id,
      classArmId: row.classArmId,
      className: armName.get(row.classArmId) ?? "",
      subjectId: row.subjectId,
      subjectName: subjectName.get(row.subjectId) ?? "",
      title: row.title,
      instructions: row.instructions,
      dueDate: asIsoDate(row.dueDate),
      postedAt: row.postedAt,
      postedByName: userName.get(row.createdBy) ?? null,
      withdrawnAt: row.withdrawnAt,
    }));
  }
}
