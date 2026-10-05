import { expect, test } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { apiCreateEnrollment, apiCreateStudent } from "../fixtures/finance.js";
import { armId, loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";

// Online exams (CBT1, docs/modules/cbt.md). Through the real UI, as the owner:
//   1. A final paper (2 multiple-choice + 1 theory) is offered for scheduling,
//      with "1 other question stays on paper".
//   2. Schedule it for tomorrow; the draft shows the live student count.
//   3. Publish: the student list is fixed, with versions.
//   4. The invigilator sheet shows the access and unlock codes and the
//      register — and opening it is audited.

const SUBJECT = "Basic Science";

test("a final paper is scheduled as an online exam, published, and its invigilator sheet shows the codes", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 2 Gold", code: `cbt-gold-${suffix}` }],
    subjectName: SUBJECT,
    subjectCode: `bsc-${suffix}`,
  });
  const classArmId = armId(structure, "JSS 2 Gold");
  for (const [i, [firstName, lastName]] of [["Kemi", "Bello"], ["Tobi", "Ade"]].entries()) {
    const student = await apiCreateStudent(admin.api, {
      admissionNumber: `CBT/${suffix}/${i}`,
      firstName: firstName!,
      lastName: lastName!,
      dateOfBirth: "2013-05-14T00:00:00.000Z",
      gender: "FEMALE",
    });
    await apiCreateEnrollment(admin.api, { studentId: student.id, termId: structure.termId, classArmId });
  }

  // A FINAL paper, through the real API.
  const pair = { subjectId: structure.subjectId, classLevelId: structure.classLevelId };
  const approve = async (body: Record<string, unknown>) => {
    const created = await admin.api.post("questions", { data: { ...pair, ...body } });
    expect(created.ok(), await created.text()).toBe(true);
    const { id } = (await created.json()) as { id: string };
    expect((await admin.api.post(`questions/${id}/approve`)).ok()).toBe(true);
    return id;
  };
  const mcq = (text: string) =>
    approve({ topic: "Matter", type: "MULTIPLE_CHOICE", difficulty: "EASY", text, marks: 2, options: ["Solid", "Liquid", "Gas"].map((o, i) => ({ text: o, isCorrect: i === 0 })) });
  const ids = [await mcq("Ice is a…"), await mcq("Steel is a…")];
  const theory = await approve({ topic: "Matter", type: "THEORY", difficulty: "HARD", text: "Describe the water cycle.", marks: 10, answerGuide: "Evaporation, condensation." });
  const created = await admin.api.post("exam-papers", {
    data: { ...pair, termId: structure.termId, title: `Basic Science exam ${suffix}`, durationMinutes: 60, versionCount: 2 },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const paper = (await created.json()) as { id: string };
  const saved = await admin.api.put(`exam-papers/${paper.id}`, {
    data: {
      title: `Basic Science exam ${suffix}`,
      durationMinutes: 60,
      instructions: null,
      componentId: null,
      versionCount: 2,
      sections: [
        { title: "Section A — Objectives", questionIds: ids },
        { title: "Section B — Theory", questionIds: [theory] },
      ],
    },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  expect((await admin.api.post(`exam-papers/${paper.id}/finalise`)).ok()).toBe(true);

  const page = admin.page;
  page.on("dialog", (d) => void d.accept());
  try {
    // ---- 1–2. Schedule -------------------------------------------------------
    await page.goto("/teacher/cbt");
    await expect(page.getByRole("heading", { name: "Online exams", level: 1 })).toBeVisible({ timeout: 60_000 });
    await page.getByLabel("Exam paper").selectOption(paper.id);
    await expect(page.getByText("2 multiple-choice questions (4 marks) will be sat online. 1 other question stays on paper.")).toBeVisible();
    const tomorrow = new Date(Date.now() + 24 * 3_600_000).toISOString().slice(0, 10);
    await page.getByLabel("Date").fill(tomorrow);
    await page.getByLabel("Length (minutes)").fill("30");
    await page.getByRole("button", { name: "Schedule exam" }).click();
    await expect(page).toHaveURL(/\/teacher\/cbt\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();
    await expect(page.getByText("2 questions · 4 marks")).toBeVisible();
    await expect(page.getByText("1 question · 10 marks")).toBeVisible();

    // ---- 3. Publish ----------------------------------------------------------
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Published", { exact: true })).toBeVisible();
    await expect(page.getByText("Versions A–B")).toBeVisible();
    await expect(page.getByRole("cell", { name: "Bello, Kemi" })).toBeVisible();
    await page.screenshot({ path: "test-results/cbt/1-published.png", fullPage: true });

    // ---- 4. Invigilator sheet ------------------------------------------------
    await page.getByRole("link", { name: "Invigilator sheet" }).click();
    await expect(page.getByLabel("Access code")).toHaveText(/^[A-Z2-9]{6}$/);
    await expect(page.getByLabel("Unlock code")).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    await expect(page.getByText("Register (2)")).toBeVisible();
    await expect(page.getByText(`CBT/${suffix}/0`)).toBeVisible();
    await page.screenshot({ path: "test-results/cbt/2-invigilator-sheet.png", fullPage: true });

    const sittingId = page.url().split("/").at(-2)!;
    const viewed = await withTenant(admin.schoolId, (db) =>
      db.auditLog.count({ where: { entityId: sittingId, action: "cbt-sitting.view-codes" } }),
    );
    expect(viewed).toBeGreaterThanOrEqual(1);
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});
