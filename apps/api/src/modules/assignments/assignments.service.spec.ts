import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  addDaysIso,
  describeSubmissionFile,
  isAnswerRight,
  lagosTodayIso,
  normaliseFillIn,
  setAssignmentQuestionsSchema,
  submitWorkSchema,
} from "@school-kit/types";

import { FilesystemStorageDriver } from "../../common/storage/filesystem-storage.driver";
import { StorageService } from "../../common/storage/storage.service";
import { AuthService } from "../auth/auth.service";
import { AssignmentsService, clampCounts, isLate, statusOf } from "./assignments.service";

// Phase 9 / CP4.1 — assignments: submitted work and marking
// (docs/modules/phase-9.md §11), against real Postgres. The tests are about
// who sees what (CP4-D2), attempts being final until returned (CP4-D3), the
// paste counts reaching staff only (CP4-D4), and release gating the family's
// view of a mark (CP4-D7).

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ANSWER = "Photosynthesis turns light, water and carbon dioxide into sugar and oxygen.";
const FEEDBACK = "Good. Say where it happens in the leaf.";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);

function ctx(schoolId: string, userId: string) {
  return { sessionId: `sess-${runId}`, schoolId, userId };
}

async function makeSchool(label: string) {
  const signed = await new AuthService().signupOwner(
    {
      schoolName: `Assign ${label} ${runId}`,
      schoolSlug: `assign-${label}-${runId}`,
      ownerFirstName: "Owen",
      ownerLastName: "Owner",
      ownerEmail: `assign-${label}-${runId}@example.test`,
      ownerPhone: `+23495${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
      password: "Correct-Horse-9",
      ndprConsent: true,
    },
    { ipAddress: "127.0.0.1", userAgent: "vitest" },
  );
  await basePrisma.school.update({ where: { id: signed.school.id }, data: { status: "ACTIVE", onboardingStep: 5 } });
  return { schoolId: signed.school.id, ownerId: signed.user.id };
}

describe("AssignmentsService (integration)", () => {
  const storageRoot = mkdtempSync(join(tmpdir(), "assignment-files-"));
  const service = new AssignmentsService(new StorageService(new FilesystemStorageDriver(storageRoot)));
  const schoolIds = new Set<string>();

  let A: {
    schoolId: string;
    ownerId: string;
    adminId: string;
    teacherId: string;
    otherTeacherId: string;
    bursarId: string;
    armId: string;
    levelId: string;
    subjectId: string;
    child: string;
    classmate: string;
    otherChild: string;
    guardianId: string;
    unlinkedGuardianId: string;
    homework: (dueDate: string, title?: string) => Promise<string>;
  };
  let B: { schoolId: string; guardianId: string };

  beforeAll(async () => {
    const a = await makeSchool("a");
    schoolIds.add(a.schoolId);
    const schoolId = a.schoolId;
    A = await withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId, label: `Y-${runId}`, startDate: day("2026-09-01"), endDate: day("2027-07-31") },
      });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "First Term", startDate: day("2026-09-01"), endDate: day("2026-12-11"), isCurrent: true },
      });
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "JSS1A", code: `as-a-${runId}` }, select: { id: true } });
      const otherArm = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "JSS1B", code: `as-b-${runId}` }, select: { id: true } });
      const subject = await db.subject.findFirstOrThrow({ where: { schoolId }, orderBy: { name: "asc" } });
      const role = async (key: string) => (await db.role.findFirstOrThrow({ where: { key }, select: { id: true } })).id;
      const staff = async (email: string, firstName: string, roleKey: string, armId: string | null) => {
        const user = await db.user.create({ data: { schoolId, email, firstName, lastName: "Staff" }, select: { id: true } });
        await db.userRole.create({ data: { userId: user.id, roleId: await role(roleKey) } });
        if (armId) {
          await db.teacherAssignment.create({
            data: { schoolId, teacherId: user.id, classArmId: armId, subjectId: subject.id, academicYearId: year.id, isActive: true },
          });
        }
        return user.id;
      };
      const child = async (name: string, armId: string) => {
        const s = await db.student.create({
          data: { schoolId, admissionNumber: `AS-${name}-${runId}`, firstName: name, lastName: "Pupil", dateOfBirth: day("2013-01-01"), gender: "FEMALE" },
          select: { id: true },
        });
        await db.enrollment.create({ data: { schoolId, studentId: s.id, termId: term.id, academicYearId: year.id, classArmId: armId, status: "ENROLLED" } });
        return s.id;
      };
      const guardian = async (firstName: string) =>
        (await db.guardian.create({ data: { schoolId, firstName, lastName: "Parent", relationship: "MOTHER", phone: "08031112222" }, select: { id: true } })).id;

      const teacherId = await staff(`as-t-${runId}@example.test`, "Tunde", "teacher", arm.id);
      const kid = await child("Amara", arm.id);
      const guardianId = await guardian("Linked");
      await db.studentGuardian.create({ data: { schoolId, studentId: kid, guardianId, isPrimary: true } });
      return {
        schoolId,
        ownerId: a.ownerId,
        adminId: await staff(`as-ad-${runId}@example.test`, "Amaka", "admin", null),
        teacherId,
        otherTeacherId: await staff(`as-t2-${runId}@example.test`, "Ngozi", "teacher", otherArm.id),
        bursarId: await staff(`as-b-${runId}@example.test`, "Bisi", "bursar", null),
        armId: arm.id,
        levelId: level.id,
        subjectId: subject.id,
        child: kid,
        classmate: await child("Bola", arm.id),
        otherChild: await child("Chidi", otherArm.id),
        guardianId,
        unlinkedGuardianId: await guardian("Unlinked"),
        homework: async (dueDate: string, title = "Photosynthesis") =>
          withTenant(schoolId, async (db2) =>
            (
              await db2.assignment.create({
                data: { schoolId, classArmId: arm.id, subjectId: subject.id, createdBy: teacherId, title, instructions: "Explain it.", dueDate: day(dueDate) },
                select: { id: true },
              })
            ).id,
          ),
      };
    });

    const b = await makeSchool("b");
    schoolIds.add(b.schoolId);
    B = {
      schoolId: b.schoolId,
      guardianId: await withTenant(b.schoolId, async (db) =>
        (await db.guardian.create({ data: { schoolId: b.schoolId, firstName: "Far", lastName: "Away", relationship: "FATHER", phone: "08039999999" }, select: { id: true } })).id,
      ),
    };
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
    rmSync(storageRoot, { recursive: true, force: true });
  });

  const today = () => lagosTodayIso();
  const guardianCtx = (schoolId: string, guardianId: string) => ({ sessionId: `g-${runId}`, schoolId, guardianId });
  const submit = (studentId: string, id: string, body = ANSWER, typed = body.length, pasted = 0) =>
    service.submitForStudent(A.schoolId, studentId, id, submitWorkSchema.parse({ body, typedChars: typed, pastedChars: pasted }));

  describe("collecting work", () => {
    it("the class's teacher switches it on; a teacher of another class and a bursar cannot", async () => {
      const id = await A.homework(addDaysIso(today(), 3));
      const marking = await service.collect(ctx(A.schoolId, A.teacherId), id, { totalMarks: 10 }, reqCtx);
      expect(marking.collection).toEqual({ assignmentId: id, totalMarks: 10, accepting: true });
      expect(marking.roster.map((r) => r.name).sort()).toEqual(["Amara Pupil", "Bola Pupil"]);
      expect(marking.counts.notSubmitted).toBe(2);
      await expect(service.collect(ctx(A.schoolId, A.otherTeacherId), id, { totalMarks: 10 }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(service.marking(ctx(A.schoolId, A.otherTeacherId), id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(service.marking(ctx(A.schoolId, A.bursarId), id)).rejects.toBeInstanceOf(ForbiddenError);
      // Owner and admin may look at any class's.
      expect((await service.marking(ctx(A.schoolId, A.adminId), id)).roster).toHaveLength(2);
    });

    it("a homework item not collecting work is not found for the student", async () => {
      const id = await A.homework(addDaysIso(today(), 3), "Read chapter 2");
      await expect(service.getForStudent(A.schoolId, A.child, id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.marking(ctx(A.schoolId, A.teacherId), id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("handing in", () => {
    it("a student hands in once; the attempt is final; the paste counts reach staff only", async () => {
      const id = await A.homework(addDaysIso(today(), 2));
      await service.collect(ctx(A.schoolId, A.teacherId), id, { totalMarks: 10 }, reqCtx);
      const mine = await submit(A.child, id, ANSWER, 20, ANSWER.length - 20);
      expect(mine).toMatchObject({ status: "SUBMITTED", canSubmit: false });
      expect(mine.attempts[0]).toMatchObject({ attempt: 1, body: ANSWER, late: false, mark: null });
      expect(JSON.stringify(mine)).not.toMatch(/pasted|typed/i);
      await expect(submit(A.child, id)).rejects.toBeInstanceOf(ConflictError);

      const work = await service.studentWork(ctx(A.schoolId, A.teacherId), id, A.child);
      expect(work.attempts[0]!.pastedPercent).toBe(Math.round(((ANSWER.length - 20) / ANSWER.length) * 100));
      const family = await service.listForGuardian(guardianCtx(A.schoolId, A.guardianId), A.child);
      const row = family.data.find((r) => r.assignmentId === id)!;
      expect(row).toMatchObject({ status: "SUBMITTED", mark: null });
      expect(JSON.stringify(family)).not.toMatch(/pasted|typed|Photosynthesis turns/i);
    });

    it("work after the due date's school day is late; stopping acceptance blocks new work", async () => {
      const id = await A.homework(addDaysIso(today(), -1));
      await service.collect(ctx(A.schoolId, A.teacherId), id, { totalMarks: 10 }, reqCtx);
      expect((await submit(A.child, id)).attempts[0]!.late).toBe(true);
      await service.collect(ctx(A.schoolId, A.teacherId), id, { totalMarks: 10, accepting: false }, reqCtx);
      await expect(submit(A.classmate, id)).rejects.toBeInstanceOf(ConflictError);
      expect((await service.getForStudent(A.schoolId, A.classmate, id)).canSubmit).toBe(false);
    });

    it("a child in another class cannot see or hand in the work", async () => {
      const id = await A.homework(addDaysIso(today(), 2));
      await service.collect(ctx(A.schoolId, A.teacherId), id, { totalMarks: 10 }, reqCtx);
      await expect(service.getForStudent(A.schoolId, A.otherChild, id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(submit(A.otherChild, id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("marking, returning and releasing", () => {
    it("marks stay hidden from the family until released; a changed mark shows its new value", async () => {
      const id = await A.homework(addDaysIso(today(), 2));
      await service.collect(ctx(A.schoolId, A.teacherId), id, { totalMarks: 10 }, reqCtx);
      await submit(A.child, id);
      const latest = (await service.studentWork(ctx(A.schoolId, A.teacherId), id, A.child)).attempts[0]!;
      await expect(service.mark(ctx(A.schoolId, A.teacherId), latest.id, { mark: 11 }, reqCtx)).rejects.toBeInstanceOf(ValidationError);
      await expect(service.mark(ctx(A.schoolId, A.otherTeacherId), latest.id, { mark: 5 }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      const marked = await service.mark(ctx(A.schoolId, A.teacherId), latest.id, { mark: 8, feedback: FEEDBACK }, reqCtx);
      expect(marked.attempts[0]).toMatchObject({ mark: 8, feedback: FEEDBACK, markedByName: "Tunde Staff", releasedAt: null });

      expect((await service.getForStudent(A.schoolId, A.child, id)).attempts[0]).toMatchObject({ mark: null, feedback: null });
      const before = (await service.listForGuardian(guardianCtx(A.schoolId, A.guardianId), A.child)).data.find((r) => r.assignmentId === id)!;
      expect(before).toMatchObject({ status: "MARKED", mark: null, feedback: null });

      const released = await service.release(ctx(A.schoolId, A.teacherId), id, reqCtx);
      expect(released.counts.released).toBe(1);
      await expect(service.release(ctx(A.schoolId, A.teacherId), id, reqCtx)).rejects.toBeInstanceOf(ConflictError);
      expect((await service.getForStudent(A.schoolId, A.child, id)).attempts[0]).toMatchObject({ mark: 8, feedback: FEEDBACK });

      await service.mark(ctx(A.schoolId, A.teacherId), latest.id, { mark: 9, feedback: FEEDBACK }, reqCtx);
      const after = (await service.listForGuardian(guardianCtx(A.schoolId, A.guardianId), A.child)).data.find((r) => r.assignmentId === id)!;
      expect(after).toMatchObject({ mark: 9, feedback: FEEDBACK });

      // The total can't drop below a mark already given.
      await expect(service.collect(ctx(A.schoolId, A.teacherId), id, { totalMarks: 5 }, reqCtx)).rejects.toBeInstanceOf(ConflictError);
    });

    it("returned work opens a new attempt, keeps the old one, and may come back after acceptance stops", async () => {
      const id = await A.homework(addDaysIso(today(), 2));
      await service.collect(ctx(A.schoolId, A.teacherId), id, { totalMarks: 10 }, reqCtx);
      await submit(A.child, id, "Too short.");
      const first = (await service.studentWork(ctx(A.schoolId, A.teacherId), id, A.child)).attempts[0]!;
      await service.returnWork(ctx(A.schoolId, A.teacherId), first.id, { note: "Explain each part." }, reqCtx);
      await expect(service.mark(ctx(A.schoolId, A.teacherId), first.id, { mark: 3 }, reqCtx)).rejects.toBeInstanceOf(ConflictError);
      await service.collect(ctx(A.schoolId, A.teacherId), id, { totalMarks: 10, accepting: false }, reqCtx);

      const mine = await service.getForStudent(A.schoolId, A.child, id);
      expect(mine).toMatchObject({ status: "RETURNED", canSubmit: true });
      expect(mine.attempts[0]!.returnNote).toBe("Explain each part.");
      const again = await submit(A.child, id);
      expect(again.attempts.map((x) => x.attempt)).toEqual([2, 1]);
      expect(again.attempts[1]!.body).toBe("Too short.");
      // The old attempt can no longer be marked or returned.
      await expect(service.mark(ctx(A.schoolId, A.teacherId), first.id, { mark: 3 }, reqCtx)).rejects.toBeInstanceOf(ConflictError);
      const roster = (await service.marking(ctx(A.schoolId, A.teacherId), id)).roster.find((r) => r.studentId === A.child)!;
      expect(roster).toMatchObject({ status: "SUBMITTED", attempts: 2 });
    });
  });

  describe("file answers (CP4.2, Q8)", () => {
    it("a student stages up to three files, hands in with files alone, and they become part of the attempt", async () => {
      const id = await A.homework(addDaysIso(today(), 2), "Draw the leaf");
      await service.collect(ctx(A.schoolId, A.teacherId), id, { totalMarks: 10 }, reqCtx);
      await expect(service.stageFile(A.schoolId, A.child, id, Buffer.from("not a picture at all"))).rejects.toBeInstanceOf(ValidationError);
      await service.stageFile(A.schoolId, A.child, id, PNG);
      await service.stageFile(A.schoolId, A.child, id, PDF);
      const third = await service.stageFile(A.schoolId, A.child, id, PNG);
      expect(third.stagedFiles.map((f) => f.type)).toEqual(["image", "pdf", "image"]);
      await expect(service.stageFile(A.schoolId, A.child, id, PNG)).rejects.toBeInstanceOf(ConflictError);
      const fewer = await service.removeStagedFile(A.schoolId, A.child, id, third.stagedFiles[2]!.id);
      expect(fewer.stagedFiles).toHaveLength(2);

      // The teacher can't see staged files: they are not handed in yet.
      await expect(service.fileUrlForStaff(ctx(A.schoolId, A.teacherId), third.stagedFiles[0]!.id, reqCtx)).rejects.toBeInstanceOf(NotFoundError);

      const mine = await service.submitForStudent(A.schoolId, A.child, id, submitWorkSchema.parse({}));
      expect(mine.stagedFiles).toEqual([]);
      expect(mine.attempts[0]).toMatchObject({ body: null });
      expect(mine.attempts[0]!.files.map((f) => f.type)).toEqual(["image", "pdf"]);
      const fileId = mine.attempts[0]!.files[1]!.id;
      // Handed in is final: no removing, and no staging more.
      await expect(service.removeStagedFile(A.schoolId, A.child, id, fileId)).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.stageFile(A.schoolId, A.child, id, PNG)).rejects.toBeInstanceOf(ConflictError);

      const roster = (await service.marking(ctx(A.schoolId, A.teacherId), id)).roster.find((r) => r.studentId === A.child)!;
      expect(roster).toMatchObject({ fileCount: 2, pastedPercent: null });
      expect((await service.fileUrlForStaff(ctx(A.schoolId, A.teacherId), fileId, reqCtx)).url).toContain(fileId);
      await expect(service.fileUrlForStaff(ctx(A.schoolId, A.otherTeacherId), fileId, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      expect((await service.fileUrlForStudent(A.schoolId, A.child, fileId)).url).toContain(fileId);
      await expect(service.fileUrlForStudent(A.schoolId, A.classmate, fileId)).rejects.toBeInstanceOf(NotFoundError);

      const family = (await service.listForGuardian(guardianCtx(A.schoolId, A.guardianId), A.child)).data.find((r) => r.assignmentId === id)!;
      expect(family.files).toHaveLength(2);
      expect((await service.fileUrlForGuardian(guardianCtx(A.schoolId, A.guardianId), A.child, fileId)).url).toContain(fileId);
      await expect(service.fileUrlForGuardian(guardianCtx(A.schoolId, A.unlinkedGuardianId), A.child, fileId)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("an attempt needs text or a file", async () => {
      const id = await A.homework(addDaysIso(today(), 2), "Empty attempt");
      await service.collect(ctx(A.schoolId, A.teacherId), id, { totalMarks: 10 }, reqCtx);
      await expect(service.submitForStudent(A.schoolId, A.child, id, submitWorkSchema.parse({ body: "   " }))).rejects.toBeInstanceOf(ValidationError);
    });

    it("a guardian never reaches a staged file", async () => {
      const id = await A.homework(addDaysIso(today(), 2), "Staged only");
      await service.collect(ctx(A.schoolId, A.teacherId), id, { totalMarks: 10 }, reqCtx);
      const staged = (await service.stageFile(A.schoolId, A.child, id, PDF)).stagedFiles[0]!.id;
      await expect(service.fileUrlForGuardian(guardianCtx(A.schoolId, A.guardianId), A.child, staged)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("families", () => {
    it("an unlinked guardian and another school's guardian get nothing", async () => {
      await expect(service.listForGuardian(guardianCtx(A.schoolId, A.unlinkedGuardianId), A.child)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(service.listForGuardian(guardianCtx(B.schoolId, B.guardianId), A.child)).rejects.toThrow();
    });

    it("withdrawn homework leaves the family's list", async () => {
      const id = await A.homework(addDaysIso(today(), 2), "Withdrawn work");
      await service.collect(ctx(A.schoolId, A.teacherId), id, { totalMarks: 10 }, reqCtx);
      await withTenant(A.schoolId, (db) => db.assignment.update({ where: { id }, data: { withdrawnAt: new Date(), withdrawnBy: A.teacherId } }));
      const list = await service.listForStudent(A.schoolId, A.child);
      expect(list.data.map((r) => r.assignmentId)).not.toContain(id);
      await expect(service.getForStudent(A.schoolId, A.child, id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("questions and automatic marking (CP4.3)", () => {
    const QUESTIONS = setAssignmentQuestionsSchema.parse({
      questions: [
        { type: "MULTIPLE_CHOICE", text: "Where does photosynthesis happen?", marks: 2, options: ["Roots", "Leaves", "Stem"], correctIndex: 1 },
        { type: "FILL_IN", text: "Plants take in carbon ____.", marks: 3, acceptedAnswers: ["dioxide", "Dioxide gas"] },
      ],
    });
    const answer = (studentId: string, id: string, answers: Record<string, number | string>, body?: string) =>
      service.submitForStudent(A.schoolId, studentId, id, submitWorkSchema.parse({ ...(body ? { body, typedChars: body.length } : {}), answers }));

    it("the teacher sets questions; the student never receives the right answers until marked, and only right or wrong then", async () => {
      const id = await A.homework(addDaysIso(today(), 2));
      await service.collect(ctx(A.schoolId, A.teacherId), id, { totalMarks: 4 }, reqCtx);
      // 5 marks of questions can't fit a total of 4.
      await expect(service.setQuestions(ctx(A.schoolId, A.teacherId), id, QUESTIONS, reqCtx)).rejects.toMatchObject({ code: "QUESTIONS_OVER_TOTAL" });
      await service.collect(ctx(A.schoolId, A.teacherId), id, { totalMarks: 10 }, reqCtx);
      await expect(service.setQuestions(ctx(A.schoolId, A.otherTeacherId), id, QUESTIONS, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      const marking = await service.setQuestions(ctx(A.schoolId, A.teacherId), id, QUESTIONS, reqCtx);
      expect(marking.questions.map((q) => [q.number, q.type, q.marks])).toEqual([
        [1, "MULTIPLE_CHOICE", 2],
        [2, "FILL_IN", 3],
      ]);
      expect(marking.questionsEditable).toBe(true);
      const [mc, fill] = marking.questions as [(typeof marking.questions)[0], (typeof marking.questions)[0]];

      const mine = await service.getForStudent(A.schoolId, A.child, id);
      expect(mine.questions[0]).toEqual({ id: mc.id, number: 1, type: "MULTIPLE_CHOICE", text: mc.text, marks: 2, options: ["Roots", "Leaves", "Stem"] });
      expect(JSON.stringify(mine)).not.toMatch(/correctIndex|acceptedAnswers|Dioxide gas/);

      // Wrong kinds of answer are refused; blanks are fine.
      await expect(answer(A.child, id, { [mc.id]: 4 })).rejects.toBeInstanceOf(ValidationError);
      await expect(answer(A.child, id, { [fill.id]: 1 })).rejects.toBeInstanceOf(ValidationError);
      await expect(answer(A.child, id, { "00000000-0000-4000-8000-000000000000": 1 })).rejects.toBeInstanceOf(ValidationError);
      await expect(answer(A.child, id, { [fill.id]: "   " })).rejects.toBeInstanceOf(ValidationError);

      const handed = await answer(A.child, id, { [mc.id]: 1, [fill.id]: "  DIOXIDE   gas " });
      expect(handed.attempts[0]!.answers).toEqual([
        { questionId: mc.id, number: 1, answer: 1, correct: null },
        { questionId: fill.id, number: 2, answer: "DIOXIDE   gas", correct: null },
      ]);
      // Fixed from the first hand-in, and the total can't drop below them.
      await expect(service.setQuestions(ctx(A.schoolId, A.teacherId), id, { questions: [] }, reqCtx)).rejects.toMatchObject({ code: "QUESTIONS_FIXED" });
      await expect(service.collect(ctx(A.schoolId, A.teacherId), id, { totalMarks: 4 }, reqCtx)).rejects.toMatchObject({ code: "TOTAL_BELOW_QUESTIONS" });
      expect((await service.marking(ctx(A.schoolId, A.teacherId), id)).questionsEditable).toBe(false);

      const work = await service.studentWork(ctx(A.schoolId, A.teacherId), id, A.child);
      expect(work.attempts[0]).toMatchObject({ autoMark: 5 });
      expect(work.attempts[0]!.answers.map((a) => a.correct)).toEqual([true, true]);

      // The classmate gets one wrong and leaves one blank.
      await answer(A.classmate, id, { [mc.id]: 0 });
      const theirs = await service.studentWork(ctx(A.schoolId, A.teacherId), id, A.classmate);
      expect(theirs.attempts[0]).toMatchObject({ autoMark: 0 });
      expect(theirs.attempts[0]!.answers).toEqual([
        { questionId: mc.id, number: 1, answer: 0, correct: false },
        { questionId: fill.id, number: 2, answer: null, correct: false },
      ]);

      // The automatic mark is a starting point; the teacher's mark is the mark.
      await service.mark(ctx(A.schoolId, A.teacherId), work.attempts[0]!.id, { mark: 7 }, reqCtx);
      await service.release(ctx(A.schoolId, A.teacherId), id, reqCtx);
      const released = await service.getForStudent(A.schoolId, A.child, id);
      expect(released.attempts[0]).toMatchObject({ mark: 7 });
      expect(released.attempts[0]!.answers.map((a) => a.correct)).toEqual([true, true]);
      expect(JSON.stringify(released)).not.toMatch(/correctIndex|acceptedAnswers|autoMark/);
      // The family's list carries no answers at all.
      const family = await service.listForGuardian(guardianCtx(A.schoolId, A.guardianId), A.child);
      expect(JSON.stringify(family.data.find((r) => r.assignmentId === id))).not.toMatch(/answers|DIOXIDE|autoMark/);
    });

    it("automatic marks become the marks only for work that is answers alone, and only when the teacher says so", async () => {
      const id = await A.homework(addDaysIso(today(), 2));
      await service.collect(ctx(A.schoolId, A.teacherId), id, { totalMarks: 10 }, reqCtx);
      const { questions } = await service.setQuestions(ctx(A.schoolId, A.teacherId), id, QUESTIONS, reqCtx);
      await answer(A.child, id, { [questions[0]!.id]: 1 });
      await answer(A.classmate, id, { [questions[0]!.id]: 1 }, "And here is my working.");
      const before = await service.marking(ctx(A.schoolId, A.teacherId), id);
      expect(before.roster.map((r) => [r.name, r.status, r.autoMark])).toEqual([
        ["Amara Pupil", "SUBMITTED", 2],
        ["Bola Pupil", "SUBMITTED", 2],
      ]);
      await expect(service.useAutoMarks(ctx(A.schoolId, A.otherTeacherId), id, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      const after = await service.useAutoMarks(ctx(A.schoolId, A.teacherId), id, reqCtx);
      // The written answer still waits for a person.
      expect(after.roster.map((r) => [r.name, r.status, r.mark])).toEqual([
        ["Amara Pupil", "MARKED", 2],
        ["Bola Pupil", "SUBMITTED", null],
      ]);
      await expect(service.useAutoMarks(ctx(A.schoolId, A.teacherId), id, reqCtx)).rejects.toMatchObject({ code: "NOTHING_TO_MARK" });
      // Still hidden from the family until released.
      expect((await service.getForStudent(A.schoolId, A.child, id)).attempts[0]).toMatchObject({ mark: null });
    });

    it("approved multiple-choice questions from the bank, for this class level and subject only, can be copied in", async () => {
      const ids = await withTenant(A.schoolId, async (db) => {
        const make = async (opts: { type: "MULTIPLE_CHOICE" | "THEORY"; status: "APPROVED" | "DRAFT"; subjectId?: string; text: string }) =>
          (
            await db.question.create({
              data: {
                schoolId: A.schoolId,
                subjectId: opts.subjectId ?? A.subjectId,
                classLevelId: A.levelId,
                topic: "Plants",
                type: opts.type,
                text: opts.text,
                marks: 1,
                status: opts.status,
                createdBy: A.teacherId,
                ...(opts.status === "APPROVED" ? { approvedBy: A.teacherId, approvedAt: new Date() } : {}),
                answerGuide: opts.type === "THEORY" ? "Guide" : null,
                ...(opts.type === "MULTIPLE_CHOICE"
                  ? {
                      options: {
                        create: [
                          { schoolId: A.schoolId, orderIndex: 0, text: "Chlorophyll", isCorrect: true },
                          { schoolId: A.schoolId, orderIndex: 1, text: "Starch", isCorrect: false },
                        ],
                      },
                    }
                  : {}),
              },
              select: { id: true },
            })
          ).id;
        const otherSubject = await db.subject.findFirstOrThrow({ where: { id: { not: A.subjectId } }, select: { id: true } });
        return {
          approved: await make({ type: "MULTIPLE_CHOICE", status: "APPROVED", text: `What makes leaves green? ${runId}` }),
          draft: await make({ type: "MULTIPLE_CHOICE", status: "DRAFT", text: `Draft ${runId}` }),
          theory: await make({ type: "THEORY", status: "APPROVED", text: `Theory ${runId}` }),
          otherSubject: await make({ type: "MULTIPLE_CHOICE", status: "APPROVED", subjectId: otherSubject.id, text: `Other ${runId}` }),
        };
      });
      const id = await A.homework(addDaysIso(today(), 2));
      await service.collect(ctx(A.schoolId, A.teacherId), id, { totalMarks: 10 }, reqCtx);
      const bank = await service.bankQuestions(ctx(A.schoolId, A.teacherId), id);
      expect(bank.data.map((q) => q.id)).toEqual([ids.approved]);
      expect(bank.data[0]).toMatchObject({ options: ["Chlorophyll", "Starch"], correctIndex: 0, marks: 1 });
      await expect(service.bankQuestions(ctx(A.schoolId, A.otherTeacherId), id)).rejects.toBeInstanceOf(ForbiddenError);

      const copy = (sourceQuestionId: string) =>
        setAssignmentQuestionsSchema.parse({
          questions: [{ type: "MULTIPLE_CHOICE", text: "What makes leaves green?", marks: 1, options: ["Chlorophyll", "Starch"], correctIndex: 0, sourceQuestionId }],
        });
      for (const bad of [ids.draft, ids.theory, ids.otherSubject]) {
        await expect(service.setQuestions(ctx(A.schoolId, A.teacherId), id, copy(bad), reqCtx)).rejects.toBeInstanceOf(ValidationError);
      }
      const copied = await service.setQuestions(ctx(A.schoolId, A.teacherId), id, copy(ids.approved), reqCtx);
      expect(copied.questions[0]).toMatchObject({ fromBank: true, options: ["Chlorophyll", "Starch"], correctIndex: 0 });
    });

    it("fill-in matching ignores case and spacing, and nothing else", () => {
      expect(normaliseFillIn("  Carbon   DIOXIDE ")).toBe("carbon dioxide");
      const q = { type: "FILL_IN" as const, correctIndex: null, acceptedAnswers: ["Carbon dioxide", "CO2"] };
      expect(isAnswerRight(q, "carbon  dioxide")).toBe(true);
      expect(isAnswerRight(q, " co2 ")).toBe(true);
      expect(isAnswerRight(q, "carbon dioxid")).toBe(false);
      expect(isAnswerRight(q, "carbondioxide")).toBe(false);
      expect(isAnswerRight(q, "")).toBe(false);
      expect(isAnswerRight(q, null)).toBe(false);
      expect(isAnswerRight(q, 0)).toBe(false);
      const mc = { type: "MULTIPLE_CHOICE" as const, correctIndex: 2, acceptedAnswers: null };
      expect(isAnswerRight(mc, 2)).toBe(true);
      expect(isAnswerRight(mc, 1)).toBe(false);
      expect(isAnswerRight(mc, "2")).toBe(false);
    });
  });

  it("names files the same way on every screen", () => {
    const files = [
      { id: "a", type: "image" as const, size: 1 },
      { id: "b", type: "pdf" as const, size: 1 },
      { id: "c", type: "image" as const, size: 1 },
    ];
    expect(files.map((_, i) => describeSubmissionFile(files, i))).toEqual(["photo 1", "PDF", "photo 2"]);
  });

  it("the rules in isolation", () => {
    expect(statusOf(null)).toBe("NOT_SUBMITTED");
    expect(statusOf({ returnedAt: new Date(), markedAt: null })).toBe("RETURNED");
    expect(statusOf({ returnedAt: null, markedAt: new Date() })).toBe("MARKED");
    // 23:30 Lagos on the due date is on time; 00:30 the next day is late.
    expect(isLate("2026-10-15", new Date("2026-10-15T22:30:00Z"))).toBe(false);
    expect(isLate("2026-10-15", new Date("2026-10-15T23:30:00Z"))).toBe(true);
    expect(clampCounts(10, 50, 50)).toEqual({ typed: 0, pasted: 10 });
    expect(clampCounts(10, 4, 3)).toEqual({ typed: 4, pasted: 3 });
    expect(clampCounts(10, -1, -1)).toEqual({ typed: 0, pasted: 0 });
  });

  it("every write is audited, and the audit log holds no answer or feedback text", async () => {
    const rows = await withTenant(A.schoolId, (db) => db.auditLog.findMany({ where: { action: { startsWith: "assignment." } } }));
    expect(new Set(rows.map((r) => r.action))).toEqual(
      new Set([
        "assignment.collect",
        "assignment.submit",
        "assignment.mark",
        "assignment.return",
        "assignment.release",
        "assignment.file.stage",
        "assignment.file.remove",
        "assignment.file.read",
        "assignment.questions.set",
        "assignment.automarks.use",
      ]),
    );
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toMatch(/Photosynthesis turns|leaf|Explain each part|Too short|DIOXIDE|my working|Roots/);
  });
});
