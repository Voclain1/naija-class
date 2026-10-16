import { expect, test } from "@playwright/test";
import { withTenant } from "@school-kit/db";
import { addDaysIso, lagosTodayIso, scaleRawMark } from "@school-kit/types";

import { armId, assignTeacher, setupAcademicStructure } from "../fixtures/academic.js";
import { apiCreateEnrollment } from "../fixtures/finance.js";
import { createPortalGuardian } from "../fixtures/guardian.js";
import { loginAsAdmin, loginAsTeacher } from "../fixtures/session.js";
import { inviteAndAcceptTeacher } from "../fixtures/teacher.js";
import { uniqueSuffix } from "../fixtures/unique.js";

// Phase 9 / CP4.4 — the similarity check and the gradebook push
// (docs/modules/phase-9.md §11 CP4-D8, CP4-D9). Through the real UI: two
// children's marked answers that share most of their wording arrive (seeded;
// handing in and marking are covered by the earlier slices); the teacher checks
// for similar wording and sees the pair with the shared passage highlighted,
// then sends the marks to a gradebook column through the gradebook's own
// preview and save, scaled by the server.
const ANSWER =
  "Photosynthesis is how green plants make their own food. Using light from the sun, the plant takes water from the soil " +
  "and carbon dioxide from the air and turns them into glucose and oxygen. Most of it happens in the leaves, inside " +
  "chloroplasts, where the green pigment chlorophyll catches the light energy the plant needs to do this work every day.";

test("a teacher sees answers that share wording and sends the marks to the gradebook", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const title = `Plants essay ${suffix}`;
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api, { arms: [{ name: "JSS 2 Gold", code: `j2s-${suffix}` }] });
  const classArmId = armId(structure, "JSS 2 Gold");
  const guardian = await createPortalGuardian(admin.api, { suffix, schoolId: admin.schoolId });
  await apiCreateEnrollment(admin.api, { studentId: guardian.studentId, termId: structure.termId, classArmId });
  const classmateId = await withTenant(admin.schoolId, async (db) => {
    const s = await db.student.create({
      data: {
        schoolId: admin.schoolId,
        admissionNumber: `SIM-${suffix}`,
        firstName: "Bola",
        lastName: "Okafor",
        dateOfBirth: new Date("2013-01-01T00:00:00.000Z"),
        gender: "FEMALE",
      },
      select: { id: true },
    });
    return s.id;
  });
  await apiCreateEnrollment(admin.api, { studentId: classmateId, termId: structure.termId, classArmId });
  const components = (await (await admin.api.get("grading-scheme/components")).json()) as { id: string; label: string; weight: number }[];
  const column = components[0]!;

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
    await expect(item.getByRole("link", { name: "Handed-in work" })).toBeVisible({ timeout: 30_000 });

    // 2. Two marked answers sharing most of their wording.
    await withTenant(admin.schoolId, async (db) => {
      const hw = await db.assignment.findFirstOrThrow({ where: { title }, include: { collection: true } });
      for (const [studentId, body, mark] of [
        [guardian.studentId, ANSWER, 8],
        [classmateId, ANSWER.replace("every day", "each day"), 6],
      ] as const) {
        await db.assignmentSubmission.create({
          data: {
            schoolId: admin.schoolId,
            collectionId: hw.collection!.id,
            studentId,
            attempt: 1,
            body,
            typedChars: body.length,
            mark,
            markedBy: invited.userId,
            markedAt: new Date(),
          },
        });
      }
    });

    // 3. The similarity check lists the pair, the shared passage highlighted.
    await item.getByRole("link", { name: "Handed-in work" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 60_000 });
    const similar = page.getByRole("region", { name: "Similar wording" });
    await similar.getByRole("button", { name: "Check for similar wording" }).click();
    await expect(similar.getByText("Compared 2 typed answers.")).toBeVisible({ timeout: 30_000 });
    await expect(similar.getByText(/share a lot of wording \(about \d+%\): worth a look/)).toBeVisible();
    await similar.getByRole("button", { name: "Show the answers" }).click();
    await expect(similar.locator("mark").first()).toContainText("Photosynthesis is how green plants");
    await expect(page.getByText(/plagiaris/i)).toHaveCount(0);

    // 4. Send both marks to the gradebook, preview first.
    const push = page.getByRole("region", { name: "Send to the gradebook" });
    await push.getByLabel("Gradebook column").selectOption(column.id);
    await push.getByRole("button", { name: "Preview gradebook marks" }).click();
    const preview = push.getByRole("region", { name: "Gradebook preview" });
    await expect(preview).toContainText(`8/10 → ${scaleRawMark(8, 10, column.weight)}`, { timeout: 30_000 });
    await expect(preview).toContainText(`6/10 → ${scaleRawMark(6, 10, column.weight)}`);
    await preview.getByRole("button", { name: "Save to gradebook" }).click();
    await expect(push.getByText("Saved 2 marks to the gradebook.")).toBeVisible({ timeout: 30_000 });
    const saved = await withTenant(admin.schoolId, (db) =>
      db.assessmentScore.findFirst({
        where: { componentId: column.id, studentId: guardian.studentId, termId: structure.termId, subjectId: structure.subjectId },
      }),
    );
    expect(saved?.score).toBe(scaleRawMark(8, 10, column.weight));
  } finally {
    await teacher.context.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
