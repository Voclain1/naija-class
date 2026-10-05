import { expect, test } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { apiCreateEnrollment, apiCreateStudent } from "../fixtures/finance.js";
import { armId, loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";

// Online exams (CBT3, docs/modules/cbt.md D5, D8) — the teacher's results
// page, through the real UI:
//   1. A student who used two computers needs a choice; "Use this one" makes
//      the second count.
//   2. The theory mark from the paper script is typed and saved; the total
//      appears.
//   3. "Send to the gradebook": the preview shows "mark/out of → scaled", and
//      saving writes the raw mark and its scaled score to the gradebook.
// The attempts themselves are written straight to the database, as the lab
// computers would have sent them (the sending is CBT2's E2E).

test("a teacher marks an online exam, chooses the computer that counts, adds the theory mark and sends totals to the gradebook", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 2 Gold", code: `cbtr-gold-${suffix}` }],
    subjectName: "Basic Science",
    subjectCode: `bsr-${suffix}`,
  });
  const classArmId = armId(structure, "JSS 2 Gold");
  const student = await apiCreateStudent(admin.api, {
    admissionNumber: `CBTR/${suffix}/1`,
    firstName: "Kemi",
    lastName: "Bello",
    dateOfBirth: "2013-05-14T00:00:00.000Z",
    gender: "FEMALE",
  });
  await apiCreateEnrollment(admin.api, { studentId: student.id, termId: structure.termId, classArmId });

  // A FINAL paper: two multiple-choice questions (2 + 3 marks) and one theory (10).
  const pair = { subjectId: structure.subjectId, classLevelId: structure.classLevelId };
  const approve = async (body: Record<string, unknown>) => {
    const created = await admin.api.post("questions", { data: { ...pair, ...body } });
    expect(created.ok(), await created.text()).toBe(true);
    const { id } = (await created.json()) as { id: string };
    expect((await admin.api.post(`questions/${id}/approve`)).ok()).toBe(true);
    return id;
  };
  const mcq = (text: string, marks: number) =>
    approve({ topic: "Matter", type: "MULTIPLE_CHOICE", difficulty: "EASY", text, marks, options: ["Solid", "Liquid", "Gas"].map((o, i) => ({ text: o, isCorrect: i === 0 })) });
  const objectiveIds = [await mcq("Ice is a…", 2), await mcq("Steel is a…", 3)];
  const theory = await approve({ topic: "Matter", type: "THEORY", difficulty: "HARD", text: "Describe melting.", marks: 10, answerGuide: "Heat." });
  const components = (await (await admin.api.get("grading-scheme/components")).json()) as { id: string; label: string; weight: number }[];
  const exam = components.find((c) => /exam/i.test(c.label)) ?? components.at(-1)!;
  const title = `Basic Science results ${suffix}`;
  const paperRes = await admin.api.post("exam-papers", { data: { ...pair, termId: structure.termId, title, durationMinutes: 40, versionCount: 1 } });
  const paper = (await paperRes.json()) as { id: string };
  expect(
    (await admin.api.put(`exam-papers/${paper.id}`, {
      data: { title, durationMinutes: 40, instructions: null, componentId: exam.id, versionCount: 1, sections: [{ title: "A", questionIds: objectiveIds }, { title: "B", questionIds: [theory] }] },
    })).ok(),
  ).toBe(true);
  expect((await admin.api.post(`exam-papers/${paper.id}/finalise`)).ok()).toBe(true);

  const now = Date.now();
  const sittingRes = await admin.api.post("cbt/sittings", {
    data: { paperId: paper.id, title, classArmIds: [classArmId], startsAt: new Date(now + 3_600_000).toISOString(), windowEndsAt: new Date(now + 7_200_000).toISOString(), durationMinutes: 40 },
  });
  const sitting = (await sittingRes.json()) as { id: string };
  expect((await admin.api.post(`cbt/sittings/${sitting.id}/publish`)).ok()).toBe(true);

  // Two computers: the first stopped after one right answer; the second finished with both right.
  await withTenant(admin.schoolId, async (db) => {
    const items = await db.examPaperItem.findMany({
      where: { paperId: paper.id, question: { type: "MULTIPLE_CHOICE" } },
      orderBy: { orderIndex: "asc" },
      include: { question: { include: { options: true } } },
    });
    const right = (i: number) => items[i]!.question.options.find((o) => o.isCorrect)!.id;
    const candidate = await db.cbtCandidate.findFirstOrThrow({ where: { sittingId: sitting.id, studentId: student.id } });
    const base = { schoolId: admin.schoolId, sittingId: sitting.id, candidateId: candidate.id, seq: 3 };
    await db.cbtAttempt.create({
      data: { ...base, deviceId: "11111111-1111-4111-8111-111111111111", answers: { [items[0]!.id]: right(0) }, answeredCount: 1, startedAt: new Date(now - 50 * 60_000), firstReceivedAt: new Date(now - 49 * 60_000) },
    });
    await db.cbtAttempt.create({
      data: {
        ...base, deviceId: "22222222-2222-4222-8222-222222222222", answers: { [items[0]!.id]: right(0), [items[1]!.id]: right(1) }, answeredCount: 2,
        startedAt: new Date(now - 40 * 60_000), submittedAt: new Date(now - 10 * 60_000), firstReceivedAt: new Date(now - 39 * 60_000),
      },
    });
  });

  const page = admin.page;
  try {
    // ---- 1. Choose the computer that counts ------------------------------------
    await page.goto(`/teacher/cbt/${sitting.id}`);
    await page.getByRole("link", { name: "Results" }).click();
    await expect(page.getByRole("heading", { name: "Results", level: 1 })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Choose which computer counts")).toBeVisible();
    await expect(page.getByText("Did not finish")).toBeVisible();
    await page.getByRole("button", { name: "Use this one" }).nth(1).click();
    await expect(page.getByText("Counts")).toBeVisible();
    await expect(page.getByRole("cell", { name: "5/5" })).toBeVisible();

    // ---- 2. Theory mark ----------------------------------------------------------
    await page.getByLabel("Theory mark for Kemi Bello").fill("11");
    await expect(page.getByText("Theory marks are whole numbers from 0 to 10.")).toBeVisible();
    await page.getByLabel("Theory mark for Kemi Bello").fill("7");
    await page.getByRole("button", { name: "Save theory marks (1)" }).click();
    await expect(page.getByRole("cell", { name: "12", exact: true })).toBeVisible();

    // ---- 3. Gradebook ------------------------------------------------------------
    await expect(page.getByLabel("Gradebook column")).toHaveValue(exam.id);
    await page.getByRole("button", { name: "Preview gradebook marks" }).click();
    const scaled = Math.floor((2 * 12 * exam.weight + 15) / (2 * 15));
    await expect(page.getByRole("region", { name: "Gradebook preview" })).toContainText(`Bello, Kemi: 12/15 → ${scaled}`);
    await page.screenshot({ path: "test-results/cbt/5-results.png", fullPage: true });
    await page.getByRole("button", { name: "Save to gradebook" }).click();
    await expect(page.getByText("Saved 1 mark to the gradebook.")).toBeVisible();

    const saved = await withTenant(admin.schoolId, (db) =>
      db.assessmentScore.findFirst({ where: { componentId: exam.id, studentId: student.id, termId: structure.termId, subjectId: structure.subjectId } }),
    );
    expect(saved).toMatchObject({ score: scaled, rawScore: 12, rawOutOf: 15 });
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});
