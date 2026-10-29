import { expect, test } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";

// Disposable local/CI school only. Exercise the real build and reasoned reopen;
// no release or PDF job is triggered.
test("late enrollment is visible and draft rebuild preserves comments", async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await loginAsAdmin(browser);
  try {
    const structure = await setupAcademicStructure(admin.api);
    const classArmId = structure.arms[0]!.id;
    const input = { termId: structure.termId, classArmId };
    const addStudent = async (firstName: string) => {
      const response = await admin.api.post("students/bulk", { data: {
        enrollment: input,
        students: [{ admissionNumber: `RC-${uniqueSuffix()}`, firstName, lastName: "Roster", dateOfBirth: "2012-01-01", gender: "FEMALE" }],
      } });
      expect(response.ok(), await response.text()).toBe(true);
    };
    await addStudent("First");
    const built = await admin.api.post("report-cards/arm/build", { data: input });
    expect(built.ok(), await built.text()).toBe(true);
    const original = await withTenant(admin.schoolId, (db) => db.reportCard.findFirstOrThrow({ where: input }));
    await withTenant(admin.schoolId, (db) => db.reportCard.update({
      where: { id: original.id }, data: { formTeacherComment: "Preserve my feedback" },
    }));
    await addStudent("Late");
    await admin.page.goto(`/report-cards/${classArmId}?termId=${structure.termId}`);
    const roster = admin.page.getByRole("region", { name: "Report-card roster" });
    await expect(roster).toContainText("2 enrolled students · 1 report card");
    await expect(roster).toContainText("Late Roster");
    await roster.getByRole("button", { name: "Rebuild draft report cards" }).click();
    await expect(roster).toContainText("2 enrolled students · 2 report cards");
    await expect(roster).not.toContainText("missing a report card");
    const preserved = await withTenant(admin.schoolId, (db) => db.reportCard.findUniqueOrThrow({ where: { id: original.id } }));
    expect(preserved.formTeacherComment).toBe("Preserve my feedback");

    // SUBJECT_REVIEWED previously had neither a rebuild nor a reopen action.
    await withTenant(admin.schoolId, (db) => db.reportCard.updateMany({ where: input, data: { status: "SUBJECT_REVIEWED" } }));
    await addStudent("Newest");
    await admin.page.reload();
    await expect(roster).toContainText("Newest Roster");
    await expect(roster.getByRole("button", { name: "Rebuild draft report cards" })).toHaveCount(0);
    const refused = await admin.api.post("report-cards/arm/build", { data: input });
    expect(refused.status()).toBe(409);
    await admin.page.getByRole("button", { name: "Reopen arm", exact: true }).click();
    const dialog = admin.page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Reopen arm", exact: true })).toBeDisabled();
    await dialog.getByLabel("Reason for reopening").fill("Include newly enrolled pupil");
    await dialog.getByRole("button", { name: "Reopen arm", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await roster.getByRole("button", { name: "Rebuild draft report cards" }).click();
    await expect(roster).toContainText("3 enrolled students · 3 report cards");
    const audit = await withTenant(admin.schoolId, (db) => db.auditLog.findFirst({ where: { action: "report-card.reopen" }, orderBy: { createdAt: "desc" } }));
    expect(audit?.metadata).toMatchObject({ reason: "Include newly enrolled pupil" });
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});
