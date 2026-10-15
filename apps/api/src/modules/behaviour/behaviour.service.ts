import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type BehaviourCategoryDto,
  type BehaviourSettingsDto,
  type CreateBehaviourCategoryInput,
  type UpdateBehaviourCategoryInput,
  type UpdateBehaviourSettingsInput,
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
  settings: "behaviour.settings.update",
  categoryCreate: "behaviour.category.create",
  categoryUpdate: "behaviour.category.update",
} as const;

type Db = Parameters<Parameters<typeof withTenant>[1]>[0];

const toCategoryDto = (row: { id: string; name: string; kind: BehaviourCategoryDto["kind"]; points: number; active: boolean }): BehaviourCategoryDto => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  points: row.points,
  active: row.active,
});

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

      const category = dto.categoryId ? await this.usableCategory(db, authCtx.schoolId, dto.categoryId, dto.kind) : null;

      const created = await db.behaviourRecord.create({
        data: {
          schoolId: authCtx.schoolId,
          studentId: dto.studentId,
          kind: dto.kind,
          note: dto.note,
          occurredOn: new Date(`${dto.occurredOn}T00:00:00.000Z`),
          recordedBy: authCtx.userId,
          // CP2-D1: the value is COPIED, so a later change to the category
          // never rewrites this record or the term it counted towards.
          categoryId: category?.id ?? null,
          points: category?.points ?? null,
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
          metadata: {
            studentId: dto.studentId,
            kind: dto.kind,
            occurredOn: dto.occurredOn,
            ...(category ? { categoryId: category.id, points: category.points } : {}),
          },
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
        categoryName: category?.name ?? null,
        points: category?.points ?? null,
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
        include: { category: { select: { name: true } } },
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
        categoryName: row.category?.name ?? null,
        points: row.points,
      }));

      // Withdrawn records are shown (struck through by the UI) but never
      // counted: a withdrawn concern is a record that it was written and taken
      // back, not a concern.
      const live = data.filter((row) => row.withdrawnAt === null);
      return {
        data,
        commendations: live.filter((row) => row.kind === "COMMENDATION").length,
        concerns: live.filter((row) => row.kind === "CONCERN").length,
        termPoints: await this.termPoints(db, authCtx.schoolId, query.studentId),
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
        include: { category: { select: { name: true } } },
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
        categoryName: updated.category?.name ?? null,
        points: updated.points,
      };
    });
  }

  // =========================================================================
  // Phase 9 / CP2.1 — points and categories (docs/modules/phase-9.md §9 CP2-D1)
  // =========================================================================

  /** GET /behaviour/settings — every writer needs the categories to offer them. */
  async getSettings(authCtx: AuthContext): Promise<BehaviourSettingsDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);
    return withTenant(authCtx.schoolId, (db) => this.readSettings(db, authCtx.schoolId));
  }

  /** PATCH /behaviour/settings — the school's points switch. */
  async updateSettings(
    authCtx: AuthContext,
    dto: UpdateBehaviourSettingsInput,
    reqCtx: RequestContext,
  ): Promise<BehaviourSettingsDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      await db.school.update({ where: { id: authCtx.schoolId }, data: { behaviourPointsEnabled: dto.pointsEnabled } });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.settings,
          entityType: "school",
          entityId: authCtx.schoolId,
          ipAddress: reqCtx.ipAddress,
          metadata: { pointsEnabled: dto.pointsEnabled },
        },
      });
      return this.readSettings(db, authCtx.schoolId);
    });
  }

  /** POST /behaviour/categories */
  async createCategory(
    authCtx: AuthContext,
    dto: CreateBehaviourCategoryInput,
    reqCtx: RequestContext,
  ): Promise<BehaviourCategoryDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      await this.assertNameFree(db, dto.name, null);
      const created = await db.behaviourCategory.create({
        data: { schoolId: authCtx.schoolId, name: dto.name, kind: dto.kind, points: dto.points },
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.categoryCreate,
          entityType: "behaviour_category",
          entityId: created.id,
          ipAddress: reqCtx.ipAddress,
          metadata: { name: created.name, kind: created.kind, points: created.points },
        },
      });
      return toCategoryDto(created);
    });
  }

  /**
   * PATCH /behaviour/categories/:id — rename, revalue, or switch off.
   *
   * The kind cannot change (the DTO has no field for it), and the new value
   * must keep the kind's sign. Past records keep the value they copied.
   */
  async updateCategory(
    authCtx: AuthContext,
    id: string,
    dto: UpdateBehaviourCategoryInput,
    reqCtx: RequestContext,
  ): Promise<BehaviourCategoryDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.behaviourCategory.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError("That category could not be found.");
      if (dto.points !== undefined) {
        const ok = existing.kind === "COMMENDATION" ? dto.points >= 1 : dto.points <= -1;
        if (!ok) {
          throw new ValidationError(
            existing.kind === "COMMENDATION"
              ? "A commendation scores 1 to 10 points."
              : "A concern scores −1 to −10 points.",
          );
        }
      }
      if (dto.name !== undefined) await this.assertNameFree(db, dto.name, id);
      const updated = await db.behaviourCategory.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.points !== undefined ? { points: dto.points } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.categoryUpdate,
          entityType: "behaviour_category",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            before: { name: existing.name, points: existing.points, active: existing.active },
            after: { name: updated.name, points: updated.points, active: updated.active },
          },
        },
      });
      return toCategoryDto(updated);
    });
  }

  private async readSettings(db: Db, schoolId: string): Promise<BehaviourSettingsDto> {
    const school = await db.school.findUnique({ where: { id: schoolId }, select: { behaviourPointsEnabled: true } });
    const categories = await db.behaviourCategory.findMany();
    // Commendations first (C16), then the larger value, then the name.
    const sorted = [...categories].sort(
      (a, b) =>
        (a.kind === b.kind ? 0 : a.kind === "COMMENDATION" ? -1 : 1) ||
        Math.abs(b.points) - Math.abs(a.points) ||
        a.name.localeCompare(b.name),
    );
    return { pointsEnabled: school?.behaviourPointsEnabled ?? false, categories: sorted.map(toCategoryDto) };
  }

  /**
   * The category a new record may use: the school must have points on, the
   * category must be active, and its kind must be the record's kind (a
   * "Helping others" commendation cannot score a concern).
   */
  private async usableCategory(
    db: Db,
    schoolId: string,
    categoryId: string,
    kind: BehaviourRecordDto["kind"],
  ): Promise<{ id: string; name: string; points: number }> {
    const school = await db.school.findUnique({ where: { id: schoolId }, select: { behaviourPointsEnabled: true } });
    if (!school?.behaviourPointsEnabled) {
      throw new ConflictError("BEHAVIOUR_POINTS_OFF", "Points are switched off for this school.");
    }
    const category = await db.behaviourCategory.findUnique({ where: { id: categoryId } });
    if (!category || !category.active) throw new NotFoundError("That category could not be found.");
    if (category.kind !== kind) {
      throw new ValidationError(
        kind === "COMMENDATION" ? "Choose a commendation category." : "Choose a concern category.",
      );
    }
    return { id: category.id, name: category.name, points: category.points };
  }

  /**
   * The student's points this term: live records dated inside the current
   * term. Null when the school has points off or no current term, so a page
   * never shows a misleading zero.
   */
  private async termPoints(db: Db, schoolId: string, studentId: string): Promise<number | null> {
    const school = await db.school.findUnique({ where: { id: schoolId }, select: { behaviourPointsEnabled: true } });
    if (!school?.behaviourPointsEnabled) return null;
    const term = await db.term.findFirst({ where: { isCurrent: true }, select: { startDate: true, endDate: true } });
    if (!term) return null;
    const sum = await db.behaviourRecord.aggregate({
      where: {
        studentId,
        withdrawnAt: null,
        points: { not: null },
        occurredOn: { gte: term.startDate, lte: term.endDate },
      },
      _sum: { points: true },
    });
    return sum._sum.points ?? 0;
  }

  private async assertNameFree(db: Db, name: string, exceptId: string | null): Promise<void> {
    const clash = await db.behaviourCategory.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new ConflictError("BEHAVIOUR_CATEGORY_EXISTS", "There is already a category with that name.");
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
    db: Db,
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
