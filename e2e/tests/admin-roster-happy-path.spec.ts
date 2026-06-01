import { expect, test, type BrowserContext } from "@playwright/test";

import {
  armId,
  loginAsAdmin,
  setupAcademicStructure,
} from "../fixtures/index.js";
import { uniqueSuffix } from "../fixtures/unique.js";

// Slice 13 (Q4 critical path) — an operational roster-setup walk that proves
// admin forms actually write rows through the real UI, then closes the
// student → enrollment loop.
//
// Scope rationale: the headline "a form submit creates a row and it shows up"
// property is proven through the student-create FORM (the most representative
// admin write). The surrounding academic structure is built API-first (already
// covered by slice 1–3 specs), the student → enrollment loop is closed and
// asserted, and staff invite + acceptance is already covered end-to-end by
// phase-0-happy-path.spec.ts — so this test doesn't re-drive those UIs.

test("admin roster happy-path — create a student via the UI, then enrol them", async ({
  browser,
}) => {
  const toClose: BrowserContext[] = [];
  const admin = await loginAsAdmin(browser);
  toClose.push(admin.context);
  const page = admin.page;

  const suffix = uniqueSuffix();
  const admissionNumber = `ADM/${suffix}/001`;

  try {
    // --- API-first: academic structure (year + current term + arm) ---------
    const structure = await setupAcademicStructure(admin.api, {
      arms: [{ name: "JSS 1 A", code: `jss1a-${suffix}` }],
      subjectName: "Mathematics",
    });

    // --- UI: create a student through the admin form -----------------------
    await page.goto("/students/new");
    await expect(page.getByRole("heading", { name: "Add student" })).toBeVisible();

    // Fill ONLY the required fields; optional fields stay blank. The student
    // form must accept blank optionals and submit — proven by the empty-optional
    // fix (PR fix/empty-optional-forms). This test passes once that fix is on
    // main; it fails on a tree without it (the form silently no-ops).
    await page.locator("#student-admissionNumber").fill(admissionNumber);
    await page.locator("#student-firstName").fill("Ada");
    await page.locator("#student-lastName").fill("Okafor");
    await page.locator("#student-dateOfBirth").fill("2012-09-15");
    await page.locator("#student-gender").selectOption("FEMALE");

    await page.getByRole("button", { name: "Create student" }).click();

    // On success the form routes to the new student's detail page
    // (/students/<uuid> — not the /students/new form it submitted from).
    await page.waitForURL(/\/students\/[0-9a-f-]{36}$/);
    const studentId = page.url().match(/\/students\/([0-9a-f-]{36})$/)?.[1];
    expect(studentId, "student id in detail URL").toBeTruthy();
    await expect(page.getByText(admissionNumber).first()).toBeVisible();

    // --- UI: the new student appears in the roster list --------------------
    await page.goto("/students");
    await expect(page.getByText(admissionNumber).first()).toBeVisible();

    // --- Close the loop: enrol the UI-created student (API) + assert --------
    const enrolRes = await admin.api.post("enrollments", {
      data: {
        studentId,
        termId: structure.termId,
        classArmId: armId(structure, "JSS 1 A"),
      },
    });
    expect(enrolRes.ok(), `enrollment status ${enrolRes.status()}`).toBeTruthy();

    const list = await admin.api.get(
      `enrollments?termId=${structure.termId}`,
    );
    expect(list.ok()).toBeTruthy();
    const body = (await list.json()) as { data: Array<{ studentId: string }> };
    expect(body.data.map((e) => e.studentId)).toContain(studentId);
  } finally {
    for (const ctx of toClose) await ctx.close();
    await admin.api.dispose();
  }
});
