import { expect, test } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { apiCreateEnrollment, apiCreateStudent } from "../fixtures/finance.js";
import { armId, loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";

// Phase 8c / CP5a (phase-8.md §22.1, D60) — marks typed "out of" any total.
//
// A teacher who marked an exam out of 100 types the marks as marked; the
// SERVER scales them to the component's weight (Exam /60), rounding half up,
// and the teacher confirms the conversion before anything is saved.
//
// Through the real UI, as the school owner:
//   1. Set Exam "Out of" 100; a mark over 100 is refused at the cell.
//   2. Save shows the server's conversion (75/100 → 45/60, 37/100 → 22/60);
//      "Back to editing" saves nothing.
//   3. Confirming saves; the score is the scaled one and the raw mark is kept.
//   4. Reopening the column shows it out of 100 again, with the marks as typed.

const SHOTS = "test-results/gradebook-out-of";

test("marks typed out of 100 are converted by the server, confirmed, saved with the raw mark, and reopen as typed", async ({
  browser,
}) => {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "SS 1 Blue", code: `ss1-blue-${suffix}` }],
    subjectName: "Biology",
    subjectCode: `bio-${suffix}`,
  });
  const classArmId = armId(structure, "SS 1 Blue");
  const { termId, subjectId } = structure;
  for (const s of [
    { admissionNumber: `OO/${suffix}/1`, firstName: "Chidi", lastName: "Eze" },
    { admissionNumber: `OO/${suffix}/2`, firstName: "Funke", lastName: "Ade" },
  ]) {
    const created = await apiCreateStudent(admin.api, { ...s, dateOfBirth: "2010-03-02T00:00:00.000Z", gender: "MALE" });
    await apiCreateEnrollment(admin.api, { studentId: created.id, termId, classArmId });
  }
  const page = admin.page;

  try {
    await page.goto(`/gradebook/${classArmId}/${subjectId}?termId=${termId}`);
    await expect(page.getByRole("heading", { name: "Biology — SS 1 Blue" })).toBeVisible({ timeout: 60_000 });

    // ---- 1. Out of 100 ------------------------------------------------------
    const outOf = page.getByLabel("Exam out of");
    await outOf.fill("100");
    await outOf.press("Enter");
    await page.getByLabel("Eze Exam").fill("101");
    await expect(page.getByText("0–100")).toBeVisible();
    await page.getByLabel("Eze Exam").fill("75");
    await page.getByLabel("Ade Exam").fill("37");
    await page.getByLabel("Eze First CA").fill("15");
    // While anything is unsaved, the total cannot change under the typed marks.
    await expect(outOf).toBeDisabled();

    // ---- 2. The server's conversion, confirmed first ------------------------
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Check the converted marks" })).toBeVisible();
    await expect(dialog.getByRole("row", { name: /Eze, Chidi/ })).toContainText("75/100");
    await expect(dialog.getByRole("row", { name: /Eze, Chidi/ })).toContainText("45/60");
    await expect(dialog.getByRole("row", { name: /Ade, Funke/ })).toContainText("22/60");
    // The weight-units CA mark is not a conversion, so it is not listed.
    await expect(dialog.getByRole("row")).toHaveCount(3); // header + 2
    await page.screenshot({ path: `${SHOTS}/1-confirm.png`, fullPage: true });

    await dialog.getByRole("button", { name: "Back to editing" }).click();
    await expect(dialog).toBeHidden();
    expect(await withTenant(admin.schoolId, (db) => db.assessmentScore.count({ where: { termId } }))).toBe(0);

    // ---- 3. Saved, scaled, raw kept -----------------------------------------
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await dialog.getByRole("button", { name: "Save these marks" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect(page.getByRole("row", { name: /Eze/ })).toContainText("60"); // total 15 + 45

    const saved = await withTenant(admin.schoolId, (db) =>
      db.assessmentScore.findMany({
        where: { termId, component: { label: "Exam" } },
        select: { score: true, rawScore: true, rawOutOf: true },
        orderBy: { score: "desc" },
      }),
    );
    expect(saved).toEqual([
      { score: 45, rawScore: 75, rawOutOf: 100 },
      { score: 22, rawScore: 37, rawOutOf: 100 },
    ]);

    // ---- 4. Reopens out of 100, as typed ------------------------------------
    await page.reload();
    await expect(page.getByLabel("Exam out of")).toHaveValue("100");
    await expect(page.getByLabel("Eze Exam")).toHaveValue("75");
    await expect(page.getByText("Saved 45/60")).toBeVisible();
    await expect(page.getByLabel("Eze First CA")).toHaveValue("15");
    await page.screenshot({ path: `${SHOTS}/2-reopened.png`, fullPage: true });
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});
