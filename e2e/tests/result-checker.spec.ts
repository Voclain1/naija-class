import { expect, test, type Page } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { armId, loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";
import { createPortalGuardian, PORTAL_BASE_URL, type PortalGuardian } from "../fixtures/guardian.js";

// Phase 8c / CP6b — the Result Checker's happy path, end to end
// (docs/modules/phase-8.md §21): a class released behind result PINs is
// locked in the guardian portal until a PIN is entered, and a family with no
// account at all opens a result on the public checker with an admission
// number and a PIN.

async function signIn(page: Page, guardian: PortalGuardian): Promise<void> {
  await page.goto(`${PORTAL_BASE_URL}/login`);
  await page.getByLabel("Email").fill(guardian.email);
  await page.getByLabel("Password", { exact: true }).fill(guardian.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Your children" })).toBeVisible();
}

test("PIN-mode results: locked in the portal until a PIN, and open on the public checker", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const guardian = await createPortalGuardian(admin.api, { suffix, schoolId: admin.schoolId });
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 3 Gold", code: `jss3-gold-${suffix}` }],
    subjectCode: `rc-${suffix}`,
  });
  const classArmId = armId(structure, "JSS 3 Gold");

  const { slug, admissionNumber } = await withTenant(admin.schoolId, async (db) => {
    await db.reportCard.create({
      data: {
        schoolId: admin.schoolId,
        studentId: guardian.studentId,
        termId: structure.termId,
        academicYearId: structure.academicYearId,
        classArmId,
        status: "RELEASED",
        releasedAt: new Date(),
        accessMode: "PIN",
        overallTotal: 84,
        overallAverage: 8400,
        subjectsCount: 1,
      },
    });
    const school = await db.school.findUniqueOrThrow({ where: { id: admin.schoolId }, select: { slug: true } });
    const student = await db.student.findUniqueOrThrow({
      where: { id: guardian.studentId },
      select: { admissionNumber: true },
    });
    return { slug: school.slug, admissionNumber: student.admissionNumber };
  });

  // Two cards from one batch, through the real staff endpoint.
  const generated = await admin.api.post("result-pins/batches", {
    data: { termId: structure.termId, quantity: 2, maxUses: 5 },
  });
  expect(generated.ok()).toBe(true);
  const { pins } = (await generated.json()) as { pins: { serial: string; pin: string }[] };
  const portalPin = pins[0]!;
  const checkerPin = pins[1]!;

  const parentContext = await browser.newContext();
  const parent = await parentContext.newPage();
  const publicContext = await browser.newContext();
  const visitor = await publicContext.newPage();

  try {
    // 1. The parent sees the term exists, but locked, with no figures.
    await signIn(parent, guardian);
    await parent.goto(`${PORTAL_BASE_URL}/students/${guardian.studentId}/results`);
    await expect(parent.getByText("Result PIN required.")).toBeVisible();
    await expect(parent.getByText("84.00%")).toHaveCount(0);

    // 2. The term page asks for the PIN; a wrong one is refused in words.
    await parent.getByRole("link", { name: "Enter your PIN" }).click();
    await expect(parent.getByRole("heading", { name: "These results need a result PIN" })).toBeVisible();
    await parent.getByLabel("Result PIN", { exact: true }).fill("1111 2222 3333");
    await parent.getByRole("button", { name: "Open results" }).click();
    await expect(parent.locator("main").getByRole("alert")).toContainText("isn't valid");

    // 3. The right PIN opens the card.
    await parent.getByLabel("Result PIN", { exact: true }).fill(portalPin.pin);
    await parent.getByRole("button", { name: "Open results" }).click();
    await expect(parent.getByText("84.00%")).toBeVisible();

    // 4. The public checker, with no account: a wrong PIN gets the one
    //    uniform answer, the right one opens the result.
    await visitor.goto(`${PORTAL_BASE_URL}/result-checker/${slug}`);
    await expect(visitor.getByRole("heading", { name: /result checker/i })).toBeVisible();
    await visitor.getByLabel("Admission number").fill(admissionNumber);
    await visitor.getByLabel("Result PIN", { exact: true }).fill("9999 8888 7777");
    await visitor.getByRole("button", { name: "Check result" }).click();
    await expect(visitor.locator("main").getByRole("alert")).toContainText("We couldn't find results for those details");

    await visitor.getByLabel("Result PIN", { exact: true }).fill(checkerPin.pin);
    await visitor.getByRole("button", { name: "Check result" }).click();
    await expect(visitor.getByText("This PIN has 4 uses left.")).toBeVisible();
    await expect(visitor.getByText("84.00%")).toBeVisible();
  } finally {
    await parentContext.close();
    await publicContext.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});

test("staff generate a PIN batch and are told plainly the PINs are shown once", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 1 Red", code: `jss1-red-${suffix}` }],
    subjectCode: `pn-${suffix}`,
  });

  try {
    await admin.page.goto("/report-cards/pins");
    await expect(admin.page.getByRole("heading", { name: "Result PINs" })).toBeVisible();
    await admin.page.getByLabel("How many PINs").fill("3");
    await admin.page.getByRole("button", { name: "Generate PINs" }).click();
    await expect(admin.page.getByText("These PINs are shown only now.")).toBeVisible();
    await expect(admin.page.getByRole("button", { name: "Download CSV" })).toBeVisible();
    // The batch is listed with its counts, never its PINs.
    await expect(admin.page.getByRole("cell", { name: "B1" })).toBeVisible();
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});
