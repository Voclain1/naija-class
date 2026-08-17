import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { LESSON_PLAN_SCHEMA, type AiCallRequest, type AiCallResult, type AnthropicPort } from "@school-kit/ai";
import { basePrisma, withTenant } from "@school-kit/db";

import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import { LessonPlansService } from "./lesson-plans.service.js";

// Integration suite against the real Postgres, with the Anthropic side faked.
// The point is the wiring between the feature and the AI infrastructure: that
// the budget is consulted, that the ledger row is written, and — the part that
// is easy to get wrong — that a failed generation leaves a usable DRAFT rather
// than a 500 with nothing to show for it.

// Standard Nigerian lesson note sections (prompt v2). Must stay in step with
// LESSON_PLAN_SECTION_ORDER — the service validates every key in that list is
// present and non-empty, so a fixture still shaped like v1 makes every
// generation here fail as "incomplete".
const GOOD_SECTIONS = {
  behaviouralObjectives:
    "By the end of the lesson, pupils should be able to: 1. Define photosynthesis. 2. Name the raw materials. ".repeat(
      2,
    ),
  instructionalMaterials: "A real green leaf; chalkboard and chalk; a hand-drawn wall chart. ".repeat(2),
  previousKnowledge: "Pupils have already learnt the parts of a flowering plant and their functions. ".repeat(2),
  referenceMaterials: "NERDC Basic Science Curriculum for Junior Secondary Schools; WAEC/NECO syllabus. ".repeat(2),
  mainContent: "Step 1: Teacher holds up the leaf and asks how the plant feeds. Step 2: Pupils copy the definition. ".repeat(
    2,
  ),
  assessment: "1. What is photosynthesis? 2. Name the three raw materials needed for photosynthesis. ".repeat(2),
  homework: "Write the word equation and draw a labelled diagram. ".repeat(2),
  conclusion: "Teacher summarises the word equation on the board for pupils to copy into their notes. ".repeat(2),
};

class FakePort implements AnthropicPort {
  calls: AiCallRequest[] = [];
  behaviour: "ok" | "throw" | "badJson" | "missingSection" = "ok";

  async create(req: AiCallRequest): Promise<AiCallResult> {
    this.calls.push(req);
    if (this.behaviour === "throw") throw new Error("simulated upstream failure");

    let text: string;
    if (this.behaviour === "badJson") text = "Here is your lesson plan!";
    else if (this.behaviour === "missingSection") {
      const { homework: _omitted, ...rest } = GOOD_SECTIONS;
      text = JSON.stringify(rest);
    } else if (req.jsonSchema) text = JSON.stringify(GOOD_SECTIONS);
    else text = "1. Which gas do plants absorb?\nA. Oxygen  B. Carbon dioxide\n\nMark scheme: 1-B";

    return { text, inputTokens: 200, outputTokens: 400, stopReason: "end_turn" };
  }
}

const configStub = () => ({ get: () => undefined }) as unknown as ConfigService;

const runId = Math.random().toString(36).slice(2, 8);
let schoolId: string;
let userId: string;
let classLevelId: string;
let subjectId: string;

describe("LessonPlansService", () => {
  let port: FakePort;
  let service: LessonPlansService;

  beforeEach(async () => {
    port = new FakePort();
    service = new LessonPlansService(new AiGenerationService(configStub(), port));

    if (schoolId) return;
    const school = await basePrisma.school.create({
      data: {
        name: `LP ${runId}`,
        slug: `lp-${runId}`,
        aiMonthlyTokenBudget: 5_000_000,
        // aiEnabled explicitly (2026-08-14): School.aiEnabled now defaults
        // FALSE, and every generation in this suite goes through
        // AiGenerationService.reserve(), which throws DISABLED_SCHOOL when it
        // is off. AI being ON is a precondition of what these tests exercise,
        // not an incidental default — same reasoning as the explicit
        // aiMonthlyTokenBudget beside it.
        aiEnabled: true,
      },
      select: { id: true },
    });
    schoolId = school.id;

    await withTenant(schoolId, async (db) => {
      const user = await db.user.create({
        data: { schoolId, email: `lp-${runId}@t.test`, firstName: "Lesson", lastName: "Teacher" },
        select: { id: true },
      });
      userId = user.id;
      const level = await db.classLevel.create({
        data: { schoolId, name: "JSS 2", code: `JSS2-${runId}`, stage: "JSS", orderIndex: 2 },
        select: { id: true },
      });
      classLevelId = level.id;
      const subject = await db.subject.create({
        data: { schoolId, name: "Basic Science", code: `BSC-${runId}` },
        select: { id: true },
      });
      subjectId = subject.id;
    });
  });

  afterAll(async () => {
    if (!schoolId) return;
    await withTenant(schoolId, async (db) => {
      await db.lessonPlan.deleteMany({ where: { schoolId } });
      await db.aIGeneration.deleteMany({ where: { schoolId } });
      await db.aIBudgetPeriod.deleteMany({ where: { schoolId } });
    });
    await basePrisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
  });

  const input = () => ({ classLevelId, subjectId, topic: `Photosynthesis ${runId}`, objectives: null, durationMinutes: 40 });

  it("generates every Nigerian lesson-note section and persists them", async () => {
    const plan = await service.createAndGenerate(schoolId, userId, input());

    expect(plan.behaviouralObjectives).toBeTruthy();
    expect(plan.instructionalMaterials).toBeTruthy();
    expect(plan.previousKnowledge).toBeTruthy();
    expect(plan.referenceMaterials).toBeTruthy();
    expect(plan.mainContent).toBeTruthy();
    expect(plan.assessment).toBeTruthy();
    expect(plan.homework).toBeTruthy();
    expect(plan.conclusion).toBeTruthy();
    // v1's generic sections are no longer generated — a v2 note must not
    // silently populate them, or the "old format" UI blocks would appear on
    // every freshly generated note.
    expect(plan.introduction).toBeNull();
    expect(plan.activities).toBeNull();
    expect(plan.status).toBe("DRAFT");
    expect(plan.classLevelName).toBe("JSS 2");
  });

  it("requests structured output so the five DB columns cannot be partially filled", async () => {
    await service.createAndGenerate(schoolId, userId, input());
    expect(port.calls[0].jsonSchema).toEqual(LESSON_PLAN_SCHEMA);
  });

  it("sends the class level and subject to the model, and no student data", async () => {
    await service.createAndGenerate(schoolId, userId, input());
    const sent = port.calls[0].userContent;
    expect(sent).toContain("JSS 2");
    expect(sent).toContain("Basic Science");
    // The rendered prompt is built only from level/subject/topic — there is no
    // code path that could put a student on it. Asserted here as well as in
    // the eval harness because this is the wired-up call, not the renderer.
    expect(sent).not.toMatch(/admission|date of birth|guardian/i);
  });

  it("writes exactly one ai_generations ledger row per call", async () => {
    // Delta, not absolute count: the suite shares one school so ledger rows
    // accumulate across tests. An absolute assertion here passed in isolation
    // and failed in suite order, which is worse than no assertion.
    const before = await withTenant(schoolId, (db) =>
      db.aIGeneration.count({ where: { schoolId, promptName: "lesson-plan" } }),
    );

    await service.createAndGenerate(schoolId, userId, input());

    const rows = await withTenant(schoolId, (db) =>
      db.aIGeneration.findMany({
        where: { schoolId, promptName: "lesson-plan" },
        orderBy: { createdAt: "desc" },
      }),
    );
    expect(rows.length - before).toBe(1);
    // v2 — the Nigerian lesson note format. Pinned deliberately: the ledger's
    // promptVersion is what lets a later quality review tell v1 output from v2
    // output, so a silent version drift here would make that review meaningless.
    expect(rows[0]).toMatchObject({ success: true, promptVersion: "2", userId });
    expect(rows[0].inputTokens).toBe(200);
    expect(rows[0].outputTokens).toBe(400);
  });

  it("leaves an inspectable DRAFT when generation fails, rather than losing the teacher's input", async () => {
    port.behaviour = "throw";
    await expect(service.createAndGenerate(schoolId, userId, input())).rejects.toThrow();

    const rows = await withTenant(schoolId, (db) =>
      db.lessonPlan.findMany({ where: { schoolId, topic: input().topic } }),
    );
    // The row survives with the teacher's inputs intact so they can retry
    // without retyping.
    const failed = rows.find((r) => r.behaviouralObjectives === null);
    expect(failed).toBeDefined();
    expect(failed?.topic).toBe(input().topic);
    expect(failed?.durationMinutes).toBe(40);
  });

  it("rejects a non-JSON response instead of writing empty sections", async () => {
    port.behaviour = "badJson";
    await expect(service.createAndGenerate(schoolId, userId, input())).rejects.toThrow(
      /could not be read/i,
    );
  });

  it("rejects a response missing a section instead of writing a null column", async () => {
    port.behaviour = "missingSection";
    await expect(service.createAndGenerate(schoolId, userId, input())).rejects.toThrow(/incomplete/i);
  });

  it("refuses quiz generation before the lesson plan has content", async () => {
    const created = await withTenant(schoolId, (db) =>
      db.lessonPlan.create({
        data: { schoolId, createdBy: userId, classLevelId, subjectId, topic: `Empty ${runId}` },
        select: { id: true },
      }),
    );
    await expect(service.generateQuiz(schoolId, userId, created.id)).rejects.toThrow(/before generating a quiz/i);
    expect(port.calls).toHaveLength(0);
  });

  it("generates a quiz from an existing plan and logs it as a separate prompt", async () => {
    const plan = await service.createAndGenerate(schoolId, userId, input());
    const withQuiz = await service.generateQuiz(schoolId, userId, plan.id);

    expect(withQuiz.quiz).toBeTruthy();
    const ledger = await withTenant(schoolId, (db) =>
      db.aIGeneration.findMany({ where: { schoolId, promptName: "lesson-quiz" } }),
    );
    // Separate ledger rows for the two prompts: one lesson session spans
    // multiple underlying calls, and the ledger has to tell them apart.
    expect(ledger.length).toBeGreaterThanOrEqual(1);
  });

  it("404s on another school's lesson plan id", async () => {
    const other = await basePrisma.school.create({
      data: { name: `LP other ${runId}`, slug: `lp-other-${runId}` },
      select: { id: true },
    });
    try {
      const plan = await service.createAndGenerate(schoolId, userId, input());
      await expect(service.get(other.id, plan.id)).rejects.toThrow(/not found/i);
    } finally {
      await basePrisma.school.delete({ where: { id: other.id } }).catch(() => undefined);
    }
  });
});
