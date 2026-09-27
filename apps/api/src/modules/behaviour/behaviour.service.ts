import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type BehaviourListQuery,
  type BehaviourListResponse,
  type BehaviourRecordDto,
  type CreateBehaviourInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf, getActiveUserRoleKeys } from "../../common/auth/role-check.js";
import { getTeacherScope } from "../teacher-scope/teacher-scope.helper.js";

// Behaviour records (docs/modules/the-school-day.md Part C).
//
// C14 — INTERNAL. There is no guardian or student method on this service, and
// no portal controller. That absence is the feature: a note a parent can read
// changes what a teacher is willing to write, and "my child did not do that"
// needs a right of reply, a retention rule and an amendment path that do not
// exist. Making it parent-visible later is a decision with a design.
//
// C15 — no AI. Nothing here summarises, drafts or classifies. A machine-written
// judgement about a child's conduct is not something a teacher can meaningfully
// approve, which is stricter than the hard rule's approval gate.
//
// C16 — commendations as well as concerns, because a system that records only
// what a child did wrong is one teachers stop using and parents resent.

const AUDIT = {
  create: "behaviour.create",
  withdraw: "behaviour.withdraw",
  read: "behaviour.read",
} as const;

interface RequestContext {
  ipAddress: string | null;
}

const asIsoDate = (value: Date): string => value.toISOString().slice(0, 10);

@Injectable()
export class BehaviourService {
  // =========================================================================
  // POST /behaviour
  // =========================================================================
  async create(
    authCtx: AuthContext,
    dto: CreateBehaviourInput,
    reqCtx: RequestContext,
  ): Promise<BehaviourRecordDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);
    const isAdmin = await this.isAdmin(authCtx);

    return withTenant(authCtx.schoolId, async (db) => {
      const student = await db.student.findUnique({
        where: { id: dto.studentId },
        select: { id: true },
      });
      if (!student) throw new NotFoundError("That student could not be found.");

      if (!isAdmin) await this.assertTeachesStudent(db, authCtx.userId, dto.studentId);

      const created = await db.behaviourRecord.create({
        data: {
          schoolId: authCtx.schoolId,
          studentId: dto.studentId,
          kind: dto.kind,
          note: dto.note,
          occurredOn: new Date(`${dto.occurredOn}T00:00:00.000Z`),
          recordedBy: authCtx.userId,
        },
        select: { id: true, createdAt: true },
      });

      // Every write is audited, and the KIND goes in the metadata while the
      // note does not: the audit log answers "who wrote a concern about whom,
      // and when", and repeating the text there would put the most sensitive
      // sentence in the system in a second place with a different retention.
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.create,
          entityType: "behaviour",
          entityId: created.id,
          ipAddress: reqCtx.ipAddress,
          metadata: { studentId: dto.studentId, kind: dto.kind, occurredOn: dto.occurredOn },
        },
      });

      const author = await db.user.findUnique({
        where: { id: authCtx.userId },
        select: { firstName: true, lastName: true },
      });

      return {
        id: created.id,
        studentId: dto.studentId,
        kind: dto.kind,
        note: dto.note,
        occurredOn: dto.occurredOn,
        recordedByName: author ? `${author.firstName} ${author.lastName}` : null,
        createdAt: created.createdAt,
        withdrawnAt: null,
      };
    });
  }

  // =========================================================================
  // GET /behaviour?studentId=
  // =========================================================================
  async listForStudent(
    authCtx: AuthContext,
    query: BehaviourListQuery,
    reqCtx: RequestContext,
  ): Promise<BehaviourListResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);
    const isAdmin = await this.isAdmin(authCtx);

    return withTenant(authCtx.schoolId, async (db) => {
      if (!isAdmin) await this.assertTeachesStudent(db, authCtx.userId, query.studentId);

      const rows = await db.behaviourRecord.findMany({
        where: { studentId: query.studentId },
        orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
        take: 200,
      });

      // READING is audited too, not only writing — the same treatment the
      // per-teacher activity report gets (phase-8 §16 D23). A conduct history
      // is the sort of thing whose READERS matter: "who has been looking at
      // this child's record" is a question a school may one day have to answer.
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.read,
          entityType: "behaviour",
          entityId: query.studentId,
          ipAddress: reqCtx.ipAddress,
          metadata: { count: rows.length },
        },
      });

      const authors = await db.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.recordedBy))] } },
        select: { id: true, firstName: true, lastName: true },
      });
      const name = new Map(authors.map((a) => [a.id, `${a.firstName} ${a.lastName}`]));

      const data: BehaviourRecordDto[] = rows.map((row) => ({
        id: row.id,
        studentId: row.studentId,
        kind: row.kind,
        note: row.note,
        occurredOn: asIsoDate(row.occurredOn),
        recordedByName: name.get(row.recordedBy) ?? null,
        createdAt: row.createdAt,
        withdrawnAt: row.withdrawnAt,
      }));

      // Withdrawn records are shown (struck through by the UI) but never
      // counted: a withdrawn concern is a record that it was written and taken
      // back, not a concern.
      const live = data.filter((row) => row.withdrawnAt === null);
      return {
        data,
        commendations: live.filter((row) => row.kind === "COMMENDATION").length,
        concerns: live.filter((row) => row.kind === "CONCERN").length,
      };
    });
  }

  // =========================================================================
  // POST /behaviour/:id/withdraw
  // =========================================================================
  async withdraw(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<BehaviourRecordDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);
    const isAdmin = await this.isAdmin(authCtx);

    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.behaviourRecord.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError("That record could not be found.");
      // A teacher withdraws their OWN. Not their colleague's, even for a
      // student they both teach: a record is the judgement of the person who
      // wrote it, and a teacher quietly removing someone else's concern is a
      // different act from correcting their own.
      if (!isAdmin && existing.recordedBy !== authCtx.userId) {
        throw new ForbiddenError("You can only withdraw a record you wrote.");
      }
      if (existing.withdrawnAt) throw new ConflictError("BEHAVIOUR_ALREADY_WITHDRAWN", "That record was already withdrawn.");

      const updated = await db.behaviourRecord.update({
        where: { id },
        data: { withdrawnAt: new Date(), withdrawnBy: authCtx.userId },
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.withdraw,
          entityType: "behaviour",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: { studentId: existing.studentId },
        },
      });

      const author = await db.user.findUnique({
        where: { id: updated.recordedBy },
        select: { firstName: true, lastName: true },
      });
      return {
        id: updated.id,
        studentId: updated.studentId,
        kind: updated.kind,
        note: updated.note,
        occurredOn: asIsoDate(updated.occurredOn),
        recordedByName: author ? `${author.firstName} ${author.lastName}` : null,
        createdAt: updated.createdAt,
        withdrawnAt: updated.withdrawnAt,
      };
    });
  }

  // =========================================================================

  /**
   * A teacher may only touch a child they actually teach.
   *
   * Deliberately wider than "form teacher" and far narrower than "any student":
   * the teacher who saw what happened is often a subject teacher, not the form
   * tutor, and requiring the form tutor to write it second-hand is how conduct
   * records stop being written at all. But a teacher with no connection to a
   * child has no business writing about them.
   */
  private async assertTeachesStudent(
    db: Parameters<Parameters<typeof withTenant>[1]>[0],
    teacherId: string,
    studentId: string,
  ): Promise<void> {
    const scope = await getTeacherScope(db as never, teacherId);
    const armIds = new Set(scope.classArms.map((arm) => arm.id));
    if (armIds.size === 0) {
      throw new ForbiddenError("You can only record behaviour for a student you teach.");
    }
    const enrolment = await db.enrollment.findFirst({
      where: { studentId, status: "ENROLLED", classArmId: { in: [...armIds] } },
      select: { id: true },
    });
    if (!enrolment) {
      throw new ForbiddenError("You can only record behaviour for a student you teach.");
    }
  }

  private async isAdmin(authCtx: AuthContext): Promise<boolean> {
    const roles = await getActiveUserRoleKeys(authCtx);
    return roles.includes("owner") || roles.includes("admin");
  }
}
