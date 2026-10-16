import { expect, test } from "@playwright/test";
import { withTenant } from "@school-kit/db";
import { addDaysIso, lagosTodayIso } from "@school-kit/types";

import { armId, assignTeacher, setupAcademicStructure } from "../fixtures/academic.js";
import { apiCreateEnrollment } from "../fixtures/finance.js";
import { createPortalGuardian } from "../fixtures/guardian.js";
import { loginAsAdmin, loginAsTeacher } from "../fixtures/session.js";
import { inviteAndAcceptTeacher } from "../fixtures/teacher.js";
import { uniqueSuffix } from "../fixtures/unique.js";

// Phase 9 / CP4.3 — questions marked automatically (docs/modules/phase-9.md
// §11 CP4-D6). Through the real UI: a teacher adds a multiple-choice and a
// fill-in question to collected work; a child's answers arrive (seeded, with
// the automatic mark the server works out on hand-in — that path is covered by
// assignments.service.spec.ts, and students hand in from the app); the teacher
// sees each answer marked right or wrong, uses the automatic mark and releases.
// Once anyone has handed in, the questions can no longer be edited.
test("a teacher sets questions, sees answers marked automatically and uses the automatic mark", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const title = `Plants quiz ${suffix}`;
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api, { arms: [{ name: "JSS 2 Gold", code: `j2q-${suffix}` }] });
  const classArmId = armId(structure, "JSS 2 Gold");
  const guardian = await createPortalGuardian(admin.api, { suffix, schoolId: admin.schoolId });
  await apiCreateEnrollment(admin.api, { studentId: guardian.studentId, termId: structure.termId, classArmId });

  const invited = await inviteAndAcceptTeacher(browser, { schoolId: admin.schoolId, invitedByUserId: admin.ownerUserId });
  await invited.context.close();
  await assignTeacher(admin.api, {
    teacherId: invited.userId,
    classArmId,
    subjectId: structure.subjectId,
    academicYearId: structure.academicYearId,
  });

  const teacher = await loginAsTeacher(browser, invited.email, invited.password);
  try {
    // 1. Homework that collects work.
    const page = teacher.page;
    await page.goto("/teacher/homework");
    await expect(page.getByRole("heading", { name: "Set homework" })).toBeVisible({ timeout: 60_000 });
    const pickers = page.getByRole("combobox");
    await pickers.nth(0).selectOption({ label: "JSS 2 Gold" });
    await pickers.nth(1).selectOption({ index: 1 });
    await page.getByLabel("What is it").fill(title);
    await page.getByLabel("Due").fill(addDaysIso(lagosTodayIso(), 2));
    await page.getByRole("button", { name: "Set homework" }).click();
    const item = page.getByRole("listitem").filter({ hasText: title });
    await expect(item).toBeVisible({ timeout: 30_000 });
    await item.getByRole("button", { name: "Collect work" }).click();
    await item.getByLabel("Total marks").fill("10");
    await item.getByRole("button", { name: "Start collecting" }).click();
    await item.getByRole("link", { name: "Handed-in work" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 60_000 });

    // 2. Two questions: multiple choice, and fill in the blank.
    await page.getByRole("button", { name: "Add questions" }).click();
    const editor = page.getByRole("region", { name: "Edit questions" });
    await editor.getByRole("button", { name: "Add multiple choice" }).click();
    await editor.getByRole("button", { name: "Add fill in the blank" }).click();
    const [mc, fill] = [editor.getByRole("listitem").nth(0), editor.getByRole("listitem").nth(1)];
    await mc.getByLabel("Question").fill("Where does photosynthesis happen?");
    await mc.getByLabel("Marks").fill("2");
    await mc.getByLabel("Option A", { exact: true }).fill("Roots");
    await mc.getByLabel("Option B", { exact: true }).fill("Leaves");
    await mc.getByLabel("Option B is right").check();
    await fill.getByLabel("Question").fill("Plants take in carbon ____.");
    await fill.getByLabel("Marks").fill("3");
    await fill.getByLabel("Accepted answers, one per line").fill("dioxide\ndioxide gas");
    await expect(editor.getByText("The questions add up to 5 of the 10 marks.")).toBeVisible();
    await editor.getByRole("button", { name: "Save questions" }).click();
    const questions = page.getByRole("region", { name: "Questions", exact: true });
    await expect(questions.getByText(/Worth 5 of the 10 marks/)).toBeVisible({ timeout: 30_000 });
    await expect(questions.getByText("(right answer)")).toBeVisible();

    // 3. The child's answers arrive, both right, as the server marks them.
    await withTenant(admin.schoolId, async (db) => {
      const hw = await db.assignment.findFirstOrThrow({ where: { title }, include: { collection: { include: { questions: true } } } });
      const byType = (t: string) => hw.collection!.questions.find((q) => q.type === t)!.id;
      await db.assignmentSubmission.create({
        data: {
          schoolId: admin.schoolId,
          collectionId: hw.collection!.id,
          studentId: guardian.studentId,
          attempt: 1,
          answers: { [byType("MULTIPLE_CHOICE")]: 1, [byType("FILL_IN")]: "Dioxide" },
          autoMark: 5,
        },
      });
    });

    // 4. Fixed now; the answers show right or wrong; use the automatic mark.
    await page.reload();
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Fixed now that students have started handing in/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit questions" })).toHaveCount(0);
    const row = page.getByRole("button", { name: /Chidinma Adeleke/ });
    await expect(row.getByText("Automatic 5/10")).toBeVisible();
    await row.click();
    const answers = page.getByRole("region", { name: "Answers, attempt 1" });
    await expect(answers.getByText("Right: B. Leaves")).toBeVisible({ timeout: 30_000 });
    await expect(answers.getByText("Right: Dioxide")).toBeVisible();
    await expect(answers.getByText("Questions: 5 of 5 marks, marked automatically")).toBeVisible();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Use automatic marks" }).click();
    await expect(row.getByText("5/10", { exact: true })).toBeVisible({ timeout: 30_000 });
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Release 1 mark" }).click();
    await expect(page.getByRole("button", { name: "No new marks to release" })).toBeVisible({ timeout: 30_000 });
  } finally {
    await teacher.context.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
