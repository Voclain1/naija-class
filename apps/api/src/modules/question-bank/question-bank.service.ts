import { Injectable, Logger } from "@nestjs/common";

import {
  EXAM_QUESTIONS_PROMPT,
  EXAM_QUESTIONS_SCHEMA,
  EXAM_QUESTIONS_SYSTEM,
  promptRef,
  renderExamQuestionsPrompt,
} from "@school-kit/ai";
import { withTenant, type Prisma } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  QUESTION_ANSWER_GUIDE_MAX,
  QUESTION_MARKS_MAX,
  QUESTION_OPTION_TEXT_MAX,
  QUESTION_OPTIONS_MAX,
  QUESTION_TEXT_MAX,
  findQuestionContentError,
  type CreateQuestionInput,
  type GenerateQuestionsInput,
  type GenerateQuestionsResponse,
  type ListQuestionsQuery,
  type QuestionDto,
  type QuestionOptionInput,
  type QuestionScopeDto,
  type QuestionType,
  type UpdateQuestionInput,
} from "@school-kit/types";

import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf, getActiveUserRoleKeys } from "../../common/auth/role-check.js";
import { CurriculumRetrievalService } from "../curriculum/curriculum-retrieval.service.js";
import { getTeacherScope } from "../teacher-scope/teacher-scope.helper.js";

// ---------------------------------------------------------------------------
// Phase 8c / CP5b — the question bank (docs/modules/phase-8.md §22.2).
//
// TWO GATES, as the gradebook has: @Permissions authorises the role, and this
// service holds a teacher to the (class level, subject) pairs they teach. D62
// makes that the APPROVAL rule too — the subject teacher or an admin approves
// — so the same pair check guards reads, writes, approval and AI drafting. A
// teacher out of scope gets a 404 on reads (exam content is not something to
// confirm the existence of) and a 403 on writes.
//
// THE LIFECYCLE (see the Question model): a DRAFT is edited in place; an
// APPROVED question is never edited — an edit makes a new DRAFT that
// supersedes it, and approving that draft retires the original. Every
// AI-drafted question is a DRAFT (the AI hard rule: no AI output is final
// without a person approving it).
//
// Every write re-fetches the user and checks is_active (CLAUDE.md auth rule)
// via assertUserActiveAndHasOneOf, and writes an audit row.
// ---------------------------------------------------------------------------

const AUDIT = {
  create: "question.create",
  update: "question.update",
  revise: "question.revise",
  approve: "question.approve",
  retire: "question.retire",
  discard: "question.discard",
  generate: "question.generate",
} as const;

const STAFF_ROLES = ["owner", "admin", "teacher"] as const;

/** The pairs a caller may work on; `all` for owner/admin. */
type Scope = { all: true } | { all: false; pairs: Set<string> };

const pairKey = (classLevelId: string, subjectId: string) => `${classLevelId}:${subjectId}`;

type Db = Parameters<Parameters<typeof withTenant>[1]>[0];

const QUESTION_INCLUDE = {
  subject: { select: { name: true } },
  classLevel: { select: { name: true } },
  options: { orderBy: { orderIndex: "asc" } },
} satisfies Prisma.QuestionInclude;

type QuestionRow = Prisma.QuestionGetPayload<{ include: typeof QUESTION_INCLUDE }>;

export interface RequestMeta {
  ipAddress?: string | null;
}

@Injectable()
export class QuestionBankService {
  private readonly logger = new Logger(QuestionBankService.name);

  constructor(
    private readonly ai: AiGenerationService,
    private readonly curriculum: CurriculumRetrievalService,
  ) {}

  // -------------------------------------------------------------------------
  // Scope
  // -------------------------------------------------------------------------

  /** What the caller may work on, for the screens' pickers. */
  async getScope(authCtx: AuthContext): Promise<QuestionScopeDto> {
    const scope = await this.resolveScope(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      if (scope.all) {
        // Owner/admin: any active level with any active subject — the admin
        // gradebook's rule. Not the class_subjects matrix: most schools never
        // fill it in, and an admin would be shown nothing.
        const [levels, subjects] = await Promise.all([
          db.classLevel.findMany({ where: { isActive: true }, orderBy: { orderIndex: "asc" }, select: { id: true, name: true } }),
          db.subject.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        ]);
        return { all: true, levels, subjects, pairs: [] };
      }
      const pairs = await this.teacherPairs(db, authCtx.userId);
      const distinct = (items: { id: string; name: string }[]) => [...new Map(items.map((i) => [i.id, i])).values()];
      return {
        all: false,
        levels: distinct(pairs.map((p) => ({ id: p.classLevelId, name: p.classLevelName }))),
        subjects: distinct(pairs.map((p) => ({ id: p.subjectId, name: p.subjectName }))),
        pairs,
      };
    });
  }

  private async resolveScope(authCtx: AuthContext): Promise<Scope> {
    const roles = await getActiveUserRoleKeys(authCtx);
    if (roles.includes("owner") || roles.includes("admin")) return { all: true };
    const pairs = await withTenant(authCtx.schoolId, (db) => this.teacherPairs(db, authCtx.userId));
    return { all: false, pairs: new Set(pairs.map((p) => pairKey(p.classLevelId, p.subjectId))) };
  }

  /**
   * A teacher's (class level, subject) pairs, from their active assignments.
   * A teacher of JSS 2 Gold Mathematics may work on JSS 2 Mathematics — the
   * bank is per level, not per arm. A form-teacher-only arm adds nothing.
   */
  private async teacherPairs(db: Db, userId: string): Promise<QuestionScopeDto["pairs"]> {
    const scope = await getTeacherScope(db as never, userId);
    const byKey = new Map<string, QuestionScopeDto["pairs"][number]>();
    for (const arm of scope.classArms) {
      for (const subject of scope.subjectsByArm.get(arm.id) ?? []) {
        byKey.set(pairKey(arm.classLevelId, subject.id), {
          classLevelId: arm.classLevelId,
          classLevelName: arm.classLevelName,
          subjectId: subject.id,
          subjectName: subject.name,
        });
      }
    }
    return [...byKey.values()].sort(
      (a, b) => a.classLevelName.localeCompare(b.classLevelName) || a.subjectName.localeCompare(b.subjectName),
    );
  }

  private inScope(scope: Scope, classLevelId: string, subjectId: string): boolean {
    return scope.all || scope.pairs.has(pairKey(classLevelId, subjectId));
  }

  private assertWriteScope(scope: Scope, classLevelId: string, subjectId: string): void {
    if (!this.inScope(scope, classLevelId, subjectId)) {
      throw new ForbiddenError("You can only work on questions for a class level and subject you teach.");
    }
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(authCtx: AuthContext, query: ListQuestionsQuery): Promise<QuestionDto[]> {
    const scope = await this.resolveScope(authCtx);
    if (!scope.all && scope.pairs.size === 0) return [];

    return withTenant(authCtx.schoolId, async (db) => {
      const and: Prisma.QuestionWhereInput[] = [];
      if (query.subjectId) and.push({ subjectId: query.subjectId });
      if (query.classLevelId) and.push({ classLevelId: query.classLevelId });
      if (query.type) and.push({ type: query.type });
      // Retired questions are history; they are listed only when asked for.
      and.push(query.status ? { status: query.status } : { status: { not: "RETIRED" } });
      if (query.q) {
        and.push({
          OR: [
            { topic: { contains: query.q, mode: "insensitive" } },
            { text: { contains: query.q, mode: "insensitive" } },
          ],
        });
      }
      if (!scope.all) {
        and.push({
          OR: [...scope.pairs].map((k) => {
            const [classLevelId, subjectId] = k.split(":") as [string, string];
            return { classLevelId, subjectId };
          }),
        });
      }
      const rows = await db.question.findMany({
        where: { AND: and },
        include: QUESTION_INCLUDE,
        orderBy: [{ updatedAt: "desc" }],
        take: 500,
      });
      return this.decorate(db, rows);
    });
  }

  async get(authCtx: AuthContext, id: string): Promise<QuestionDto> {
    const scope = await this.resolveScope(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.question.findUnique({ where: { id }, include: QUESTION_INCLUDE });
      if (!row || !this.inScope(scope, row.classLevelId, row.subjectId)) {
        throw new NotFoundError("That question could not be found.");
      }
      return (await this.decorate(db, [row]))[0]!;
    });
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  async create(authCtx: AuthContext, input: CreateQuestionInput, meta: RequestMeta): Promise<QuestionDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const scope = await this.resolveScope(authCtx);
    this.assertWriteScope(scope, input.classLevelId, input.subjectId);

    return withTenant(authCtx.schoolId, async (db) => {
      await this.assertLevelAndSubject(db, input.classLevelId, input.subjectId);
      const created = await db.question.create({
        data: {
          schoolId: authCtx.schoolId,
          subjectId: input.subjectId,
          classLevelId: input.classLevelId,
          createdBy: authCtx.userId,
          source: "MANUAL",
          ...contentData(input),
          options: { create: optionRows(authCtx.schoolId, input.type, input.options) },
        },
        include: QUESTION_INCLUDE,
      });
      await this.audit(db, authCtx, AUDIT.create, created.id, meta, {
        subjectId: input.subjectId,
        classLevelId: input.classLevelId,
        type: input.type,
      });
      return (await this.decorate(db, [created]))[0]!;
    });
  }

  /**
   * Edit. A DRAFT changes in place. An APPROVED question does not: this makes
   * a new DRAFT that supersedes it, and returns that. A RETIRED one is final.
   */
  async update(authCtx: AuthContext, id: string, input: UpdateQuestionInput, meta: RequestMeta): Promise<QuestionDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const scope = await this.resolveScope(authCtx);

    return withTenant(authCtx.schoolId, async (db) => {
      const current = await this.loadForWrite(db, scope, id);

      if (current.status === "RETIRED") {
        throw new ConflictError("QUESTION_RETIRED", "A retired question cannot be changed.");
      }

      if (current.status === "DRAFT") {
        await db.questionOption.deleteMany({ where: { questionId: id } });
        const updated = await db.question.update({
          where: { id },
          data: {
            ...contentData(input),
            options: { create: optionRows(authCtx.schoolId, input.type, input.options) },
          },
          include: QUESTION_INCLUDE,
        });
        await this.audit(db, authCtx, AUDIT.update, id, meta, {});
        return (await this.decorate(db, [updated]))[0]!;
      }

      // APPROVED: never edited in place.
      const open = await db.question.findFirst({
        where: { supersedesId: id, status: "DRAFT" },
        select: { id: true },
      });
      if (open) {
        throw new ConflictError(
          "REVISION_OPEN",
          "This question already has a draft revision. Edit that draft instead.",
          { revisionId: open.id },
        );
      }
      const revision = await db.question.create({
        data: {
          schoolId: authCtx.schoolId,
          subjectId: current.subjectId,
          classLevelId: current.classLevelId,
          createdBy: authCtx.userId,
          source: "MANUAL",
          supersedesId: id,
          ...contentData(input),
          options: { create: optionRows(authCtx.schoolId, input.type, input.options) },
        },
        include: QUESTION_INCLUDE,
      });
      await this.audit(db, authCtx, AUDIT.revise, revision.id, meta, { supersedesId: id });
      return (await this.decorate(db, [revision]))[0]!;
    });
  }

  /** The human gate (D62). Approving a revision retires what it replaces. */
  async approve(authCtx: AuthContext, id: string, meta: RequestMeta): Promise<QuestionDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const scope = await this.resolveScope(authCtx);

    return withTenant(authCtx.schoolId, async (db) => {
      const current = await this.loadForWrite(db, scope, id);
      if (current.status !== "DRAFT") {
        throw new ConflictError("NOT_A_DRAFT", "Only a draft can be approved.");
      }
      // Re-checked from the stored rows, not trusted from whenever they were
      // written: approval is the moment the question becomes usable.
      const problem = findQuestionContentError({
        type: current.type,
        answerGuide: current.answerGuide,
        options: current.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect })),
      });
      if (problem) throw new ConflictError("QUESTION_INCOMPLETE", problem.message);

      const now = new Date();
      const approved = await db.question.update({
        where: { id },
        data: { status: "APPROVED", approvedBy: authCtx.userId, approvedAt: now },
        include: QUESTION_INCLUDE,
      });
      let retired: string | null = null;
      if (current.supersedesId) {
        const result = await db.question.updateMany({
          where: { id: current.supersedesId, status: "APPROVED" },
          data: { status: "RETIRED", retiredAt: now },
        });
        if (result.count > 0) retired = current.supersedesId;
      }
      await this.audit(db, authCtx, AUDIT.approve, id, meta, {
        source: current.source,
        ...(retired ? { retired } : {}),
      });
      return (await this.decorate(db, [approved]))[0]!;
    });
  }

  /** Take an approved question out of use. Kept, never deleted: a paper may cite it. */
  async retire(authCtx: AuthContext, id: string, meta: RequestMeta): Promise<QuestionDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const scope = await this.resolveScope(authCtx);

    return withTenant(authCtx.schoolId, async (db) => {
      const current = await this.loadForWrite(db, scope, id);
      if (current.status === "DRAFT") {
        throw new ConflictError("NOT_APPROVED", "A draft is discarded, not retired.");
      }
      if (current.status === "RETIRED") {
        throw new ConflictError("QUESTION_RETIRED", "This question is already retired.");
      }
      const retired = await db.question.update({
        where: { id },
        data: { status: "RETIRED", retiredAt: new Date() },
        include: QUESTION_INCLUDE,
      });
      await this.audit(db, authCtx, AUDIT.retire, id, meta, {});
      return (await this.decorate(db, [retired]))[0]!;
    });
  }

  /** Discard a draft. Only drafts are ever deleted. */
  async discard(authCtx: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const scope = await this.resolveScope(authCtx);

    await withTenant(authCtx.schoolId, async (db) => {
      const current = await this.loadForWrite(db, scope, id);
      if (current.status !== "DRAFT") {
        throw new ConflictError("NOT_A_DRAFT", "Only a draft can be discarded. Retire an approved question instead.");
      }
      await db.question.delete({ where: { id } });
      await this.audit(db, authCtx, AUDIT.discard, id, meta, { source: current.source });
    });
  }

  // -------------------------------------------------------------------------
  // AI drafting
  // -------------------------------------------------------------------------

  async generate(authCtx: AuthContext, input: GenerateQuestionsInput, meta: RequestMeta): Promise<GenerateQuestionsResponse> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const scope = await this.resolveScope(authCtx);
    this.assertWriteScope(scope, input.classLevelId, input.subjectId);

    const names = await withTenant(authCtx.schoolId, (db) =>
      this.assertLevelAndSubject(db, input.classLevelId, input.subjectId),
    );

    // Never throws: every failure is an empty result with a reason, and the
    // drafting proceeds ungrounded (phase-7 D18) — a teacher setting a paper
    // must not lose it because the embedding vendor had a bad minute.
    const retrieval = await this.curriculum.retrieve({
      schoolId: authCtx.schoolId,
      subjectId: input.subjectId,
      classLevelId: input.classLevelId,
      query: input.topic,
    });

    // Budget reserved, AI switch checked and the ai_generations row written
    // inside AiGenerationService — the only path to the model.
    const result = await this.ai.generate({
      schoolId: authCtx.schoolId,
      userId: authCtx.userId,
      prompt: EXAM_QUESTIONS_PROMPT,
      system: EXAM_QUESTIONS_SYSTEM,
      userContent: renderExamQuestionsPrompt({
        classLevel: names.classLevelName,
        subject: names.subjectName,
        topic: input.topic,
        type: input.type,
        difficulty: input.difficulty,
        count: input.count,
        groundingChunks: retrieval.chunks.map((c) => ({
          heading: c.heading,
          content: c.content,
          documentTitle: c.documentTitle,
        })),
        groundingAbsenceReason:
          retrieval.reason === "no-documents" || retrieval.reason === "awaiting-review"
            ? "no-documents"
            : retrieval.reason === "no-match"
              ? "no-match"
              : "unavailable",
      }),
      jsonSchema: EXAM_QUESTIONS_SCHEMA,
    });

    const parsed = parseDrafts(result.text, input.type);
    if (!parsed) {
      this.logger.error("exam-questions: model output was not readable JSON");
      throw new InternalError("The drafted questions could not be read. Please try again.");
    }
    const usable = parsed.valid.slice(0, input.count);
    const dropped = parsed.total - usable.length;
    if (usable.length === 0) {
      throw new InternalError("None of the drafted questions could be used. Please try again.");
    }

    return withTenant(authCtx.schoolId, async (db) => {
      const created: QuestionRow[] = [];
      for (const draft of usable) {
        created.push(
          await db.question.create({
            data: {
              schoolId: authCtx.schoolId,
              subjectId: input.subjectId,
              classLevelId: input.classLevelId,
              createdBy: authCtx.userId,
              source: "AI",
              status: "DRAFT",
              topic: input.topic,
              type: input.type,
              difficulty: input.difficulty,
              text: draft.text,
              marks: draft.marks,
              answerGuide: draft.answerGuide,
              options: { create: optionRows(authCtx.schoolId, input.type, draft.options) },
            },
            include: QUESTION_INCLUDE,
          }),
        );
      }
      await this.audit(db, authCtx, AUDIT.generate, created[0]!.id, meta, {
        prompt: promptRef(EXAM_QUESTIONS_PROMPT),
        subjectId: input.subjectId,
        classLevelId: input.classLevelId,
        type: input.type,
        requested: input.count,
        created: created.length,
        dropped,
        grounding: retrieval.reason,
        questionIds: created.map((q) => q.id),
      });
      return {
        questions: await this.decorate(db, created),
        requested: input.count,
        dropped,
        grounding: { reason: retrieval.reason, usedScheme: parsed.groundedInScheme },
      };
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async loadForWrite(db: Db, scope: Scope, id: string): Promise<QuestionRow> {
    const row = await db.question.findUnique({ where: { id }, include: QUESTION_INCLUDE });
    if (!row) throw new NotFoundError("That question could not be found.");
    if (!this.inScope(scope, row.classLevelId, row.subjectId)) {
      // A 404, not a 403, for a question outside the teacher's subjects: its
      // existence is exam content too.
      throw new NotFoundError("That question could not be found.");
    }
    return row;
  }

  private async assertLevelAndSubject(
    db: Db,
    classLevelId: string,
    subjectId: string,
  ): Promise<{ classLevelName: string; subjectName: string }> {
    const [level, subject] = await Promise.all([
      db.classLevel.findUnique({ where: { id: classLevelId }, select: { name: true } }),
      db.subject.findUnique({ where: { id: subjectId }, select: { name: true } }),
    ]);
    if (!level) throw new NotFoundError("That class level could not be found.");
    if (!subject) throw new NotFoundError("That subject could not be found.");
    return { classLevelName: level.name, subjectName: subject.name };
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
        entityType: "question",
        entityId,
        ipAddress: meta.ipAddress ?? null,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Questions by id, as the bank shows them, in the order given. No scope
   * check: for callers that have already authorised the reference (an exam
   * paper the caller may see). Missing ids are skipped.
   */
  async decorateByIds(db: Db, ids: readonly string[]): Promise<QuestionDto[]> {
    if (ids.length === 0) return [];
    const rows = await db.question.findMany({ where: { id: { in: [...ids] } }, include: QUESTION_INCLUDE });
    const byId = new Map((await this.decorate(db, rows)).map((q) => [q.id, q]));
    return ids.map((id) => byId.get(id)).filter((q): q is QuestionDto => Boolean(q));
  }

  private async decorate(db: Db, rows: QuestionRow[]): Promise<QuestionDto[]> {
    if (rows.length === 0) return [];
    const userIds = [...new Set(rows.flatMap((r) => [r.createdBy, r.approvedBy]).filter((v): v is string => Boolean(v)))];
    const [users, revisions] = await Promise.all([
      db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }),
      db.question.findMany({
        where: { supersedesId: { in: rows.filter((r) => r.status === "APPROVED").map((r) => r.id) }, status: "DRAFT" },
        select: { id: true, supersedesId: true },
      }),
    ]);
    const nameOf = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
    const revisionOf = new Map(revisions.map((r) => [r.supersedesId!, r.id]));
    return rows.map((r) => ({
      id: r.id,
      subjectId: r.subjectId,
      subjectName: r.subject.name,
      classLevelId: r.classLevelId,
      classLevelName: r.classLevel.name,
      topic: r.topic,
      type: r.type,
      difficulty: r.difficulty,
      text: r.text,
      marks: r.marks,
      answerGuide: r.answerGuide,
      status: r.status,
      source: r.source,
      createdBy: r.createdBy,
      createdByName: nameOf.get(r.createdBy) ?? null,
      approvedBy: r.approvedBy,
      approvedByName: r.approvedBy ? (nameOf.get(r.approvedBy) ?? null) : null,
      approvedAt: r.approvedAt,
      retiredAt: r.retiredAt,
      supersedesId: r.supersedesId,
      openRevisionId: revisionOf.get(r.id) ?? null,
      options: r.options.map((o) => ({ id: o.id, orderIndex: o.orderIndex, text: o.text, isCorrect: o.isCorrect })),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }
}

function contentData(input: UpdateQuestionInput) {
  return {
    topic: input.topic,
    type: input.type,
    difficulty: input.difficulty,
    text: input.text,
    marks: input.marks,
    answerGuide: input.answerGuide?.trim() ? input.answerGuide.trim() : null,
  };
}

function optionRows(schoolId: string, type: QuestionType, options: readonly QuestionOptionInput[]) {
  if (type !== "MULTIPLE_CHOICE") return [];
  return options.map((o, i) => ({ schoolId, orderIndex: i, text: o.text.trim(), isCorrect: o.isCorrect }));
}

interface ParsedDraft {
  text: string;
  marks: number;
  answerGuide: string | null;
  options: QuestionOptionInput[];
}

/**
 * Read the model's drafts, keeping only those that pass the same rules a
 * teacher's own question does (findQuestionContentError). Structured outputs
 * fixes the SHAPE; it cannot say "exactly one correct option" or "1 to 100
 * marks" — the schema keywords for those are refused by the API — so those
 * rules are enforced here, and a draft that breaks them is dropped and
 * counted rather than saved for a teacher to trip over.
 *
 * Exported for the spec. Returns null only when the response is not readable
 * at all.
 */
export function parseDrafts(
  raw: string,
  type: QuestionType,
): { valid: ParsedDraft[]; total: number; groundedInScheme: boolean | null } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.questions)) return null;

  const valid: ParsedDraft[] = [];
  for (const item of obj.questions) {
    if (!item || typeof item !== "object") continue;
    const q = item as Record<string, unknown>;
    const text = typeof q.text === "string" ? q.text.trim() : "";
    if (!text || text.length > QUESTION_TEXT_MAX) continue;
    const marks = typeof q.marks === "number" && Number.isInteger(q.marks) ? q.marks : NaN;
    if (!(marks >= 1 && marks <= QUESTION_MARKS_MAX)) continue;
    const guide = typeof q.answerGuide === "string" ? q.answerGuide.trim() : "";
    if (guide.length > QUESTION_ANSWER_GUIDE_MAX) continue;
    // Options only mean something for multiple choice; anything the model put
    // there for another type is ignored rather than failing the draft.
    const options: QuestionOptionInput[] =
      type === "MULTIPLE_CHOICE" && Array.isArray(q.options)
        ? q.options.flatMap((o): QuestionOptionInput[] => {
            if (!o || typeof o !== "object") return [];
            const opt = o as Record<string, unknown>;
            return typeof opt.text === "string" && typeof opt.isCorrect === "boolean"
              ? [{ text: opt.text.trim(), isCorrect: opt.isCorrect }]
              : [];
          })
        : [];
    if (options.length > QUESTION_OPTIONS_MAX || options.some((o) => o.text.length > QUESTION_OPTION_TEXT_MAX)) continue;
    if (findQuestionContentError({ type, answerGuide: guide, options })) continue;
    valid.push({ text, marks, answerGuide: guide || null, options });
  }
  return {
    valid,
    total: obj.questions.length,
    groundedInScheme: typeof obj.groundedInScheme === "boolean" ? obj.groundedInScheme : null,
  };
}
