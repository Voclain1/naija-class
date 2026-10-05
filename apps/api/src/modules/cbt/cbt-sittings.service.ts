import { Injectable } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  formatUnlockCode,
  optionOrderFor,
  versionForCandidate,
  versionsOf,
  type CbtCandidateProgressDto,
  type CbtCandidateRowDto,
  type CbtInvigilatorSheetDto,
  type CbtPackCandidate,
  type CbtPackPayload,
  type CbtPackSection,
  type CbtSchedulablePaperDto,
  type CbtSittingDto,
  type CbtSittingSummaryDto,
  type CreateCbtSittingInput,
  type ListCbtSittingsQuery,
  type PaperVersion,
  type UpdateCbtSittingInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf, getActiveUserRoleKeys } from "../../common/auth/role-check.js";
import { QuestionBankService, type RequestMeta } from "../question-bank/question-bank.service.js";
import { buildPackEnvelope, newAccessCode, newUnlockCode } from "./cbt-pack-crypto.js";

// ---------------------------------------------------------------------------
// Online exams (CBT1) — sittings (docs/modules/cbt.md D1–D4).
//
// Scope is the exam papers' (D62): a teacher schedules sittings for papers in
// the (class level, subject) pairs they teach; owner/admin for any. An
// out-of-scope sitting is a 404, like a paper.
//
// Publishing freezes the candidates and builds the encrypted pack. The answer
// key never goes into it (D4).
// ---------------------------------------------------------------------------

const AUDIT = {
  create: "cbt-sitting.create",
  update: "cbt-sitting.update",
  delete: "cbt-sitting.delete",
  publish: "cbt-sitting.publish",
  unpublish: "cbt-sitting.unpublish",
  close: "cbt-sitting.close",
  viewCodes: "cbt-sitting.view-codes",
} as const;

const STAFF_ROLES = ["owner", "admin", "teacher"] as const;
const ACCESS_CODE_ATTEMPTS = 8;

export type Db = Parameters<Parameters<typeof withTenant>[1]>[0];
export type Scope = { all: true } | { all: false; pairs: Set<string> };
const pairKey = (classLevelId: string, subjectId: string) => `${classLevelId}:${subjectId}`;

const PAPER_INCLUDE = {
  subject: { select: { name: true } },
  classLevel: { select: { name: true } },
  term: { select: { name: true } },
  sections: {
    orderBy: { orderIndex: "asc" },
    include: {
      items: {
        orderBy: { orderIndex: "asc" },
        include: {
          question: {
            select: {
              id: true,
              type: true,
              text: true,
              marks: true,
              options: { orderBy: { orderIndex: "asc" }, select: { id: true, text: true, isCorrect: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ExamPaperInclude;
type PaperRow = Prisma.ExamPaperGetPayload<{ include: typeof PAPER_INCLUDE }>;
type ItemRow = PaperRow["sections"][number]["items"][number];

const SITTING_INCLUDE = {
  paper: { include: PAPER_INCLUDE },
  arms: { include: { classArm: { select: { name: true } } } },
  _count: { select: { candidates: true } },
} satisfies Prisma.CbtSittingInclude;
export type SittingRow = Prisma.CbtSittingGetPayload<{ include: typeof SITTING_INCLUDE }>;

/** Multiple choice with at least two options and exactly one correct (D1). */
export function isDeliverable(item: ItemRow): boolean {
  const q = item.question;
  return q.type === "MULTIPLE_CHOICE" && q.options.length >= 2 && q.options.filter((o) => o.isCorrect).length === 1;
}

/** One student's attempts across machines, summed up for staff on the day. */
function progressOf(
  attempts: { answeredCount: number; submittedAt: Date | null; lastReceivedAt: Date }[],
): CbtCandidateProgressDto | null {
  if (attempts.length === 0) return null;
  return {
    machines: attempts.length,
    answeredCount: Math.max(...attempts.map((a) => a.answeredCount)),
    submitted: attempts.some((a) => a.submittedAt !== null),
    lastReceivedAt: new Date(Math.max(...attempts.map((a) => a.lastReceivedAt.getTime()))).toISOString(),
  };
}

export function paperFigures(paper: PaperRow) {
  const items = paper.sections.flatMap((s) => s.items);
  const objective = items.filter(isDeliverable);
  const onPaper = items.filter((i) => !isDeliverable(i));
  const sum = (rows: ItemRow[]) => rows.reduce((t, i) => t + i.question.marks, 0);
  return {
    objectiveQuestionCount: objective.length,
    objectiveTotal: sum(objective),
    onPaperQuestionCount: onPaper.length,
    onPaperTotal: sum(onPaper),
    paperTotal: sum(items),
  };
}

@Injectable()
export class CbtSittingsService {
  constructor(private readonly questions: QuestionBankService) {}

  // -------------------------------------------------------------------------
  // Scope — the question bank's pairs, as for exam papers
  // -------------------------------------------------------------------------

  /** Also used by CbtResultsService: the same scope and 404 rule. */
  async resolveScope(authCtx: AuthContext): Promise<Scope> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const roles = await getActiveUserRoleKeys(authCtx);
    if (roles.includes("owner") || roles.includes("admin")) return { all: true };
    const scope = await this.questions.getScope(authCtx);
    return { all: false, pairs: new Set(scope.pairs.map((p) => pairKey(p.classLevelId, p.subjectId))) };
  }

  private inScope(scope: Scope, classLevelId: string, subjectId: string): boolean {
    return scope.all || scope.pairs.has(pairKey(classLevelId, subjectId));
  }

  async load(db: Db, scope: Scope, id: string): Promise<SittingRow> {
    const row = await db.cbtSitting.findUnique({ where: { id }, include: SITTING_INCLUDE });
    if (!row || !this.inScope(scope, row.paper.classLevelId, row.paper.subjectId)) {
      throw new NotFoundError("That online exam could not be found.");
    }
    return row;
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** FINAL papers in scope with at least one deliverable question (D1). */
  async schedulablePapers(authCtx: AuthContext): Promise<CbtSchedulablePaperDto[]> {
    const scope = await this.resolveScope(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const papers = await db.examPaper.findMany({
        where: { status: "FINAL" },
        include: PAPER_INCLUDE,
        orderBy: { finalisedAt: "desc" },
      });
      const usable = papers.filter((p) => this.inScope(scope, p.classLevelId, p.subjectId));
      const levelIds = [...new Set(usable.map((p) => p.classLevelId))];
      const arms = await db.classArm.findMany({
        where: { classLevelId: { in: levelIds }, isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, classLevelId: true },
      });
      return usable
        .map((p) => ({ p, f: paperFigures(p) }))
        .filter(({ f }) => f.objectiveQuestionCount > 0)
        .map(({ p, f }) => ({
          id: p.id,
          title: p.title,
          subjectId: p.subjectId,
          subjectName: p.subject.name,
          classLevelId: p.classLevelId,
          classLevelName: p.classLevel.name,
          termId: p.termId,
          termName: p.term.name,
          durationMinutes: p.durationMinutes,
          objectiveQuestionCount: f.objectiveQuestionCount,
          objectiveTotal: f.objectiveTotal,
          onPaperQuestionCount: f.onPaperQuestionCount,
          arms: arms.filter((a) => a.classLevelId === p.classLevelId).map((a) => ({ id: a.id, name: a.name })),
        }));
    });
  }

  async list(authCtx: AuthContext, query: ListCbtSittingsQuery): Promise<CbtSittingSummaryDto[]> {
    const scope = await this.resolveScope(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.cbtSitting.findMany({
        where: query.status ? { status: query.status } : {},
        include: SITTING_INCLUDE,
        orderBy: { startsAt: "desc" },
      });
      const visible = rows.filter((r) => this.inScope(scope, r.paper.classLevelId, r.paper.subjectId));
      const counts = await this.liveCounts(db, visible);
      return visible.map((r) => this.toSummary(r, counts.get(r.id)));
    });
  }

  async get(authCtx: AuthContext, id: string): Promise<CbtSittingDto> {
    const scope = await this.resolveScope(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await this.load(db, scope, id);
      const counts = await this.liveCounts(db, [row]);
      return this.toDto(row, counts.get(row.id));
    });
  }

  async candidates(authCtx: AuthContext, id: string): Promise<CbtCandidateRowDto[]> {
    const scope = await this.resolveScope(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await this.load(db, scope, id);
      if (row.status === "DRAFT") return (await this.enrolled(db, row)).map(({ student, armName }) => ({
        studentId: student.id,
        admissionNumber: student.admissionNumber,
        firstName: student.firstName,
        lastName: student.lastName,
        armName,
        version: versionForCandidate(row.id, student.id, row.paper.versionCount),
        progress: null,
      }));
      const candidates = await db.cbtCandidate.findMany({
        where: { sittingId: id },
        include: {
          student: { select: { admissionNumber: true, firstName: true, lastName: true } },
          classArm: { select: { name: true } },
          attempts: { select: { answeredCount: true, submittedAt: true, lastReceivedAt: true } },
        },
      });
      return candidates
        .map((c) => ({
          studentId: c.studentId,
          admissionNumber: c.student.admissionNumber,
          firstName: c.student.firstName,
          lastName: c.student.lastName,
          armName: c.classArm.name,
          version: c.version,
          progress: progressOf(c.attempts),
        }))
        .sort((a, b) => a.armName.localeCompare(b.armName) || a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
    });
  }

  /** The codes (D3). cbt.manage only, and every read is audited. */
  async invigilatorSheet(authCtx: AuthContext, id: string, meta: RequestMeta): Promise<CbtInvigilatorSheetDto> {
    const scope = await this.resolveScope(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await this.load(db, scope, id);
      if (row.status === "DRAFT") {
        throw new ConflictError("SITTING_NOT_PUBLISHED", "Publish the online exam to get its codes.");
      }
      const school = await db.school.findUniqueOrThrow({ where: { id: authCtx.schoolId }, select: { name: true, slug: true } });
      await this.audit(db, authCtx, AUDIT.viewCodes, id, meta, {});
      return {
        sittingId: row.id,
        schoolName: school.name,
        schoolSlug: school.slug,
        title: row.title,
        subjectName: row.paper.subject.name,
        classLevelName: row.paper.classLevel.name,
        armNames: row.arms.map((a) => a.classArm.name).sort(),
        startsAt: row.startsAt.toISOString(),
        windowEndsAt: row.windowEndsAt.toISOString(),
        durationMinutes: row.durationMinutes,
        candidateCount: row._count.candidates,
        accessCode: row.accessCode,
        unlockCode: formatUnlockCode(row.unlockCode),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  async create(authCtx: AuthContext, input: CreateCbtSittingInput, meta: RequestMeta): Promise<CbtSittingDto> {
    const scope = await this.resolveScope(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const paper = await db.examPaper.findUnique({ where: { id: input.paperId }, include: PAPER_INCLUDE });
      if (!paper || !this.inScope(scope, paper.classLevelId, paper.subjectId)) {
        throw new NotFoundError("That exam paper could not be found.");
      }
      if (paper.status !== "FINAL") {
        throw new ConflictError("PAPER_NOT_FINAL", "Finalise the paper before scheduling it as an online exam.");
      }
      if (paperFigures(paper).objectiveQuestionCount === 0) {
        throw new ConflictError(
          "PAPER_HAS_NO_OBJECTIVES",
          "This paper has no multiple-choice questions, so there is nothing to sit online.",
        );
      }
      await this.assertArms(db, paper.classLevelId, input.classArmIds);
      this.assertTimes(input);

      const id = await this.createWithUniqueCode(db, authCtx, input);
      await this.audit(db, authCtx, AUDIT.create, id, meta, { paperId: paper.id, classArmIds: input.classArmIds });
      const row = await this.load(db, scope, id);
      return this.toDto(row, (await this.liveCounts(db, [row])).get(id));
    });
  }

  async update(authCtx: AuthContext, id: string, input: UpdateCbtSittingInput, meta: RequestMeta): Promise<CbtSittingDto> {
    const scope = await this.resolveScope(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await this.load(db, scope, id);
      this.assertDraft(row);
      await this.assertArms(db, row.paper.classLevelId, input.classArmIds);
      this.assertTimes(input);
      await db.cbtSitting.update({
        where: { id },
        data: {
          title: input.title,
          startsAt: new Date(input.startsAt),
          windowEndsAt: new Date(input.windowEndsAt),
          durationMinutes: input.durationMinutes,
        },
      });
      await db.cbtSittingArm.deleteMany({ where: { sittingId: id } });
      await db.cbtSittingArm.createMany({
        data: [...new Set(input.classArmIds)].map((classArmId) => ({ sittingId: id, classArmId, schoolId: authCtx.schoolId })),
      });
      await this.audit(db, authCtx, AUDIT.update, id, meta, { classArmIds: input.classArmIds });
      const fresh = await this.load(db, scope, id);
      return this.toDto(fresh, (await this.liveCounts(db, [fresh])).get(id));
    });
  }

  async remove(authCtx: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    const scope = await this.resolveScope(authCtx);
    await withTenant(authCtx.schoolId, async (db) => {
      const row = await this.load(db, scope, id);
      this.assertDraft(row);
      await db.cbtSitting.delete({ where: { id } });
      await this.audit(db, authCtx, AUDIT.delete, id, meta, { title: row.title });
    });
  }

  /** DRAFT → PUBLISHED: freeze the candidates and build the pack (D2, D3). */
  async publish(authCtx: AuthContext, id: string, meta: RequestMeta): Promise<CbtSittingDto> {
    const scope = await this.resolveScope(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await this.load(db, scope, id);
      this.assertDraft(row);
      if (row.paper.status !== "FINAL") {
        throw new ConflictError("PAPER_NOT_FINAL", "The paper is no longer final.");
      }
      const enrolled = await this.enrolled(db, row);
      if (enrolled.length === 0) {
        throw new ConflictError("SITTING_HAS_NO_CANDIDATES", "No students are enrolled in the chosen classes this term.");
      }

      const assigned = enrolled.map(({ student, armId, armName }) => ({
        armId,
        candidate: {
          studentId: student.id,
          admissionNumber: student.admissionNumber,
          // First name and surname initial: enough for "Is this you?" (D5).
          displayName: `${student.firstName} ${student.lastName.slice(0, 1)}.`.trim(),
          armName,
          version: versionForCandidate(row.id, student.id, row.paper.versionCount),
        } satisfies CbtPackCandidate,
      }));
      const candidates = assigned.map((a) => a.candidate);

      await db.cbtCandidate.createMany({
        data: assigned.map(({ armId, candidate }) => ({
          schoolId: authCtx.schoolId,
          sittingId: id,
          studentId: candidate.studentId,
          classArmId: armId,
          version: candidate.version,
        })),
      });

      const school = await db.school.findUniqueOrThrow({ where: { id: authCtx.schoolId }, select: { name: true } });
      const figures = paperFigures(row.paper);
      const payload: CbtPackPayload = {
        format: "school-kit-cbt-pack/1",
        sittingId: row.id,
        schoolId: authCtx.schoolId,
        instructions: row.paper.instructions,
        objectiveTotal: figures.objectiveTotal,
        questionCount: figures.objectiveQuestionCount,
        versions: Object.fromEntries(
          versionsOf(row.paper.versionCount).map((v) => [v, this.sectionsFor(row.paper, v)]),
        ) as CbtPackPayload["versions"],
        candidates,
      };
      const builtAt = new Date();
      const envelope = await buildPackEnvelope(payload, row.unlockCode, {
        schoolName: school.name,
        title: row.title,
        subjectName: row.paper.subject.name,
        classLevelName: row.paper.classLevel.name,
        startsAt: row.startsAt.toISOString(),
        windowEndsAt: row.windowEndsAt.toISOString(),
        durationMinutes: row.durationMinutes,
        candidateCount: candidates.length,
        builtAt: builtAt.toISOString(),
      });

      await db.cbtSitting.update({
        where: { id },
        data: {
          status: "PUBLISHED",
          pack: envelope as unknown as Prisma.InputJsonValue,
          packBuiltAt: builtAt,
          publishedBy: authCtx.userId,
          publishedAt: builtAt,
        },
      });
      await this.audit(db, authCtx, AUDIT.publish, id, meta, { candidateCount: candidates.length });
      const fresh = await this.load(db, scope, id);
      return this.toDto(fresh, undefined);
    }, { timeoutMs: 30_000 });
  }

  /**
   * PUBLISHED → DRAFT, until the start time (D2). The candidates and the pack
   * go; a machine that already downloaded the pack must download it again.
   * Refused once any answers have arrived (the candidate FK on cbt_attempts
   * is RESTRICT too, so the database holds the same rule).
   */
  async unpublish(authCtx: AuthContext, id: string, meta: RequestMeta): Promise<CbtSittingDto> {
    const scope = await this.resolveScope(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await this.load(db, scope, id);
      if (row.status !== "PUBLISHED") {
        throw new ConflictError("SITTING_NOT_PUBLISHED", "Only a published online exam can be taken back to draft.");
      }
      if (row.startsAt.getTime() <= Date.now()) {
        throw new ConflictError("SITTING_STARTED", "This online exam has already started, so it can't go back to draft.");
      }
      if ((await db.cbtAttempt.count({ where: { sittingId: id } })) > 0) {
        throw new ConflictError("SITTING_HAS_ANSWERS", "Students have already sent answers for this exam, so it can't go back to draft.");
      }
      await db.cbtCandidate.deleteMany({ where: { sittingId: id } });
      await db.cbtSitting.update({
        where: { id },
        data: { status: "DRAFT", pack: Prisma.DbNull, packBuiltAt: null, publishedBy: null, publishedAt: null },
      });
      await this.audit(db, authCtx, AUDIT.unpublish, id, meta, {});
      const fresh = await this.load(db, scope, id);
      return this.toDto(fresh, (await this.liveCounts(db, [fresh])).get(id));
    });
  }

  /**
   * PUBLISHED → CLOSED: no more downloads. Answers from a machine that was
   * offline at the close are still kept, and show as arriving after it (D6 —
   * flag, don't reject).
   */
  async close(authCtx: AuthContext, id: string, meta: RequestMeta): Promise<CbtSittingDto> {
    const scope = await this.resolveScope(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await this.load(db, scope, id);
      if (row.status !== "PUBLISHED") {
        throw new ConflictError("SITTING_NOT_PUBLISHED", "Only a published online exam can be closed.");
      }
      await db.cbtSitting.update({ where: { id }, data: { status: "CLOSED", closedBy: authCtx.userId, closedAt: new Date() } });
      await this.audit(db, authCtx, AUDIT.close, id, meta, {});
      return this.toDto(await this.load(db, scope, id), undefined);
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** One version's deliverable questions, options in that version's order, no key. */
  private sectionsFor(paper: PaperRow, version: PaperVersion): CbtPackSection[] {
    let number = 0;
    return paper.sections
      .map((section) => ({
        title: section.title,
        instructions: section.instructions,
        questions: section.items.filter(isDeliverable).map((item) => {
          number += 1;
          const order = optionOrderFor(version, `${paper.id}:${item.id}`, item.question.options.length);
          return {
            itemId: item.id,
            number,
            text: item.question.text,
            marks: item.question.marks,
            options: order.map((from) => ({ id: item.question.options[from]!.id, text: item.question.options[from]!.text })),
          };
        }),
      }))
      .filter((s) => s.questions.length > 0);
  }

  /** Students enrolled in the sitting's arms for the paper's term, now. */
  private async enrolled(db: Db, row: SittingRow) {
    const enrollments = await db.enrollment.findMany({
      where: { termId: row.paper.termId, classArmId: { in: row.arms.map((a) => a.classArmId) }, status: "ENROLLED" },
      include: {
        student: { select: { id: true, admissionNumber: true, firstName: true, lastName: true, status: true } },
        classArm: { select: { name: true } },
      },
    });
    return enrollments
      .filter((e) => e.student.status === "ACTIVE")
      .map((e) => ({ student: e.student, armId: e.classArmId, armName: e.classArm.name }))
      .sort(
        (a, b) =>
          a.armName.localeCompare(b.armName) ||
          a.student.lastName.localeCompare(b.student.lastName) ||
          a.student.firstName.localeCompare(b.student.firstName),
      );
  }

  /** A draft's candidate count is live; a published sitting's is frozen. */
  private async liveCounts(db: Db, rows: SittingRow[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const r of rows.filter((r) => r.status === "DRAFT")) out.set(r.id, (await this.enrolled(db, r)).length);
    return out;
  }

  private async assertArms(db: Db, classLevelId: string, classArmIds: string[]): Promise<void> {
    const ids = [...new Set(classArmIds)];
    const arms = await db.classArm.findMany({ where: { id: { in: ids } }, select: { classLevelId: true } });
    if (arms.length !== ids.length || arms.some((a) => a.classLevelId !== classLevelId)) {
      throw new ValidationError("Choose classes at the paper's level.");
    }
  }

  private assertTimes(input: { startsAt: string; windowEndsAt: string }): void {
    if (new Date(input.windowEndsAt).getTime() <= new Date(input.startsAt).getTime()) {
      throw new ValidationError("The latest start time must be after the start time.");
    }
  }

  private assertDraft(row: SittingRow): void {
    if (row.status !== "DRAFT") {
      throw new ConflictError("SITTING_NOT_DRAFT", "Take the online exam back to draft before changing it.");
    }
  }

  private async createWithUniqueCode(db: Db, authCtx: AuthContext, input: CreateCbtSittingInput): Promise<string> {
    for (let attempt = 0; attempt < ACCESS_CODE_ATTEMPTS; attempt += 1) {
      const accessCode = newAccessCode();
      if (await db.cbtSitting.findFirst({ where: { accessCode }, select: { id: true } })) continue;
      const created = await db.cbtSitting.create({
        data: {
          schoolId: authCtx.schoolId,
          paperId: input.paperId,
          title: input.title,
          startsAt: new Date(input.startsAt),
          windowEndsAt: new Date(input.windowEndsAt),
          durationMinutes: input.durationMinutes,
          accessCode,
          unlockCode: newUnlockCode(),
          createdBy: authCtx.userId,
          arms: {
            create: [...new Set(input.classArmIds)].map((classArmId) => ({ classArmId, schoolId: authCtx.schoolId })),
          },
        },
        select: { id: true },
      });
      return created.id;
    }
    throw new ConflictError("ACCESS_CODE_EXHAUSTED", "Could not make a unique access code. Try again.");
  }

  private toSummary(row: SittingRow, liveCount: number | undefined): CbtSittingSummaryDto {
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      paperId: row.paperId,
      paperTitle: row.paper.title,
      subjectName: row.paper.subject.name,
      classLevelName: row.paper.classLevel.name,
      termName: row.paper.term.name,
      armNames: row.arms.map((a) => a.classArm.name).sort(),
      startsAt: row.startsAt.toISOString(),
      windowEndsAt: row.windowEndsAt.toISOString(),
      durationMinutes: row.durationMinutes,
      candidateCount: row.status === "DRAFT" ? (liveCount ?? 0) : row._count.candidates,
    };
  }

  private toDto(row: SittingRow, liveCount: number | undefined): CbtSittingDto {
    return {
      ...this.toSummary(row, liveCount),
      classLevelId: row.paper.classLevelId,
      subjectId: row.paper.subjectId,
      classArmIds: row.arms.map((a) => a.classArmId),
      versionCount: row.paper.versionCount,
      ...paperFigures(row.paper),
      publishedAt: row.publishedAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
      packBuiltAt: row.packBuiltAt?.toISOString() ?? null,
    };
  }

  private async audit(
    db: Db,
    authCtx: AuthContext,
    action: string,
    entityId: string,
    meta: RequestMeta,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await db.auditLog.create({
      data: {
        schoolId: authCtx.schoolId,
        userId: authCtx.userId,
        action,
        entityType: "cbt-sitting",
        entityId,
        ipAddress: meta.ipAddress ?? null,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}
