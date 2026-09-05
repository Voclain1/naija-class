import { Injectable, Logger } from "@nestjs/common";

import {
  LESSON_PLAN_PROMPT,
  LESSON_PLAN_SCHEMA,
  LESSON_PLAN_SECTION_ORDER,
  LESSON_PLAN_SYSTEM,
  LESSON_QUIZ_PROMPT,
  LESSON_QUIZ_SYSTEM,
  renderLessonPlanPrompt,
  renderLessonQuizPrompt,
} from "@school-kit/ai";
import { withTenant } from "@school-kit/db";
import {
  InternalError,
  NotFoundError,
  ValidationError,
  type CreateLessonPlanInput,
  type LessonPlanDto,
  type LessonPlanSummaryDto,
  type LessonPlanGroundingChunkDto,
  type LessonPlanGroundingDto,
  type LessonPlanGroundingReasonDto,
  type ListLessonPlansInput,
  type UpdateLessonPlanInput,
} from "@school-kit/types";

import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import { CurriculumRetrievalService } from "../curriculum/curriculum-retrieval.service.js";

// ---------------------------------------------------------------------------
// Lesson plan generator — Phase 5 / Slice 2, the first AI FEATURE.
//
// Every Claude call goes through AiGenerationService, which enforces the
// per-school token budget BEFORE the call and writes the mandatory
// ai_generations ledger row after it. This service never touches the Anthropic
// SDK (and could not: an ESLint rule makes that a CI failure).
//
// NO TEACHER-APPROVAL GATE, deliberately. CLAUDE.md's AI hard rule requires one
// for grades, report-card comments and behaviour records — student-facing
// records where an unreviewed AI output would become part of a child's file. A
// lesson plan is the teacher's own working document: they read it, edit it, and
// teach from it. `status` (DRAFT/ACCEPTED) is a "done editing" marker, not an
// approval boundary, and nothing downstream consumes an ACCEPTED plan
// automatically.
// ---------------------------------------------------------------------------

// Standard Nigerian lesson note sections (prompt v2). `mainContent`,
// `assessment` and `homework` carry Presentation, Evaluation and Assignment
// under their original column names — see the schema note in
// packages/ai/src/prompts/lesson-plan.ts.
interface GeneratedSections {
  behaviouralObjectives: string;
  instructionalMaterials: string;
  previousKnowledge: string;
  referenceMaterials: string;
  mainContent: string;
  assessment: string;
  homework: string;
  conclusion: string;
}

// Derived from the output schema's `required` array rather than re-listed, so
// adding a section to the prompt cannot leave this validation silently behind
// — the failure mode that would let an incomplete note reach a teacher.
const SECTION_KEYS = LESSON_PLAN_SECTION_ORDER as ReadonlyArray<keyof GeneratedSections>;

@Injectable()
export class LessonPlansService {
  private readonly logger = new Logger(LessonPlansService.name);

  constructor(
    private readonly ai: AiGenerationService,
    private readonly curriculum: CurriculumRetrievalService,
  ) {}

  // -------------------------------------------------------------------------
  // Create + generate.
  //
  // The row is written BEFORE the generation and updated after. That ordering
  // is deliberate: a generation that fails leaves an inspectable DRAFT with the
  // teacher's inputs intact, so they can retry without retyping — rather than
  // a 500 and nothing to show for it. It also means the ai_generations ledger
  // row and the lesson_plans row can be correlated after the fact.
  // -------------------------------------------------------------------------
  async createAndGenerate(
    schoolId: string,
    userId: string,
    input: CreateLessonPlanInput,
  ): Promise<LessonPlanDto> {
    const context = await withTenant(schoolId, async (db) => {
      const [classLevel, subject] = await Promise.all([
        db.classLevel.findUnique({
          where: { id: input.classLevelId },
          select: { id: true, name: true },
        }),
        db.subject.findUnique({
          where: { id: input.subjectId },
          select: { id: true, name: true },
        }),
      ]);
      // RLS already scopes these reads to the caller's school, so a miss means
      // "not in your school" and "does not exist" collapse into the same 404 —
      // which is the correct behaviour, not a leak.
      if (!classLevel) throw new NotFoundError("Class level not found.");
      if (!subject) throw new NotFoundError("Subject not found.");

      const created = await db.lessonPlan.create({
        data: {
          schoolId,
          createdBy: userId,
          classLevelId: input.classLevelId,
          subjectId: input.subjectId,
          topic: input.topic,
          objectives: input.objectives ?? null,
          durationMinutes: input.durationMinutes ?? null,
        },
        select: { id: true },
      });

      return { classLevel, subject, lessonPlanId: created.id };
    });

    // ---- curriculum retrieval (Phase 7 / CP3) ---------------------------
    //
    // Before the generation, outside the transaction. The topic is what the
    // teacher is planning, and their objectives sharpen it where given — both
    // are short, so this is one ~40-token query embedding (D5: not reserved).
    //
    // `retrieve` never throws: every failure path — no documents, nothing
    // relevant, vendor down, key absent — returns an empty result with a
    // reason, and the generation proceeds ungrounded (D18). A teacher must not
    // lose their lesson plan because a second vendor had a bad minute.
    const retrieval = await this.curriculum.retrieve({
      schoolId,
      subjectId: input.subjectId,
      classLevelId: input.classLevelId,
      query: [input.topic, input.objectives ?? ""].join(" ").trim(),
    });

    // Outside the transaction — this is the reserve → call → settle boundary.
    const result = await this.ai.generate({
      schoolId,
      userId,
      prompt: LESSON_PLAN_PROMPT,
      system: LESSON_PLAN_SYSTEM,
      userContent: renderLessonPlanPrompt({
        classLevel: context.classLevel.name,
        subject: context.subject.name,
        topic: input.topic,
        objectives: input.objectives,
        durationMinutes: input.durationMinutes,
        groundingChunks: retrieval.chunks.map((c) => ({
          heading: c.heading,
          content: c.content,
          documentTitle: c.documentTitle,
        })),
        // v4 — WHY there is no extract, when there is none. v3 told the model
        // "no scheme of work has been uploaded" on every empty path, which is
        // false whenever a school HAS uploaded one and nothing cleared the
        // floor. The prompt is the model's only description of the world
        // outside its own knowledge; a false statement there is not cosmetic.
        groundingAbsenceReason:
          retrieval.reason === "no-documents" || retrieval.reason === "awaiting-review"
            ? "no-documents"
            : retrieval.reason === "no-match"
              ? "no-match"
              : "unavailable",
      }),
      jsonSchema: LESSON_PLAN_SCHEMA,
    });

    const sections = this.parseSections(result.text, context.lessonPlanId);

    await withTenant(schoolId, (db) =>
      db.lessonPlan.update({
        where: { id: context.lessonPlanId },
        data: {
          ...sections,
          // Recorded even when nothing was used: "no matching section found"
          // is what tells a teacher whether to upload something, and the
          // nearest distance is what lets CP4 tune the floor from data rather
          // than another guess (D20).
          groundedOn: {
            reason: retrieval.reason,
            nearestDistance: retrieval.nearestDistance,
            chunks: retrieval.chunks.map((c) => ({
              chunkId: c.chunkId,
              documentId: c.documentId,
              documentTitle: c.documentTitle,
              heading: c.heading,
              distance: c.distance,
            })),
          },
        },
      }),
    );

    return this.get(schoolId, context.lessonPlanId);
  }

  // Structured outputs constrains the response to LESSON_PLAN_SCHEMA, so this
  // should always succeed. It is still checked rather than cast: a schema
  // change, a refusal that slipped through, or a truncated response would
  // otherwise write `undefined` into five columns and look like a successful
  // generation to the teacher.
  private parseSections(raw: string, lessonPlanId: string): GeneratedSections {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.error(`Lesson plan ${lessonPlanId}: model output was not valid JSON`);
      throw new InternalError("The generated lesson plan could not be read. Please try again.");
    }

    const obj = parsed as Record<string, unknown>;
    const missing = SECTION_KEYS.filter((k) => typeof obj[k] !== "string" || !(obj[k] as string).trim());
    if (missing.length) {
      this.logger.error(`Lesson plan ${lessonPlanId}: missing sections ${missing.join(", ")}`);
      throw new InternalError("The generated lesson plan was incomplete. Please try again.");
    }

    return {
      behaviouralObjectives: obj.behaviouralObjectives as string,
      instructionalMaterials: obj.instructionalMaterials as string,
      previousKnowledge: obj.previousKnowledge as string,
      referenceMaterials: obj.referenceMaterials as string,
      mainContent: obj.mainContent as string,
      assessment: obj.assessment as string,
      homework: obj.homework as string,
      conclusion: obj.conclusion as string,
    };
  }

  // -------------------------------------------------------------------------
  // Quiz mode — a SECOND generation against an existing plan.
  // -------------------------------------------------------------------------
  async generateQuiz(schoolId: string, userId: string, lessonPlanId: string): Promise<LessonPlanDto> {
    const plan = await withTenant(schoolId, (db) =>
      db.lessonPlan.findUnique({
        where: { id: lessonPlanId },
        include: { classLevel: { select: { name: true } }, subject: { select: { name: true } } },
      }),
    );
    if (!plan) throw new NotFoundError("Lesson plan not found.");

    // Feeds the quiz generator the teaching content only. Reads BOTH shapes:
    // v2 sections first, then the two legacy columns, so a quiz can still be
    // generated against a lesson note written before the 2026-08-17
    // restructure. Objectives, materials, references and conclusion are
    // deliberately excluded — the quiz must test what was taught, and a
    // reference list in the prompt invites questions about the textbook.
    const lessonContent = [
      plan.behaviouralObjectives,
      plan.previousKnowledge,
      plan.mainContent,
      plan.introduction,
      plan.activities,
    ]
      .filter(Boolean)
      .join("\n\n");
    if (!lessonContent.trim()) {
      throw new ValidationError("Generate the lesson plan before generating a quiz for it.");
    }

    const result = await this.ai.generate({
      schoolId,
      userId,
      prompt: LESSON_QUIZ_PROMPT,
      system: LESSON_QUIZ_SYSTEM,
      userContent: renderLessonQuizPrompt({
        classLevel: plan.classLevel.name,
        subject: plan.subject.name,
        topic: plan.topic,
        lessonContent,
      }),
    });

    await withTenant(schoolId, (db) =>
      db.lessonPlan.update({ where: { id: lessonPlanId }, data: { quiz: result.text } }),
    );

    return this.get(schoolId, lessonPlanId);
  }

  // -------------------------------------------------------------------------
  // Plain CRUD — no AI involved.
  // -------------------------------------------------------------------------
  async list(schoolId: string, userId: string, filters: ListLessonPlansInput): Promise<LessonPlanSummaryDto[]> {
    const rows = await withTenant(schoolId, (db) =>
      db.lessonPlan.findMany({
        where: {
          schoolId,
          ...(filters.mine === false ? {} : { createdBy: userId }),
          ...(filters.classLevelId ? { classLevelId: filters.classLevelId } : {}),
          ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
        },
        include: { classLevel: { select: { name: true } }, subject: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      }),
    );

    return rows.map((r) => ({
      id: r.id,
      classLevelId: r.classLevelId,
      classLevelName: r.classLevel.name,
      subjectId: r.subjectId,
      subjectName: r.subject.name,
      topic: r.topic,
      objectives: r.objectives,
      durationMinutes: r.durationMinutes,
      status: r.status,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      // Checks both shapes: v2 writes behaviouralObjectives first, pre-v2 rows
      // only ever had introduction. Keying this on one shape would make every
      // lesson note of the other era render as "not yet generated".
      hasContent: Boolean(r.behaviouralObjectives ?? r.introduction),
      hasQuiz: Boolean(r.quiz),
    }));
  }

  async get(schoolId: string, id: string): Promise<LessonPlanDto> {
    const row = await withTenant(schoolId, (db) =>
      db.lessonPlan.findUnique({
        where: { id },
        include: { classLevel: { select: { name: true } }, subject: { select: { name: true } } },
      }),
    );
    if (!row) throw new NotFoundError("Lesson plan not found.");

    return {
      id: row.id,
      classLevelId: row.classLevelId,
      classLevelName: row.classLevel.name,
      subjectId: row.subjectId,
      subjectName: row.subject.name,
      topic: row.topic,
      objectives: row.objectives,
      durationMinutes: row.durationMinutes,
      status: row.status,
      behaviouralObjectives: row.behaviouralObjectives,
      instructionalMaterials: row.instructionalMaterials,
      previousKnowledge: row.previousKnowledge,
      referenceMaterials: row.referenceMaterials,
      conclusion: row.conclusion,
      introduction: row.introduction,
      mainContent: row.mainContent,
      activities: row.activities,
      assessment: row.assessment,
      homework: row.homework,
      quiz: row.quiz,
      groundedOn: parseGroundedOn(row.groundedOn),
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async update(schoolId: string, id: string, input: UpdateLessonPlanInput): Promise<LessonPlanDto> {
    await this.get(schoolId, id); // 404s if it isn't this school's
    await withTenant(schoolId, (db) => db.lessonPlan.update({ where: { id }, data: input }));
    return this.get(schoolId, id);
  }

  async remove(schoolId: string, id: string): Promise<void> {
    await this.get(schoolId, id);
    await withTenant(schoolId, (db) => db.lessonPlan.delete({ where: { id } }));
  }
}

/**
 * Read `groundedOn` back out of its JSON column.
 *
 * VALIDATED, not cast. The column is `Json?`, so anything could be in it — a
 * plan generated before CP3 (null), a shape from an older version, a partial
 * write. A blind cast would make the grounding line render `undefined` and read
 * as a RETRIEVAL bug rather than a storage one, and this display exists
 * precisely to be the honest signal about retrieval. A row it cannot
 * understand is reported as absent, which is true.
 */
function parseGroundedOn(raw: unknown): LessonPlanGroundingDto | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;

  const reason = value.reason;
  if (typeof reason !== "string") return null;
  if (!GROUNDING_REASONS.includes(reason as LessonPlanGroundingReasonDto)) return null;

  const chunks = Array.isArray(value.chunks) ? value.chunks : [];
  return {
    reason: reason as LessonPlanGroundingReasonDto,
    nearestDistance: typeof value.nearestDistance === "number" ? value.nearestDistance : null,
    chunks: chunks.flatMap((c): LessonPlanGroundingChunkDto[] => {
      if (c === null || typeof c !== "object") return [];
      const chunk = c as Record<string, unknown>;
      if (typeof chunk.chunkId !== "string" || typeof chunk.documentId !== "string") return [];
      return [
        {
          chunkId: chunk.chunkId,
          documentId: chunk.documentId,
          documentTitle: typeof chunk.documentTitle === "string" ? chunk.documentTitle : "",
          heading: typeof chunk.heading === "string" ? chunk.heading : null,
          distance: typeof chunk.distance === "number" ? chunk.distance : 0,
        },
      ];
    }),
  };
}

const GROUNDING_REASONS: readonly LessonPlanGroundingReasonDto[] = [
  "ok",
  "no-documents",
  "awaiting-review",
  "no-match",
  "not-configured",
  "error",
];
