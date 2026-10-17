import { expect, test } from "@playwright/test";

import { assignTeacher, inviteAndAcceptTeacher, loginAsAdmin, loginAsTeacher, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";

// Phase 9 / CP6.3 — digital resources (docs/modules/phase-9.md §14 CP6-D7), in
// a real browser against a throwaway school: a teacher adds a PDF for the
// subject and class they teach (the only subject the form offers them), opens
// it through its signed link, and the admin sees it on the library's
// Resources page, where they can add a link for any subject.

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");

test("a teacher adds a PDF for their subject and class, and the library sees it", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 2 Gold", code: `jss2g-${suffix}`.slice(0, 20) }],
    subjectCode: `math-${suffix}`.slice(0, 20),
  });
  const invited = await inviteAndAcceptTeacher(browser, { schoolId: admin.schoolId, invitedByUserId: admin.ownerUserId });
  await invited.context.close();
  await assignTeacher(admin.api, {
    teacherId: invited.userId,
    classArmId: structure.arms[0]!.id,
    subjectId: structure.subjectId,
    academicYearId: structure.academicYearId,
  });
  const teacher = await loginAsTeacher(browser, invited.email, invited.password);
  const title = `Fractions worksheet ${suffix}`;

  try {
    // 1. The teacher adds a PDF for their subject, at the class they teach it.
    const page = teacher.page;
    await page.goto("/teacher/resources");
    await expect(page.getByRole("heading", { name: "Library resources" })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Add a resource" }).click();
    const form = page.getByRole("form", { name: "New resource" });
    await form.getByLabel("Title").fill(title);
    // Only the subject they teach is offered.
    await expect(form.getByLabel("Subject").locator("option")).toHaveCount(2);
    await form.getByLabel("Subject").selectOption({ index: 1 });
    await form.getByLabel("JSS 2").check();
    await form.getByLabel("PDF", { exact: true }).setInputFiles({ name: "fractions.pdf", mimeType: "application/pdf", buffer: PDF });
    await form.getByRole("button", { name: "Add resource" }).click();
    await expect(page.getByText(`"${title}" added. Students in JSS 2 can now see it.`)).toBeVisible();

    // 2. It opens through a signed link (headless Chromium downloads a PDF
    // rather than showing it, so the check is the signed-link answer).
    const signed = page.waitForResponse((res) => /\/library\/resources\/[^/]+\/file$/.test(new URL(res.url()).pathname));
    await page.getByRole("button", { name: `Open ${title}` }).click();
    const res = await signed;
    expect(res.status()).toBe(200);
    expect(((await res.json()) as { url: string }).url).toMatch(/library\/.+\.pdf/);
    await expect(page.getByRole("button", { name: `Remove ${title}` })).toBeVisible();

    // 3. The admin sees it, and adds a link for the school.
    await admin.page.goto("/library/resources");
    await expect(admin.page.getByText(title)).toBeVisible({ timeout: 60_000 });
    await admin.page.getByRole("button", { name: "Add a resource" }).click();
    const adminForm = admin.page.getByRole("form", { name: "New resource" });
    await adminForm.getByLabel("A web link").check();
    await adminForm.getByLabel("Title").fill(`Times tables ${suffix}`);
    await adminForm.getByLabel("Subject").selectOption({ index: 1 });
    await adminForm.getByLabel("JSS 2").check();
    await adminForm.getByLabel("Web address").fill("https://www.example.org/times-tables");
    await adminForm.getByRole("button", { name: "Add resource" }).click();
    await expect(admin.page.getByRole("link", { name: `Open Times tables ${suffix}` })).toBeVisible();

    // 4. The teacher cannot remove the admin's link.
    await page.reload();
    await expect(page.getByText(`Times tables ${suffix}`)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: `Remove Times tables ${suffix}` })).toHaveCount(0);
  } finally {
    await teacher.context.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
