import { expect, test } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import {
  armId,
  assignTeacher,
  createApiContext,
  inviteAndAcceptTeacher,
  loginAsAdmin,
  loginAsTeacher,
  setupAcademicStructure,
  uniqueSuffix,
} from "../fixtures/index.js";

// Phase 8c / CP5b — the question bank (docs/modules/phase-8.md §22.2).
//
// Through the real UI:
//   1. The owner writes a multiple-choice question; it lands as a DRAFT and is
//      approved.
//   2. Revising the approved question saves a NEW draft — the approved wording
//      stays in use — and approving the revision retires the original.
//   3. AI drafts (seeded here: CI has no model) are labelled as AI drafts and
//      can be discarded; asking for AI drafts while the school's AI is off says
//      so plainly and saves nothing.
//   4. The subject teacher sees the bank for the subject they teach, and the
//      API refuses them a question outside it.

const SHOTS = "test-results/question-bank";
const SUBJECT = "Further Physics";

test("questions are drafted, approved and revised without changing approved wording; AI drafts are labelled; scope holds", async ({
  browser,
}) => {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 2 Gold", code: `qb-gold-${suffix}` }],
    subjectName: SUBJECT,
    subjectCode: `fphy-${suffix}`,
  });
  const teacher = await inviteAndAcceptTeacher(browser, { schoolId: admin.schoolId, invitedByUserId: admin.ownerUserId });
  await teacher.context.close();
  await assignTeacher(admin.api, {
    teacherId: teacher.userId,
    classArmId: armId(structure, "JSS 2 Gold"),
    subjectId: structure.subjectId,
    academicYearId: structure.academicYearId,
  });
  const page = admin.page;
  page.on("dialog", (d) => void d.accept());

  try {
    await page.goto("/teacher/question-bank");
    await expect(page.getByRole("heading", { name: "Question bank", level: 1 })).toBeVisible({ timeout: 60_000 });
    await page.getByLabel("Class", { exact: true }).selectOption({ label: "JSS 2" });
    await page.getByLabel("Subject", { exact: true }).selectOption({ label: SUBJECT });
    await expect(page.getByRole("heading", { name: `JSS 2 ${SUBJECT}` })).toBeVisible();

    // ---- 1. Write and approve -------------------------------------------------
    await page.getByRole("button", { name: "Write a question" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Topic").fill("Motion");
    await dialog.getByLabel("Question").fill("Which of these is a vector quantity?");
    await dialog.getByLabel("Option A", { exact: true }).fill("Speed");
    await dialog.getByLabel("Option B", { exact: true }).fill("Mass");
    await dialog.getByLabel("Option C", { exact: true }).fill("Displacement");
    await dialog.getByLabel("Option D", { exact: true }).fill("Time");
    // No correct answer chosen: refused with the API's own words.
    await dialog.getByRole("button", { name: "Save draft" }).click();
    await expect(dialog.getByText("Mark exactly one option as the correct answer.")).toBeVisible();
    await dialog.getByLabel("Option C is correct").check();
    await dialog.getByRole("button", { name: "Save draft" }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByRole("tab", { name: "Drafts to review (1)" })).toBeVisible();
    const card = page.getByRole("article", { name: /Motion: Which of these is a vector/ });
    await expect(card.getByRole("listitem").filter({ hasText: "Displacement" })).toContainText("Correct");
    await card.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("tab", { name: "Approved (1)" })).toBeVisible();

    // ---- 2. Revise: a new draft, the approved wording untouched ----------------
    await page.getByRole("tab", { name: /Approved/ }).click();
    await page.getByRole("article", { name: /Which of these is a vector/ }).getByRole("button", { name: "Revise" }).click();
    await expect(dialog.getByText(/your changes are saved as a new draft/)).toBeVisible();
    await dialog.getByLabel("Question").fill("Which of the following is a vector quantity?");
    await dialog.getByRole("button", { name: "Save as new draft" }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByRole("tab", { name: "Drafts to review (1)" })).toBeVisible();
    const revision = page.getByRole("article", { name: /Which of the following/ });
    await expect(revision).toContainText("Revision of an approved question");
    await page.getByRole("tab", { name: /Approved/ }).click();
    const original = page.getByRole("article", { name: /Which of these is a vector/ });
    await expect(original).toContainText("A revised draft of this question is waiting for approval");
    await expect(original.getByRole("button", { name: "Revise" })).toBeDisabled();
    await page.screenshot({ path: `${SHOTS}/1-revision-pending.png`, fullPage: true });

    await page.getByRole("tab", { name: /Drafts/ }).click();
    await revision.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("tab", { name: "Drafts to review (0)" })).toBeVisible();
    await page.getByRole("tab", { name: /Approved/ }).click();
    await expect(page.getByRole("article", { name: /Which of the following/ })).toBeVisible();
    await expect(page.getByRole("article", { name: /Which of these is a vector/ })).toHaveCount(0);
    await page.getByRole("tab", { name: /Retired/ }).click();
    await expect(page.getByRole("article", { name: /Which of these is a vector/ })).toContainText("Retired");

    const rows = await withTenant(admin.schoolId, (db) =>
      db.question.findMany({
        where: { subjectId: structure.subjectId },
        select: { text: true, status: true, approvedBy: true, supersedesId: true },
        orderBy: { createdAt: "asc" },
      }),
    );
    expect(rows).toEqual([
      { text: "Which of these is a vector quantity?", status: "RETIRED", approvedBy: admin.ownerUserId, supersedesId: null },
      expect.objectContaining({ text: "Which of the following is a vector quantity?", status: "APPROVED", approvedBy: admin.ownerUserId }),
    ]);

    // ---- 3. AI drafts --------------------------------------------------------
    await withTenant(admin.schoolId, async (db) => {
      for (const text of ["Define acceleration.", "State Newton's first law of motion."]) {
        await db.question.create({
          data: {
            schoolId: admin.schoolId,
            subjectId: structure.subjectId,
            classLevelId: structure.classLevelId,
            topic: "Motion",
            type: "SHORT_ANSWER",
            text,
            marks: 2,
            answerGuide: "Model answer.",
            source: "AI",
            createdBy: admin.ownerUserId,
          },
        });
      }
    });
    await page.reload();
    await page.getByLabel("Class", { exact: true }).selectOption({ label: "JSS 2" });
    await page.getByLabel("Subject", { exact: true }).selectOption({ label: SUBJECT });
    await expect(page.getByRole("tab", { name: "Drafts to review (2)" })).toBeVisible();
    const aiDraft = page.getByRole("article", { name: /Define acceleration/ });
    await expect(aiDraft).toContainText("AI draft — check before approving");
    await page.screenshot({ path: `${SHOTS}/2-ai-drafts.png`, fullPage: true });
    await aiDraft.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByRole("tab", { name: "Drafts to review (1)" })).toBeVisible();

    // The school's AI is off (the default): drafting says so, and saves nothing.
    await page.getByLabel("Topic", { exact: true }).fill("Equations of motion");
    await page.getByRole("button", { name: "Draft questions" }).click();
    await expect(page.getByText("AI features are disabled for this school.")).toBeVisible();
    expect(await withTenant(admin.schoolId, (db) => db.question.count({ where: { topic: "Equations of motion" } }))).toBe(0);

    // ---- 4. The subject teacher, and scope -------------------------------------
    const teacherSession = await loginAsTeacher(browser, teacher.email, teacher.password);
    const teacherApi = await createApiContext(teacherSession.token);
    try {
      const tp = teacherSession.page;
      await tp.goto("/teacher/question-bank");
      // One class and subject taught: chosen for them.
      await expect(tp.getByRole("heading", { name: `JSS 2 ${SUBJECT}` })).toBeVisible({ timeout: 60_000 });
      await tp.getByRole("tab", { name: /Approved/ }).click();
      await expect(tp.getByRole("article", { name: /Which of the following/ })).toBeVisible();
      await expect(tp.getByLabel("Subject", { exact: true }).locator("option")).toHaveText(["Choose a subject…", SUBJECT]);

      // A question in a subject this teacher does not teach does not exist for them.
      const other = await withTenant(admin.schoolId, async (db) => {
        const civic = await db.subject.findFirstOrThrow({ where: { name: "Civic Education" }, select: { id: true } });
        return db.question.create({
          data: {
            schoolId: admin.schoolId,
            subjectId: civic.id,
            classLevelId: structure.classLevelId,
            topic: "Rights",
            type: "THEORY",
            text: "Explain two rights of a citizen.",
            marks: 10,
            answerGuide: "Any two rights, explained.",
            createdBy: admin.ownerUserId,
          },
          select: { id: true },
        });
      });
      expect((await teacherApi.get(`questions/${other.id}`)).status()).toBe(404);
      expect((await teacherApi.post(`questions/${other.id}/approve`)).status()).toBe(404);
    } finally {
      await teacherApi.dispose();
      await teacherSession.context.close();
    }
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});
