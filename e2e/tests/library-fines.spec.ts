import { expect, test } from "@playwright/test";

import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";
import { apiCreateAcademicYear, apiCreateTerm, apiSetCurrentTerm, apiSetCurrentYear } from "../fixtures/api.js";
import { backdateLibraryLoan } from "../fixtures/db.js";
import { apiCreateEnrollment } from "../fixtures/finance.js";
import { createPortalGuardian, PORTAL_BASE_URL } from "../fixtures/guardian.js";

// Phase 9 / CP6.2 — library fines (docs/modules/phase-9.md §14 CP6-D3/D6), in a
// real browser against a throwaway school: the admin turns fines on, a child's
// book is three days late (the API refuses a past due date, so the loan is
// backdated in the database — the only synthetic step), the parent sees it
// overdue, the desk shows the fine before taking the book back, and the fine
// is a library charge on Finance → Charges.

async function ok<T>(res: { ok(): boolean; status(): number; text(): Promise<string>; json(): Promise<unknown> }, label: string): Promise<T> {
  if (!res.ok()) throw new Error(`${label}: ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

/** YYYY-MM-DD in Lagos, `days` from today. */
function lagosDay(days: number): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test("a late book is fined at the desk, the parent saw it overdue, and the fine is a library charge", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 1 Gold", code: `jss1g-${suffix}`.slice(0, 20) }],
    subjectCode: `math-${suffix}`.slice(0, 20),
  });
  const arm = structure.arms[0]!;
  // A term around today, so the late days fall inside a term.
  const year = await apiCreateAcademicYear(admin.api, {
    label: `Library ${suffix}`.slice(0, 30),
    startDate: `${lagosDay(-120)}T00:00:00.000Z`,
    endDate: `${lagosDay(120)}T00:00:00.000Z`,
  });
  const term = await apiCreateTerm(admin.api, year.id, {
    sequence: 1,
    name: "Library Term",
    startDate: `${lagosDay(-60)}T00:00:00.000Z`,
    endDate: `${lagosDay(60)}T00:00:00.000Z`,
  });
  await apiSetCurrentYear(admin.api, year.id);
  await apiSetCurrentTerm(admin.api, term.id);
  const guardian = await createPortalGuardian(admin.api, { suffix, schoolId: admin.schoolId });
  await apiCreateEnrollment(admin.api, { studentId: guardian.studentId, termId: term.id, classArmId: arm.id });
  const title = `Purple Hibiscus ${suffix}`;
  const accessionNumber = `F-${suffix}`.slice(0, 30).toUpperCase();
  const parentContext = await browser.newContext();

  try {
    const page = admin.page;

    // 1. Fines on, ₦50 a day.
    await page.goto("/library/settings");
    await page.getByLabel("Fine students for late books").check();
    await page.getByLabel("Fine per day (₦)").fill("50");
    await page.getByRole("button", { name: "Save rules" }).click();
    await expect(page.getByText("Rules saved. They apply to books lent from now on.")).toBeVisible();

    // 2. A book lent to the child, now three days late.
    await ok(await admin.api.post("library/books", { data: { title, copies: { accessionNumbers: [accessionNumber] } } }), "book");
    const loan = await ok<{ id: string }>(
      await admin.api.post("library/loans/issue", { data: { accessionNumber, studentId: guardian.studentId } }),
      "issue",
    );
    await backdateLibraryLoan(admin.schoolId, loan.id, 3);

    // 3. The parent sees the book, overdue.
    const parent = await parentContext.newPage();
    await parent.goto(`${PORTAL_BASE_URL}/login`);
    await parent.getByLabel("Email").fill(guardian.email);
    await parent.getByLabel("Password", { exact: true }).fill(guardian.password);
    await parent.getByRole("button", { name: "Log in" }).click();
    await expect(parent.getByRole("heading", { name: "Your children" })).toBeVisible({ timeout: 60_000 });
    await parent.goto(`${PORTAL_BASE_URL}/students/${guardian.studentId}`);
    await expect(parent.getByRole("heading", { name: "Library books" })).toBeVisible({ timeout: 60_000 });
    await expect(parent.getByText(title)).toBeVisible();
    await expect(parent.getByText(/^Overdue by 3 days/)).toBeVisible();

    // 4. The overdue list shows the fine so far; the desk shows it before taking the book back.
    await page.goto("/library/loans");
    await page.getByRole("button", { name: "Overdue" }).click();
    await expect(page.getByText(/Fine so far ₦150(\.00)? \(estimate\)/)).toBeVisible();
    await page.goto("/library/desk");
    await page.getByLabel("Accession number").fill(accessionNumber);
    await page.getByRole("button", { name: "Find copy" }).click();
    await expect(page.getByText(/Fine if returned today: ₦150(\.00)?\./)).toBeVisible();
    await page.getByRole("button", { name: "Return book" }).click();
    await expect(page.getByText(/₦150(\.00)? added to the family's fees as a library charge\./)).toBeVisible();

    // 5. The fine is a library charge, waiting to be billed.
    await page.goto("/finance/charges");
    await page.locator("#charges-term").selectOption({ index: 1 });
    await page.locator("#charges-class").selectOption({ label: arm.name });
    await expect(page.getByText(`Library fine — ${title}, 3 days late`)).toBeVisible();
    await expect(page.getByText("Waiting to be billed")).toBeVisible();
  } finally {
    await parentContext.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
