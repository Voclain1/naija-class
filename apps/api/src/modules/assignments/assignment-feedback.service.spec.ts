import type { ConfigService } from "@nestjs/config";
import type { Queue } from "bullmq";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AiCallRequest, AiCallResult, AnthropicPort } from "@school-kit/ai";
import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, ValidationError, addDaysIso, lagosTodayIso, submitWorkSchema } from "@school-kit/types";

import { AiGenerationService } from "../../common/ai/ai-generation.service";
import { FilesystemStorageDriver } from "../../common/storage/filesystem-storage.driver";
import { StorageService } from "../../common/storage/storage.service";
import { AuthService } from "../auth/auth.service";
import { AssignmentFeedbackService, parseDraft, type AssignmentFeedbackJobData } from "./assignment-feedback.service";
import { AssignmentsService } from "./assignments.service";

// Phase 9 / CP4b — AI-drafted marking feedback (docs/modules/phase-9.md §12),
// against real Postgres, with only the Anthropic side faked: the budget check
// and the ai_generations ledger are the real AiGenerationService.
//
// The rules first: it is OPTIONAL (three switches, then a button); the names
// never reach the model; the queue carries ids only; a draft is never a mark,
// and never reaches the student or the family.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ANSWER =
  "I am Amara Nwosu and Bola Okafor helped me. Photosynthesis is how green plants make food from light, water and carbon dioxide.";

class FakePort implements AnthropicPort {
  calls: AiCallRequest[] = [];
  reply: Record<string, unknown> = { mark: 7, feedback: "You explained the raw materials clearly. Add the products.", reason: "Missed glucose and oxygen." };
  async create(req: AiCallRequest): Promise<AiCallResult> {
    this.calls.push(req);
    return { text: JSON.stringify(this.reply), inputTokens: 300, outputTokens: 80, stopReason: "end_turn" };
  }
}

class FakeQueue {
  added: Array<{ name: string; data: AssignmentFeedbackJobData }> = [];
  async add(name: string, data: AssignmentFeedbackJobData): Promise<unknown> {
    this.added.push({ name, data });
    return {};
  }
}

const ctx = (schoolId: string, userId: string) => ({ sessionId: `s-${runId}`, schoolId, userId });

describe("AssignmentFeedbackService (integration)", () => {
  const storageRoot = "/tmp/claude-0/cp4b-files-" + runId;
  const port = new FakePort();
  const queue = new FakeQueue();
  const ai = new AiGenerationService({ get: () => undefined } as unknown as ConfigService, port);
  const feedback = new AssignmentFeedbackService(ai, queue as unknown as Queue);
  const assignments = new AssignmentsService(new StorageService(new FilesystemStorageDriver(storageRoot)), feedback);

  let S: {
    schoolId: string;
    ownerId: string;
    teacherId: string;
    otherTeacherId: string;
    child: string;
    classmate: string;
    third: string;
    homework: () => Promise<string>;
  };

  beforeAll(async () => {
    const signed = await new AuthService().signupOwner(
      {
        schoolName: `Draft ${runId}`,
        schoolSlug: `draft-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `draft-${runId}@example.test`,
        ownerPhone: `+23496${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    const schoolId = signed.school.id;
    await basePrisma.school.update({
      where: { id: schoolId },
      data: { status: "ACTIVE", onboardingStep: 5, aiEnabled: true, aiMonthlyTokenBudget: 5_000_000 },
    });
    S = await withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({ data: { schoolId, label: `Y-${runId}`, startDate: day("2026-09-01"), endDate: day("2027-07-31") } });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "First Term", startDate: day("2026-09-01"), endDate: day("2026-12-11"), isCurrent: true },
      });
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "JSS1A", code: `d-a-${runId}` }, select: { id: true } });
      const otherArm = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "JSS1B", code: `d-b-${runId}` }, select: { id: true } });
      const subject = await db.subject.findFirstOrThrow({ where: { schoolId }, orderBy: { name: "asc" } });
      const teacherRole = (await db.role.findFirstOrThrow({ where: { key: "teacher" }, select: { id: true } })).id;
      const teacher = async (email: string, armId: string) => {
        const u = await db.user.create({ data: { schoolId, email, firstName: "Tunde", lastName: "Teacher" }, select: { id: true } });
        await db.userRole.create({ data: { userId: u.id, roleId: teacherRole } });
        await db.teacherAssignment.create({ data: { schoolId, teacherId: u.id, classArmId: armId, subjectId: subject.id, academicYearId: year.id, isActive: true } });
        return u.id;
      };
      const child = async (first: string, last: string) => {
        const s = await db.student.create({
          data: { schoolId, admissionNumber: `DR-${first}-${runId}`, firstName: first, lastName: last, dateOfBirth: day("2013-01-01"), gender: "FEMALE" },
          select: { id: true },
        });
        await db.enrollment.create({ data: { schoolId, studentId: s.id, termId: term.id, academicYearId: year.id, classArmId: arm.id, status: "ENROLLED" } });
        return s.id;
      };
      const teacherId = await teacher(`dr-t-${runId}@example.test`, arm.id);
      return {
        schoolId,
        ownerId: signed.user.id,
        teacherId,
        otherTeacherId: await teacher(`dr-t2-${runId}@example.test`, otherArm.id),
        child: await child("Amara", "Nwosu"),
        classmate: await child("Bola", "Okafor"),
        third: await child("Chidi", "Eze"),
        homework: async () =>
          withTenant(schoolId, async (db2) =>
            (
              await db2.assignment.create({
                data: { schoolId, classArmId: arm.id, subjectId: subject.id, createdBy: teacherId, title: "Photosynthesis", instructions: "Explain it.", dueDate: day(addDaysIso(lagosTodayIso(), 3)) },
                select: { id: true },
              })
            ).id,
          ),
      };
    });
  });

  afterAll(async () => {
    await basePrisma.school.delete({ where: { id: S.schoolId } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  beforeEach(() => {
    port.calls.length = 0;
    queue.added.length = 0;
  });

  const owner = () => ctx(S.schoolId, S.ownerId);
  const teacher = () => ctx(S.schoolId, S.teacherId);
  const submit = (studentId: string, id: string, body = ANSWER) =>
    assignments.submitForStudent(S.schoolId, studentId, id, submitWorkSchema.parse({ body, typedChars: body.length }));
  const latestId = async (id: string, studentId: string) =>
    (await assignments.studentWork(teacher(), id, studentId)).attempts[0]!.id;
  const setSwitch = (enabled: boolean) => feedback.updateSettings(owner(), enabled, null);

  it("is optional: off by default, owner or admin turns it on, and marking by hand is the same either way", async () => {
    const id = await S.homework();
    const marking = await assignments.collect(teacher(), id, { totalMarks: 10 }, reqCtx);
    expect(marking.aiDrafting).toBe(false);
    expect(await feedback.getSettings(owner())).toMatchObject({ enabled: false, aiEnabled: true });
    await submit(S.child, id);
    const sub = await latestId(id, S.child);
    await expect(feedback.draftOne(teacher(), sub, null)).rejects.toMatchObject({ code: "AI_DRAFTS_OFF" });
    await expect(feedback.draftAll(teacher(), id, null)).rejects.toMatchObject({ code: "AI_DRAFTS_OFF" });
    // A teacher cannot switch it on.
    await expect(feedback.updateSettings(teacher(), true, null)).rejects.toBeInstanceOf(ForbiddenError);
    expect(queue.added).toHaveLength(0);

    await setSwitch(true);
    expect((await assignments.marking(teacher(), id)).aiDrafting).toBe(true);
    // The platform's switch still wins.
    await basePrisma.school.update({ where: { id: S.schoolId }, data: { aiEnabled: false } });
    expect((await assignments.marking(teacher(), id)).aiDrafting).toBe(false);
    await expect(feedback.draftOne(teacher(), sub, null)).rejects.toMatchObject({ code: "AI_DRAFTS_OFF" });
    await basePrisma.school.update({ where: { id: S.schoolId }, data: { aiEnabled: true } });

    // Marking by hand needs none of it.
    const marked = await assignments.mark(teacher(), sub, { mark: 6, feedback: "Good." }, reqCtx);
    expect(marked.attempts[0]).toMatchObject({ mark: 6, feedbackAiDrafted: false, draft: null });
    await setSwitch(false);
  });

  it("drafts with names removed and ids-only jobs; a draft is never a mark and never reaches the family", async () => {
    await setSwitch(true);
    const id = await S.homework();
    await assignments.collect(teacher(), id, { totalMarks: 10, markingGuide: "Light, water, carbon dioxide; glucose and oxygen." }, reqCtx);
    await submit(S.child, id);
    const sub = await latestId(id, S.child);

    expect(await feedback.draftOne(teacher(), sub, null)).toEqual({ queued: 1 });
    await expect(feedback.draftOne(teacher(), sub, null)).rejects.toBeInstanceOf(ConflictError);
    expect(queue.added).toHaveLength(1);
    // The job carries ids only: the answer is read when it runs.
    expect(Object.keys(queue.added[0]!.data).sort()).toEqual(["schoolId", "submissionId", "userId"]);
    expect(JSON.stringify(queue.added[0]!.data)).not.toMatch(/Photosynthesis|Amara/);
    expect((await assignments.studentWork(teacher(), id, S.child)).attempts[0]!.draft).toMatchObject({ status: "PENDING" });

    await feedback.generate(queue.added[0]!.data);
    expect(port.calls).toHaveLength(1);
    const sent = port.calls[0]!.userContent as string;
    expect(sent).toContain("Photosynthesis is how green plants make food");
    expect(sent).toContain("Light, water, carbon dioxide; glucose and oxygen.");
    expect(sent).not.toMatch(/Amara|Nwosu|Bola|Okafor|DR-Amara/i);
    expect(sent).toContain("I am [name] [name] and [name] [name] helped me.");

    const work = await assignments.studentWork(teacher(), id, S.child);
    expect(work.attempts[0]).toMatchObject({
      mark: null,
      feedback: null,
      draft: { status: "READY", mark: 7, feedback: "You explained the raw materials clearly. Add the products.", reason: "Missed glucose and oxygen." },
    });
    // Logged to the ledger, as every call is.
    const ledger = await withTenant(S.schoolId, (db) => db.aIGeneration.count({ where: { promptName: "assignment-feedback" } }));
    expect(ledger).toBeGreaterThanOrEqual(1);

    // Nothing of the draft reaches the student or the family.
    const mine = await assignments.getForStudent(S.schoolId, S.child, id);
    expect(JSON.stringify(mine)).not.toMatch(/draft|raw materials|Missed glucose/i);
    expect(mine.attempts[0]).toMatchObject({ mark: null, feedback: null });

    // The teacher uses it, edits it, saves: only that writes the mark.
    const saved = await assignments.mark(teacher(), sub, { mark: 8, feedback: "Clear on the raw materials. Name the products too.", fromAiDraft: true }, reqCtx);
    expect(saved.attempts[0]).toMatchObject({ mark: 8, feedbackAiDrafted: true });
    await assignments.release(teacher(), id, reqCtx);
    expect((await assignments.getForStudent(S.schoolId, S.child, id)).attempts[0]).toMatchObject({
      mark: 8,
      feedback: "Clear on the raw materials. Name the products too.",
    });
    expect(JSON.stringify(await assignments.getForStudent(S.schoolId, S.child, id))).not.toMatch(/aiDrafted|AiDrafted/);
    await setSwitch(false);
  });

  it("drafts all unmarked typed answers, scoped to the class's teachers; photos only are refused", async () => {
    await setSwitch(true);
    const id = await S.homework();
    await assignments.collect(teacher(), id, { totalMarks: 10 }, reqCtx);
    await submit(S.child, id);
    await submit(S.classmate, id);
    // A files-only attempt: no text to draft from.
    await withTenant(S.schoolId, async (db) => {
      const c = await db.assignmentCollection.findUniqueOrThrow({ where: { assignmentId: id } });
      await db.assignmentSubmission.create({ data: { schoolId: S.schoolId, collectionId: c.id, studentId: S.third, attempt: 1 } });
    });
    await assignments.mark(teacher(), await latestId(id, S.classmate), { mark: 5 }, reqCtx);

    await expect(feedback.draftAll(ctx(S.schoolId, S.otherTeacherId), id, null)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await feedback.draftAll(teacher(), id, null)).toEqual({ queued: 1 });
    // Again: everything left already has a draft.
    expect(await feedback.draftAll(teacher(), id, null)).toEqual({ queued: 0 });
    await expect(feedback.draftOne(teacher(), await latestId(id, S.third), null)).rejects.toBeInstanceOf(ValidationError);

    // Discard drops it; the roster shows no draft.
    await feedback.discard(teacher(), await latestId(id, S.child), null);
    const roster = (await assignments.marking(teacher(), id)).roster.find((r) => r.studentId === S.child)!;
    expect(roster.draftStatus).toBeNull();
    await setSwitch(false);
  });

  it("fails readably: a bad answer from the model, a used-up budget, or a switch turned off before the job ran", async () => {
    await setSwitch(true);
    const id = await S.homework();
    await assignments.collect(teacher(), id, { totalMarks: 10 }, reqCtx);
    await submit(S.child, id);
    const sub = await latestId(id, S.child);

    port.reply = { mark: 14, feedback: "Too generous.", reason: "" };
    await feedback.draftOne(teacher(), sub, null);
    await feedback.generate(queue.added.at(-1)!.data);
    expect((await assignments.studentWork(teacher(), id, S.child)).attempts[0]!.draft).toMatchObject({
      status: "FAILED",
      failure: "The draft could not be made. Try again, or mark by hand.",
    });

    port.reply = { mark: 7, feedback: "Fine.", reason: "ok" };
    await basePrisma.school.update({ where: { id: S.schoolId }, data: { aiMonthlyTokenBudget: 10 } });
    await feedback.draftOne(teacher(), sub, null);
    await feedback.generate(queue.added.at(-1)!.data);
    expect((await assignments.studentWork(teacher(), id, S.child)).attempts[0]!.draft?.failure).toMatch(/allowance for this month is used up/);
    await basePrisma.school.update({ where: { id: S.schoolId }, data: { aiMonthlyTokenBudget: 5_000_000 } });

    await feedback.draftOne(teacher(), sub, null);
    await setSwitch(false);
    const calls = port.calls.length;
    await feedback.generate(queue.added.at(-1)!.data);
    expect(port.calls.length).toBe(calls);
    expect((await assignments.studentWork(teacher(), id, S.child)).attempts[0]!.draft).toMatchObject({
      status: "FAILED",
      failure: "AI drafts are switched off for this school.",
    });
  });

  it("only a whole mark within the total is a usable draft", () => {
    expect(parseDraft(JSON.stringify({ mark: 4, feedback: "Good.", reason: "r" }), 10)).toEqual({ mark: 4, feedback: "Good.", reason: "r" });
    expect(parseDraft(JSON.stringify({ mark: 11, feedback: "x", reason: "" }), 10)).toBeNull();
    expect(parseDraft(JSON.stringify({ mark: 4.5, feedback: "x", reason: "" }), 10)).toBeNull();
    expect(parseDraft(JSON.stringify({ mark: 4, feedback: "  ", reason: "" }), 10)).toBeNull();
    expect(parseDraft("not json", 10)).toBeNull();
  });

  it("audits the switch and every request with counts only", async () => {
    const rows = await withTenant(S.schoolId, (db) =>
      db.auditLog.findMany({ where: { action: { startsWith: "assignment.ai-draft" } } }),
    );
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ["assignment.ai-drafts.enabled", "assignment.ai-drafts.disabled", "assignment.ai-draft.request", "assignment.ai-draft.discard"]) {
      expect(actions.has(a), a).toBe(true);
    }
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toMatch(/Photosynthesis|raw materials|Amara/);
  });
});
