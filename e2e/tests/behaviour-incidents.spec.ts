import { expect, test } from "@playwright/test";

import { armId, setupAcademicStructure } from "../fixtures/academic.js";
import { apiCreateEnrollment, apiCreateStudent } from "../fixtures/finance.js";
import { loginAsAdmin } from "../fixtures/session.js";
import { uniqueSuffix } from "../fixtures/unique.js";

// Phase 9 / CP2.2 — incidents (docs/modules/phase-9.md §9 CP2-D2). Through
// the real UI, as the owner: an incident with two students from a class,
// one with their own note. Each student's Behaviour tab then shows a concern
// that is part of the incident.
test("the owner records an incident involving two students", async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const suffix = uniqueSuffix();
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: `JSS 2 Red ${suffix}`, code: `jss2-red-${suffix}` }],
  });
  const classArmId = armId(structure, `JSS 2 Red ${suffix}`);
  const make = async (first: string, n: number) => {
    const student = await apiCreateStudent(admin.api, {
      admissionNumber: `BI/${suffix}/${n}`,
      firstName: first,
      lastName: "Eze",
      dateOfBirth: "2012-05-01T00:00:00.000Z",
      gender: "MALE",
    });
    await apiCreateEnrollment(admin.api, { studentId: student.id, termId: structure.termId, classArmId });
    return student;
  };
  const ikenna = await make("Ikenna", 1);
  await make("Obinna", 2);

  try {
    const page = admin.page;
    await page.goto("/behaviour");
    await expect(page.getByRole("heading", { name: "Behaviour", level: 1 })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Incidents" })).toBeVisible();

    await page.getByRole("button", { name: "Record an incident" }).click();
    await page.getByLabel("Where").fill("Football field");
    await page.getByLabel("What happened").fill("A fight broke out during break.");
    await page.getByLabel("Choose from a class").selectOption({ label: `JSS 2 Red ${suffix}` });
    await page.getByRole("checkbox", { name: "Ikenna Eze" }).check();
    await page.getByRole("checkbox", { name: "Obinna Eze" }).check();
    await page.getByLabel("Note for Ikenna Eze").fill("Started it.");
    await page.getByRole("button", { name: "Save incident" }).click();

    await expect(page.getByText("Incident recorded.")).toBeVisible({ timeout: 30_000 });
    const card = page.getByRole("listitem").filter({ hasText: "Football field" }).first();
    await expect(card).toContainText("A fight broke out during break.");
    await expect(card).toContainText("Ikenna Eze — Started it.");
    await expect(card).toContainText("Obinna Eze");

    await page.goto(`/students/${ikenna.id}`);
    await page.getByRole("tab", { name: "Behaviour" }).click();
    await expect(page.getByText("Part of an incident: Football field")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Started it.")).toBeVisible();
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});
