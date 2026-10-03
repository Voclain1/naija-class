import { Injectable } from "@nestjs/common";

import { withTenant, type Prisma } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  optionOrderFor,
  type CreateExamPaperInput,
  type DrawQuestionsInput,
  type ExamPaperDto,
  type ExamPaperExportDto,
  type ExamPaperOutOfDto,
  type ExamPaperOutOfQuery,
  type ExamPaperSummaryDto,
  type ExportExamPaperQuery,
  type ListExamPapersQuery,
  type QuestionDto,
  type SaveExamPaperInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf, getActiveUserRoleKeys } from "../../common/auth/role-check.js";
import { QuestionBankService, type RequestMeta } from "../question-bank/question-bank.service.js";

// ---------------------------------------------------------------------------
// Phase 8c / CP5c — exam papers (docs/modules/phase-8.md §22.3).
//
// Scope is the question bank's (D62): a teacher works on papers for the
// (class level, subject) pairs they teach; owner/admin on any. Out-of-scope
// reads are 404 — a paper's existence is exam content too.
//
// A FINAL paper is frozen. The service refuses to change one, AND the database
// refuses (the exam_paper_frozen_guard trigger), because "what was printed and
// what is stored never disagree" is the promise the feature rests on.
//
// Only FINAL papers export. Every export is audited with its version: a
// question paper leaving the system is the most sensitive thing this module
// does, and "who printed version C, and when" must be answerable.
// ---------------------------------------------------------------------------

const AUDIT = {
  create: "exam-paper.create",
  update: "exam-paper.update",
  finalise: "exam-paper.finalise",
  duplicate: "exam-paper.duplicate",
  delete: "exam-paper.delete",
  export: "exam-paper.export",
} as const;

const STAFF_ROLES = ["owner", "admin", "teacher"] as const;

const DEFAULT_SECTIONS = [
  { title: "Section A — Objectives", instructions: "Answer all questions. Choose the correct option." },
  { title: "Section B — Theory", instructions: "Answer the questions in this section." },
];

type Db = Parameters<Parameters<typeof withTenant>[1]>[0];
type Scope = { all: true } | { all: false; pairs: Set<string> };
const pairKey = (classLevelId: string, subjectId: string) => `${classLevelId}:${subjectId}`;

const PAPER_INCLUDE = {
  subject: { select: { name: true } },
  classLevel: { select: { name: true } },
  term: { select: { name: true, academicYear: { select: { label: true } } } },
  component: { select: { label: true } },
  sections: {
    orderBy: { orderIndex: "asc" },
    include: { items: { orderBy: { orderIndex: "asc" }, select: { id: true, questionId: true } } },
  },
} satisfies Prisma.ExamPaperInclude;

type PaperRow = Prisma.ExamPaperGetPayload<{ include: typeof PAPER_INCLUDE }>;

@Injectable()
export class ExamPapersService {
  constructor(private readonly questions: QuestionBankService) {}

  // -------------------------------------------------------------------------
  // Scope — the bank's pairs, reused rather than re-derived
  // -------------------------------------------------------------------------

  private async resolveScope(authCtx: AuthContext): Promise<Scope> {
    const roles = await getActiveUserRoleKeys(authCtx);
    if (roles.includes("owner") || roles.includes("admin")) return { all: true };
    const scope = await this.questions.getScope(authCtx);
    return { all: false, pairs: new Set(scope.pairs.map((p) => pairKey(p.classLevelId, p.subjectId))) };
  }

  private inScope(scope: Scope, classLevelId: string, subjectId: string): boolean {
    return scope.all || scope.pairs.has(pairKey(classLevelId, subjectId));
  }

  private async load(db: Db, scope: Scope, id: string): Promise<PaperRow> {
    const row = await db.examPaper.findUnique({ where: { id }, include: PAPER_INCLUDE });
    if (!row || !this.inScope(scope, row.classLevelId, row.subjectId)) {
      throw new NotFoundError("That exam paper could not be found.");
    }
    return row;
  }

  private async loadDraft(db: Db, scope: Scope, id: string): Promise<PaperRow> {
    const row = await this.load(db, scope, id);
    if (row.status === "FINAL") {
      throw new ConflictError("PAPER_FINAL", "This paper is final and cannot be changed. Duplicate it to make a new version.");
    }
    return row;
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(authCtx: AuthContext, query: ListExamPapersQuery): Promise<ExamPaperSummaryDto[]> {
    const scope = await this.resolveScope(authCtx);
    if (!scope.all && scope.pairs.size === 0) return [];
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.examPaper.findMany({
        where: {
          ...(query.subjectId ? { subjectId: query.subjectId } : {}),
          ...(query.classLevelId ? { classLevelId: query.classLevelId } : {}),
          ...(query.termId ? { termId: query.termId } : {}),
          ...(scope.all
            ? {}
            : {
                OR: [...scope.pairs].map((k) => {
                  const [classLevelId, subjectId] = k.split(":") as [string, string];
                  return { classLevelId, subjectId };
                }),
              }),
        },
        include: PAPER_INCLUDE,
        orderBy: { updatedAt: "desc" },
        take: 200,
      });
      const questions = await this.questionsFor(db, authCtx, rows);
      const names = await this.namesFor(db, rows);
      return rows.map((r) => this.toSummary(r, questions, names));
    });
  }

  async get(authCtx: AuthContext, id: string): Promise<ExamPaperDto> {
    const scope = await this.resolveScope(authCtx);
    return withTenant(authCtx.schoolId, async (db) => this.toDto(db, authCtx, await this.load(db, scope, id)));
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  async create(authCtx: AuthContext, input: CreateExamPaperInput, meta: RequestMeta): Promise<ExamPaperDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const scope = await this.resolveScope(authCtx);
    if (!this.inScope(scope, input.classLevelId, input.subjectId)) {
      throw new ForbiddenError("You can only set papers for a class level and subject you teach.");
    }
    return withTenant(authCtx.schoolId, async (db) => {
      const [level, subject, term] = await Promise.all([
        db.classLevel.findUnique({ where: { id: input.classLevelId }, select: { id: true } }),
        db.subject.findUnique({ where: { id: input.subjectId }, select: { id: true } }),
        db.term.findUnique({ where: { id: input.termId }, select: { id: true } }),
      ]);
      if (!level) throw new NotFoundError("That class level could not be found.");
      if (!subject) throw new NotFoundError("That subject could not be found.");
      if (!term) throw new NotFoundError("That term could not be found.");
      await this.assertComponent(db, input.componentId);

      const created = await db.examPaper.create({
        data: {
          schoolId: authCtx.schoolId,
          subjectId: input.subjectId,
          classLevelId: input.classLevelId,
          termId: input.termId,
          componentId: input.componentId ?? null,
          title: input.title,
          durationMinutes: input.durationMinutes,
          instructions: input.instructions?.trim() || null,
          versionCount: input.versionCount,
          createdBy: authCtx.userId,
          sections: {
            create: DEFAULT_SECTIONS.map((s, i) => ({ schoolId: authCtx.schoolId, orderIndex: i, ...s })),
          },
        },
        include: PAPER_INCLUDE,
      });
      await this.audit(db, authCtx, AUDIT.create, created.id, meta, { subjectId: input.subjectId, classLevelId: input.classLevelId });
      return this.toDto(db, authCtx, created);
    });
  }

  /** Replace a draft's header and its whole section structure. */
  async save(authCtx: AuthContext, id: string, input: SaveExamPaperInput, meta: RequestMeta): Promise<ExamPaperDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const scope = await this.resolveScope(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const paper = await this.loadDraft(db, scope, id);
      await this.assertComponent(db, input.componentId);

      // Every question must be this paper's subject and level, and APPROVED
      // now. (One retired since being added is caught at finalise instead, so
      // a teacher can still save the rest of their edits around it.)
      const ids = input.sections.flatMap((s) => s.questionIds);
      const found = await db.question.findMany({
        where: { id: { in: ids } },
        select: { id: true, subjectId: true, classLevelId: true, status: true },
      });
      const byId = new Map(found.map((q) => [q.id, q]));
      const already = new Set(paper.sections.flatMap((s) => s.items.map((i) => i.questionId)));
      const issues: { path: (string | number)[]; message: string }[] = [];
      input.sections.forEach((section, si) =>
        section.questionIds.forEach((qid, qi) => {
          const q = byId.get(qid);
          const path = ["sections", si, "questionIds", qi];
          if (!q || q.subjectId !== paper.subjectId || q.classLevelId !== paper.classLevelId) {
            issues.push({ path, message: "That question is not in this subject and class's bank." });
          } else if (q.status === "DRAFT" || (q.status === "RETIRED" && !already.has(qid))) {
            issues.push({ path, message: "Only approved questions can go in a paper." });
          }
        }),
      );
      if (issues.length) throw new ValidationError("Some questions cannot go in this paper.", { issues });

      // Replace the structure. Sections cascade their items.
      await db.examPaperSection.deleteMany({ where: { paperId: id } });
      for (const [si, section] of input.sections.entries()) {
        await db.examPaperSection.create({
          data: {
            schoolId: authCtx.schoolId,
            paperId: id,
            orderIndex: si,
            title: section.title,
            instructions: section.instructions?.trim() || null,
            items: {
              create: section.questionIds.map((questionId, qi) => ({
                schoolId: authCtx.schoolId,
                paperId: id,
                questionId,
                orderIndex: qi,
              })),
            },
          },
        });
      }
      const updated = await db.examPaper.update({
        where: { id },
        data: {
          title: input.title,
          durationMinutes: input.durationMinutes,
          instructions: input.instructions?.trim() || null,
          componentId: input.componentId ?? null,
          versionCount: input.versionCount,
        },
        include: PAPER_INCLUDE,
      });
      await this.audit(db, authCtx, AUDIT.update, id, meta, { questions: ids.length });
      return this.toDto(db, authCtx, updated);
    });
  }

  /** Freeze a draft for printing. The same people who approve questions do it (D62). */
  async finalise(authCtx: AuthContext, id: string, meta: RequestMeta): Promise<ExamPaperDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const scope = await this.resolveScope(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const paper = await this.loadDraft(db, scope, id);
      const dto = await this.toDto(db, authCtx, paper);
      if (dto.problems.length) {
        throw new ConflictError("PAPER_NOT_READY", dto.problems[0]!, { problems: dto.problems });
      }
      const finalised = await db.examPaper.update({
        where: { id },
        data: { status: "FINAL", finalisedBy: authCtx.userId, finalisedAt: new Date() },
        include: PAPER_INCLUDE,
      });
      await this.audit(db, authCtx, AUDIT.finalise, id, meta, { totalMarks: dto.totalMarks, questions: dto.questionCount });
      return this.toDto(db, authCtx, finalised);
    });
  }

  /** A new DRAFT copy — the only way to change a FINAL paper. */
  async duplicate(authCtx: AuthContext, id: string, meta: RequestMeta): Promise<ExamPaperDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const scope = await this.resolveScope(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const source = await this.load(db, scope, id);
      const copy = await db.examPaper.create({
        data: {
          schoolId: authCtx.schoolId,
          subjectId: source.subjectId,
          classLevelId: source.classLevelId,
          termId: source.termId,
          componentId: source.componentId,
          title: `${source.title} (copy)`.slice(0, 200),
          durationMinutes: source.durationMinutes,
          instructions: source.instructions,
          versionCount: source.versionCount,
          createdBy: authCtx.userId,
          duplicatedFromId: source.id,
        },
        select: { id: true },
      });
      for (const section of source.sections) {
        await db.examPaperSection.create({
          data: {
            schoolId: authCtx.schoolId,
            paperId: copy.id,
            orderIndex: section.orderIndex,
            title: section.title,
            instructions: section.instructions,
            items: {
              create: section.items.map((item, i) => ({
                schoolId: authCtx.schoolId,
                paperId: copy.id,
                questionId: item.questionId,
                orderIndex: i,
              })),
            },
          },
        });
      }
      await this.audit(db, authCtx, AUDIT.duplicate, copy.id, meta, { duplicatedFromId: id });
      return this.toDto(db, authCtx, await this.load(db, scope, copy.id));
    });
  }

  async remove(authCtx: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const scope = await this.resolveScope(authCtx);
    await withTenant(authCtx.schoolId, async (db) => {
      await this.loadDraft(db, scope, id);
      await db.examPaper.delete({ where: { id } });
      await this.audit(db, authCtx, AUDIT.delete, id, meta, {});
    });
  }

  /** Approved questions at random, of one type (and topic), not already used. */
  async draw(authCtx: AuthContext, input: DrawQuestionsInput): Promise<QuestionDto[]> {
    const scope = await this.resolveScope(authCtx);
    if (!this.inScope(scope, input.classLevelId, input.subjectId)) {
      throw new ForbiddenError("You can only set papers for a class level and subject you teach.");
    }
    return withTenant(authCtx.schoolId, async (db) => {
      const candidates = await db.question.findMany({
        where: {
          subjectId: input.subjectId,
          classLevelId: input.classLevelId,
          type: input.type,
          status: "APPROVED",
          id: { notIn: input.excludeIds },
          ...(input.topic ? { topic: { contains: input.topic, mode: "insensitive" } } : {}),
        },
        select: { id: true },
      });
      // Partial Fisher–Yates: the first `count` of a uniform shuffle. Fairness
    // here is about not always picking the newest questions, not security.
      const ids = candidates.map((c) => c.id);
      const take = Math.min(input.count, ids.length);
      for (let i = 0; i < take; i += 1) {
        const j = i + Math.floor(Math.random() * (ids.length - i));
        [ids[i], ids[j]] = [ids[j]!, ids[i]!];
      }
      return this.questions.decorateByIds(db, ids.slice(0, take));
    });
  }

  // -------------------------------------------------------------------------
  // Export — FINAL only, per version, audited
  // -------------------------------------------------------------------------

  async exportData(authCtx: AuthContext, id: string, query: ExportExamPaperQuery, meta: RequestMeta): Promise<ExamPaperExportDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const scope = await this.resolveScope(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const paper = await this.load(db, scope, id);
      if (paper.status !== "FINAL") {
        throw new ConflictError("PAPER_NOT_FINAL", "Finalise the paper before printing or exporting it.");
      }
      const versionIndex = ["A", "B", "C", "D"].indexOf(query.version);
      if (versionIndex >= paper.versionCount) {
        throw new ValidationError(`This paper is set with ${paper.versionCount} version${paper.versionCount === 1 ? "" : "s"}.`);
      }
      const dto = await this.toDto(db, authCtx, paper);
      const school = await db.school.findUnique({ where: { id: authCtx.schoolId }, select: { name: true } });
      const itemIds = new Map(paper.sections.flatMap((s) => s.items.map((i) => [i.questionId, i.id] as const)));

      let number = 0;
      const sections = dto.sections.map((section) => ({
        title: section.title,
        instructions: section.instructions,
        marks: section.marks,
        questions: section.questions.map((q) => {
          number += 1;
          const order = optionOrderFor(query.version, `${paper.id}:${itemIds.get(q.id)}`, q.options.length);
          const options = order.map((from, to) => ({ letter: String.fromCharCode(65 + to), text: q.options[from]!.text }));
          const correctTo = order.findIndex((from) => q.options[from]!.isCorrect);
          return {
            number,
            type: q.type,
            text: q.text,
            marks: q.marks,
            options,
            correctLetter: q.type === "MULTIPLE_CHOICE" && correctTo >= 0 ? String.fromCharCode(65 + correctTo) : null,
            answerGuide: q.answerGuide,
          };
        }),
      }));

      await this.audit(db, authCtx, AUDIT.export, id, meta, { version: query.version });
      return {
        version: query.version,
        versionCount: paper.versionCount,
        schoolName: school?.name ?? "",
        title: paper.title,
        subjectName: paper.subject.name,
        classLevelName: paper.classLevel.name,
        termName: paper.term.name,
        academicYearLabel: paper.term.academicYear.label,
        durationMinutes: paper.durationMinutes,
        instructions: paper.instructions,
        totalMarks: dto.totalMarks,
        sections,
      };
    });
  }

  /** FINAL papers set for a gradebook column of this arm's level — its "Out of" (CP5a). */
  async outOf(authCtx: AuthContext, query: ExamPaperOutOfQuery): Promise<ExamPaperOutOfDto> {
    const scope = await this.resolveScope(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const arm = await db.classArm.findUnique({ where: { id: query.classArmId }, select: { classLevelId: true } });
      if (!arm || !this.inScope(scope, arm.classLevelId, query.subjectId)) return { papers: [] };
      const rows = await db.examPaper.findMany({
        where: {
          termId: query.termId,
          subjectId: query.subjectId,
          classLevelId: arm.classLevelId,
          status: "FINAL",
          componentId: { not: null },
        },
        include: PAPER_INCLUDE,
        orderBy: { finalisedAt: "desc" },
      });
      const questions = await this.questionsFor(db, authCtx, rows);
      // The most recently finalised paper per column.
      const seen = new Set<string>();
      const papers: ExamPaperOutOfDto["papers"] = [];
      for (const row of rows) {
        if (seen.has(row.componentId!)) continue;
        seen.add(row.componentId!);
        papers.push({ componentId: row.componentId!, paperId: row.id, title: row.title, totalMarks: this.totalOf(row, questions) });
      }
      return { papers };
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async assertComponent(db: Db, componentId: string | null | undefined): Promise<void> {
    if (!componentId) return;
    const component = await db.gradingComponent.findUnique({ where: { id: componentId }, select: { id: true } });
    if (!component) throw new NotFoundError("That gradebook column could not be found.");
  }

  /** The questions a set of papers reference, as the bank shows them. */
  private async questionsFor(db: Db, _authCtx: AuthContext, rows: PaperRow[]): Promise<Map<string, QuestionDto>> {
    const ids = [...new Set(rows.flatMap((r) => r.sections.flatMap((s) => s.items.map((i) => i.questionId))))];
    if (ids.length === 0) return new Map();
    const list = await this.questions.decorateByIds(db, ids);
    return new Map(list.map((q) => [q.id, q]));
  }

  private async namesFor(db: Db, rows: PaperRow[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.flatMap((r) => [r.createdBy, r.finalisedBy]).filter((v): v is string => Boolean(v)))];
    const users = ids.length
      ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
  }

  private totalOf(row: PaperRow, questions: Map<string, QuestionDto>): number {
    return row.sections.reduce(
      (sum, s) => sum + s.items.reduce((acc, i) => acc + (questions.get(i.questionId)?.marks ?? 0), 0),
      0,
    );
  }

  private toSummary(row: PaperRow, questions: Map<string, QuestionDto>, names: Map<string, string>): ExamPaperSummaryDto {
    return {
      id: row.id,
      subjectId: row.subjectId,
      subjectName: row.subject.name,
      classLevelId: row.classLevelId,
      classLevelName: row.classLevel.name,
      termId: row.termId,
      termName: `${row.term.name} ${row.term.academicYear.label}`,
      componentId: row.componentId,
      componentLabel: row.component?.label ?? null,
      title: row.title,
      durationMinutes: row.durationMinutes,
      instructions: row.instructions,
      versionCount: row.versionCount,
      status: row.status,
      totalMarks: this.totalOf(row, questions),
      questionCount: row.sections.reduce((n, s) => n + s.items.length, 0),
      createdBy: row.createdBy,
      createdByName: names.get(row.createdBy) ?? null,
      finalisedByName: row.finalisedBy ? (names.get(row.finalisedBy) ?? null) : null,
      finalisedAt: row.finalisedAt,
      duplicatedFromId: row.duplicatedFromId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async toDto(db: Db, authCtx: AuthContext, row: PaperRow): Promise<ExamPaperDto> {
    const questions = await this.questionsFor(db, authCtx, [row]);
    const names = await this.namesFor(db, [row]);
    const sections = row.sections.map((s) => {
      const qs = s.items.map((i) => questions.get(i.questionId)).filter((q): q is QuestionDto => Boolean(q));
      return { id: s.id, title: s.title, instructions: s.instructions, marks: qs.reduce((n, q) => n + q.marks, 0), questions: qs };
    });
    const problems: string[] = [];
    const count = sections.reduce((n, s) => n + s.questions.length, 0);
    if (count === 0) problems.push("Add at least one question before finalising.");
    const empty = sections.filter((s) => s.questions.length === 0);
    if (count > 0 && empty.length) {
      problems.push(`Remove or fill the empty section${empty.length === 1 ? "" : "s"}: ${empty.map((s) => s.title).join(", ")}.`);
    }
    const retired = sections.flatMap((s) => s.questions).filter((q) => q.status !== "APPROVED");
    if (retired.length) {
      problems.push(
        `${retired.length} question${retired.length === 1 ? " has" : "s have"} been retired since ${retired.length === 1 ? "it was" : "they were"} added. Replace ${retired.length === 1 ? "it" : "them"} before finalising.`,
      );
    }
    return { ...this.toSummary(row, questions, names), sections, problems: row.status === "FINAL" ? [] : problems };
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
        entityType: "exam-paper",
        entityId,
        ipAddress: meta.ipAddress ?? null,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}
