import { expect, test } from "@playwright/test";

import { setupAcademicStructure } from "../fixtures/academic.js";
import { createPortalGuardian, PORTAL_BASE_URL } from "../fixtures/guardian.js";
import { loginAsAdmin, loginAsTeacher } from "../fixtures/session.js";
import { inviteAndAcceptTeacher } from "../fixtures/teacher.js";
import { uniqueSuffix } from "../fixtures/unique.js";

// Phase 9 / CP3.3 — the sickbay log (docs/modules/phase-9.md §10 CP3-D5,
// CP3-D6). Through the real UI: the Health officer records a visit where the
// child is sent home, details NOT shared, and a second visit with medicine,
// details shared. The parent sees both visits, sent home on the first, and
// the complaint and medicine of the second only.
test("the health officer logs sickbay visits; the parent sees only what was shared", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const kept = `Stomach ache ${suffix}`;
  const shared = `Headache ${suffix}`;
  const admin = await loginAsAdmin(browser);
  await setupAcademicStructure(admin.api, { arms: [{ name: "JSS 1 Red", code: `jss1-red-${suffix}` }] });
  const guardian = await createPortalGuardian(admin.api, { suffix, schoolId: admin.schoolId });
  const invited = await inviteAndAcceptTeacher(browser, {
    schoolId: admin.schoolId,
    invitedByUserId: admin.ownerUserId,
    firstName: "Halima",
    lastName: "Officer",
    roleKey: "health_officer",
  });
  await invited.context.close();
  const officer = await loginAsTeacher(browser, invited.email, invited.password);
  const parentContext = await browser.newContext();

  async function recordVisit(complaint: string, opts: { sentHome: boolean; share: boolean; medicine?: string }) {
    const page = officer.page;
    await page.getByRole("button", { name: "Record a visit" }).click();
    await page.getByLabel("Find the child").fill("Chidinma");
    await page.getByRole("button", { name: /Chidinma Adeleke/ }).click();
    const form = page.getByRole("form", { name: "Sickbay visit for Chidinma Adeleke" });
    await form.getByLabel("Complaint").fill(complaint);
    await form.getByLabel("Action taken").fill("Rested and given water");
    if (opts.medicine) {
      await form.getByRole("button", { name: "Add medicine" }).click();
      await form.getByLabel("Medicine", { exact: true }).fill(opts.medicine);
      await form.getByLabel("Dose").fill("500 mg");
    }
    if (opts.sentHome) await form.getByLabel(/Sent home/).check();
    if (opts.share) await form.getByLabel(/Share details with the parent/).check();
    await form.getByRole("button", { name: "Save visit" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: complaint })).toBeVisible({ timeout: 30_000 });
  }

  try {
    // 1. The Health officer records two visits from the Sickbay page.
    const page = officer.page;
    await page.goto("/sickbay");
    await expect(page.getByRole("heading", { name: "Sickbay" })).toBeVisible({ timeout: 60_000 });
    await recordVisit(kept, { sentHome: true, share: false });
    await recordVisit(shared, { sentHome: false, share: true, medicine: "Paracetamol" });
    const keptRow = page.getByRole("listitem").filter({ hasText: kept });
    await expect(keptRow.getByText("Sent home", { exact: true })).toBeVisible();
    await expect(keptRow.getByText("Details not shared")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: shared })).toContainText("Paracetamol, 500 mg");

    // 2. The parent sees both visits, and the details of the shared one only.
    const parent = await parentContext.newPage();
    await parent.goto(`${PORTAL_BASE_URL}/login`);
    await parent.getByLabel("Email").fill(guardian.email);
    await parent.getByLabel("Password", { exact: true }).fill(guardian.password);
    await parent.getByRole("button", { name: "Log in" }).click();
    await expect(parent.getByRole("heading", { name: "Your children" })).toBeVisible({ timeout: 60_000 });
    await parent.goto(`${PORTAL_BASE_URL}/students/${guardian.studentId}`);
    await expect(parent.getByRole("heading", { name: "Sickbay visits" })).toBeVisible({ timeout: 60_000 });
    await expect(parent.getByText(/Visited the sickbay at \d\d:\d\d/)).toHaveCount(2);
    await expect(parent.getByText("Sent home.")).toHaveCount(1);
    await expect(parent.getByText(shared)).toBeVisible();
    await expect(parent.getByText(/Paracetamol, 500 mg/)).toBeVisible();
    await expect(parent.getByText(kept)).toHaveCount(0);
  } finally {
    await parentContext.close();
    await officer.context.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
