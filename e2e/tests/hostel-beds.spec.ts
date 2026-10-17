import { expect, test } from "@playwright/test";

import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";
import { setupFinanceScaffold } from "../fixtures/finance.js";

// Phase 9 / CP6b.1 — hostels (docs/modules/phase-9.md §15), in a real browser
// against a throwaway school: a girls' hostel with a room and a fee, a girl
// given a bed (raising the hostel charge), the student page's line, and the
// charge on Finance → Charges.

test("a hostel with a room and a fee gives a girl a bed and raises the charge", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 1 Blue", code: `jss1b-${suffix}`.slice(0, 20) }],
    subjectCode: `math-${suffix}`.slice(0, 20),
  });
  const arm = structure.arms[0]!;
  const { students } = await setupFinanceScaffold(admin.api, {
    suffix,
    termId: structure.termId,
    classArmId: arm.id,
    classLevelId: structure.classLevelId,
    academicYearId: structure.academicYearId,
  });
  // The scaffold's first student is a girl.
  const child = students[0]!;
  const childName = `${child.firstName} ${child.lastName}`;

  try {
    const page = admin.page;

    // 1. A girls' hostel.
    await page.goto("/hostels");
    await page.getByLabel("Hostel name").fill("Queen Amina House");
    await page.getByLabel("For", { exact: true }).selectOption({ label: "Girls" });
    await page.getByRole("button", { name: "Create hostel" }).click();
    await expect(page.getByRole("heading", { name: "Queen Amina House" })).toBeVisible();

    // 2. A room of four beds, and a fee.
    const roomForm = page.getByRole("form", { name: "New room" });
    await roomForm.getByLabel("Room name").fill("Room A");
    await roomForm.getByLabel("Beds").fill("4");
    await roomForm.getByRole("button", { name: "Add room" }).click();
    await expect(page.getByText("Room A", { exact: true })).toBeVisible();

    await page.getByLabel("Fee (₦)").fill("120,000");
    await page.getByRole("button", { name: "Save fee" }).click();
    await expect(page.getByText(/^Fee saved\./)).toBeVisible();

    // 3. The girl given a bed this term.
    await page.locator("#hostel-term").selectOption({ index: 1 });
    await expect(page.getByText("0 of 4 beds taken")).toBeVisible();
    await page.getByLabel("Find a student").fill(child.firstName);
    await page.getByRole("button", { name: "Find", exact: true }).click();
    await page.getByRole("button", { name: `Choose ${childName}` }).click();
    await expect(page.getByText(/raises a ₦120,000(\.00)? hostel charge/)).toBeVisible();
    await page.getByRole("button", { name: "Give a bed" }).click();
    await expect(page.getByText("1 of 4 beds taken")).toBeVisible();
    await expect(page.getByText(/Room A, bed 1/)).toBeVisible();
    await expect(page.getByText("Fee waiting to be billed")).toBeVisible();

    // 4. The student page says so.
    await page.goto(`/students/${child.id}`);
    await expect(page.getByText("Queen Amina House · Room A, bed 1")).toBeVisible();

    // 5. The charge is on Finance → Charges, as a hostel line.
    await page.goto("/finance/charges");
    await page.locator("#charges-term").selectOption({ index: 1 });
    await page.locator("#charges-class").selectOption({ label: arm.name });
    await expect(page.getByText("Hostel — Queen Amina House")).toBeVisible();
    await expect(page.getByText("Waiting to be billed")).toBeVisible();
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});
