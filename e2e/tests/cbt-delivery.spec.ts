import { expect, test } from "@playwright/test";

import { basePrisma, withTenant } from "@school-kit/db";

import { apiCreateEnrollment, apiCreateStudent } from "../fixtures/finance.js";
import { armId, loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";

// Online exams (CBT2, docs/modules/cbt.md D3–D7) — a student's whole sitting
// on a lab computer, in the real exam app (apps/cbt, :3003):
//   1. The invigilator downloads the exam with the access code; it is locked.
//   2. The unlock code opens it; a wrong one does not.
//   3. The student signs in with their admission number and confirms their name.
//   4. They answer; the computer "loses power" (a reload); after the unlock
//      code and sign-in again they carry on where they were, answers kept.
//   5. They finish; the answers reach the school, and the teacher's page shows
//      "Submitted — 2 of 2 answered".

const CBT_URL = "http://localhost:3003";

test("a student sits an online exam on a lab computer, survives a reload, and the answers reach the school", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 2 Gold", code: `cbtd-gold-${suffix}` }],
    subjectName: "Basic Science",
    subjectCode: `bsd-${suffix}`,
  });
  const classArmId = armId(structure, "JSS 2 Gold");
  const admissionNumber = `CBTD/${suffix}/1`;
  const student = await apiCreateStudent(admin.api, {
    admissionNumber,
    firstName: "Kemi",
    lastName: "Bello",
    dateOfBirth: "2013-05-14T00:00:00.000Z",
    gender: "FEMALE",
  });
  await apiCreateEnrollment(admin.api, { studentId: student.id, termId: structure.termId, classArmId });

  // A FINAL paper with two multiple-choice questions, through the real API.
  const pair = { subjectId: structure.subjectId, classLevelId: structure.classLevelId };
  const mcq = async (text: string) => {
    const created = await admin.api.post("questions", {
      data: { ...pair, topic: "Matter", type: "MULTIPLE_CHOICE", difficulty: "EASY", text, marks: 1, options: ["Solid", "Liquid", "Gas"].map((o, i) => ({ text: o, isCorrect: i === 0 })) },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const { id } = (await created.json()) as { id: string };
    expect((await admin.api.post(`questions/${id}/approve`)).ok()).toBe(true);
    return id;
  };
  const questionIds = [await mcq("Ice is a…"), await mcq("Steel is a…")];
  const title = `Basic Science CBT ${suffix}`;
  const paperRes = await admin.api.post("exam-papers", { data: { ...pair, termId: structure.termId, title, durationMinutes: 30, versionCount: 1 } });
  expect(paperRes.ok(), await paperRes.text()).toBe(true);
  const paper = (await paperRes.json()) as { id: string };
  expect(
    (await admin.api.put(`exam-papers/${paper.id}`, {
      data: { title, durationMinutes: 30, instructions: null, componentId: null, versionCount: 1, sections: [{ title: "Section A — Objectives", questionIds }] },
    })).ok(),
  ).toBe(true);
  expect((await admin.api.post(`exam-papers/${paper.id}/finalise`)).ok()).toBe(true);

  // Scheduled to have just started, and published.
  const now = Date.now();
  const sittingRes = await admin.api.post("cbt/sittings", {
    data: { paperId: paper.id, title, classArmIds: [classArmId], startsAt: new Date(now - 60_000).toISOString(), windowEndsAt: new Date(now + 3_600_000).toISOString(), durationMinutes: 30 },
  });
  expect(sittingRes.ok(), await sittingRes.text()).toBe(true);
  const sitting = (await sittingRes.json()) as { id: string };
  expect((await admin.api.post(`cbt/sittings/${sitting.id}/publish`)).ok()).toBe(true);
  const sheet = (await (await admin.api.get(`cbt/sittings/${sitting.id}/invigilator-sheet`)).json()) as { accessCode: string; unlockCode: string; schoolSlug: string };

  const lab = await browser.newContext();
  const page = await lab.newPage();
  try {
    // ---- 1. Download ---------------------------------------------------------
    await page.goto(`${CBT_URL}/${sheet.schoolSlug}`);
    await expect(page.getByRole("heading", { name: "Exams on this computer" })).toBeVisible({ timeout: 90_000 });
    await page.getByLabel("Download an exam").fill(sheet.accessCode.toLowerCase());
    await page.getByRole("button", { name: "Download" }).click();
    await expect(page.getByText(title)).toBeVisible();

    // ---- 2. Unlock -----------------------------------------------------------
    const unlock = async () => {
      await page.getByRole("button", { name: "Start this exam" }).click();
      await page.getByLabel("Invigilator: unlock code").fill(sheet.unlockCode);
      await page.getByRole("button", { name: "Unlock" }).click();
      await expect(page.getByLabel("Your admission number")).toBeVisible();
    };
    await page.getByRole("button", { name: "Start this exam" }).click();
    await page.getByLabel("Invigilator: unlock code").fill("AAAA-AAAA-AAAA");
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByText("That unlock code is not right for this exam.")).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await unlock();

    // ---- 3. Sign in ----------------------------------------------------------
    const signIn = async () => {
      await page.getByLabel("Your admission number").fill(admissionNumber.toLowerCase());
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText("Kemi B.")).toBeVisible();
    };
    await page.getByLabel("Your admission number").fill("NOPE/1");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText(/not on the list for this exam/)).toBeVisible();
    await signIn();
    await page.getByRole("button", { name: "Yes, start the exam" }).click();

    // ---- 4. Answer, lose power, carry on --------------------------------------
    await expect(page.getByRole("timer", { name: "Time left" })).toHaveText(/^(29|30):\d\d$/);
    await expect(page.getByText("Question 1 of 2")).toBeVisible();
    await page.getByRole("radio").first().check();
    await expect(page.getByRole("button", { name: "Question 1, answered" })).toBeVisible();
    await page.screenshot({ path: "test-results/cbt/3-lab-exam.png", fullPage: true });

    await page.reload();
    await expect(page.getByRole("heading", { name: "Exams on this computer" })).toBeVisible({ timeout: 60_000 });
    await unlock();
    await signIn();
    await expect(page.getByText("Welcome back. Your answers are saved.")).toBeVisible();
    await page.getByRole("button", { name: "Carry on" }).click();
    await expect(page.getByRole("radio").first()).toBeChecked();

    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Question 2 of 2")).toBeVisible();
    await page.getByRole("radio").nth(1).check();

    // ---- 5. Finish -----------------------------------------------------------
    await page.getByRole("button", { name: "Finish exam" }).click();
    await expect(page.getByText("You have answered 2 of 2 questions.")).toBeVisible();
    await page.getByRole("button", { name: "Yes, finish" }).click();
    await expect(page.getByRole("heading", { name: "Exam finished" })).toBeVisible();
    await expect(page.getByText("All answers sent to the school")).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "test-results/cbt/4-lab-finished.png", fullPage: true });

    const school = await basePrisma.school.findUniqueOrThrow({ where: { slug: sheet.schoolSlug }, select: { id: true } });
    const attempts = await withTenant(school.id, (db) => db.cbtAttempt.findMany({ where: { sittingId: sitting.id } }));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ answeredCount: 2 });
    expect(attempts[0]!.submittedAt).not.toBeNull();

    // A second sign-in on this computer is told they have finished.
    await page.getByRole("button", { name: "Next student" }).click();
    await signIn();
    await expect(page.getByText("You have already finished this exam on this computer.")).toBeVisible();

    // The teacher sees it on the exam's page.
    await admin.page.goto(`/teacher/cbt/${sitting.id}`);
    await expect(admin.page.getByRole("cell", { name: "Submitted — 2 of 2 answered" })).toBeVisible({ timeout: 60_000 });
  } finally {
    await lab.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
