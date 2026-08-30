// F-34 — bulk invoice generation must be reviewed before anything is billed.
//
// The asymmetry this closes: after F-01, cancelling ONE invoice requires an
// explicit confirmation naming the student and amount, while creating THIRTY
// required none. These tests are the browser-level half of that guarantee;
// the unit-level half is lib/finance/invoice-generate.spec.ts (state machine)
// and finance-ux-invariants.spec.ts (the mutation cannot be reached from the
// page at all).
//
// Every test seeds its own disposable school through the real API.

import { expect, test, type Page } from "@playwright/test";

import {
  apiCreateClassArm, apiListAcademicYears, apiListClassLevels, apiListTerms,
} from "../fixtures/api.js";
import { apiCreateEnrollment, apiCreateStudent, setupFinanceScaffold } from "../fixtures/finance.js";
import { loginAsAdmin, type AdminSession } from "../fixtures/session.js";
import { uniqueSuffix } from "../fixtures/unique.js";

async function financeArm(admin: AdminSession, suffix: string, opts: { seed?: boolean } = {}) {
  const levels = await apiListClassLevels(admin.api);
  const level = levels[0];
  const years = await apiListAcademicYears(admin.api);
  const terms = await apiListTerms(admin.api, years[0].id);
  const term = terms[0];
  // apiCreateClassArm returns { id } only, so the caller keeps the name it
  // supplied rather than reading one back off the created row.
  const armName = `Gold ${suffix}`;
  const arm = await apiCreateClassArm(admin.api, level.id, {
    name: armName,
    code: `gold-${suffix}`.toLowerCase().slice(0, 12),
  });
  let scaffold = null;
  if (opts.seed !== false) {
    scaffold = await setupFinanceScaffold(admin.api, {
      suffix, termId: term.id, classArmId: arm.id,
      classLevelId: level.id, academicYearId: years[0].id,
    });
  }
  return { level, year: years[0], term, arm, armName, scaffold };
}

/**
 * Drive the page's shared picker to a specific year / term / arm.
 *
 * Selects by VALUE (the id) rather than by visible label: the year option text
 * carries a "(current)" suffix from currentSuffix(), so an exact label match is
 * brittle in a way that has nothing to do with what these tests are proving.
 */
async function selectContext(page: Page, yearId: string, termId: string, armId: string) {
  await page.getByLabel("Academic year").selectOption(yearId);
  await page.getByLabel("Term").selectOption(termId);
  await page.getByLabel("Class").selectOption(armId);
}


/**
 * Click Generate and wait for the review to finish loading.
 *
 * The dialog opens in a `loading` phase while it fetches the preview, so
 * reading its text immediately yields "Working out who would be invoiced…"
 * rather than the numbers under test.
 */
async function openReview(page: Page) {
  await page.getByRole("button", { name: "Generate invoices" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Working out who would be invoiced")).toHaveCount(0, { timeout: 30000 });
}

test.describe("F-34 — bulk invoice generation confirmation", () => {
  test("a single click opens a review and bills nobody", async ({ browser }) => {
    const admin = await loginAsAdmin(browser);
    const suffix = uniqueSuffix();
    const { year, term, arm } = await financeArm(admin, suffix);

    const posts: string[] = [];
    admin.page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/invoices/arm/generate")) posts.push(r.url());
    });

    await admin.page.goto("/finance/invoices", { waitUntil: "domcontentloaded" });
    await selectContext(admin.page, year.id, term.id, arm.id);
    await openReview(admin.page);

    await expect(admin.page.getByRole("heading", { name: /create these invoices/i })).toBeVisible();
    // THE point of the slice: opening the review has billed nothing.
    expect(posts, "opening the review must send no generation request").toEqual([]);

    await admin.context.close();
    await admin.api.dispose();
  });

  test("the review states class, term, student count and naira total from real data", async ({ browser }) => {
    const admin = await loginAsAdmin(browser);
    const suffix = uniqueSuffix();
    const { year, term, arm, armName, scaffold } = await financeArm(admin, suffix);
    const expectedTotal = scaffold!.students.length * scaffold!.feeItemAmount;

    await admin.page.goto("/finance/invoices", { waitUntil: "domcontentloaded" });
    await selectContext(admin.page, year.id, term.id, arm.id);
    await openReview(admin.page);

    const dialog = admin.page.getByRole("dialog");
    const text = await dialog.innerText();
    expect(text).toContain(armName);
    expect(text).toContain(term.name);
    expect(text).toContain(`${scaffold!.students.length} students`);
    // ₦135,000.00 for the 3-student × ₦45,000 scaffold — the real money figure.
    expect(text).toContain((expectedTotal / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 }));

    // Human names, and no raw ids anywhere in the review.
    for (const s of scaffold!.students) {
      expect(text).toContain(`${s.firstName} ${s.lastName}`);
    }
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);

    await admin.context.close();
    await admin.api.dispose();
  });

  test("dismissing sends zero requests and creates nothing", async ({ browser }) => {
    const admin = await loginAsAdmin(browser);
    const suffix = uniqueSuffix();
    const { year, term, arm } = await financeArm(admin, suffix);

    const posts: string[] = [];
    admin.page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/invoices/arm/generate")) posts.push(r.url());
    });

    await admin.page.goto("/finance/invoices", { waitUntil: "domcontentloaded" });
    await selectContext(admin.page, year.id, term.id, arm.id);
    await openReview(admin.page);
    await admin.page.getByRole("button", { name: "Don't create" }).click();
    await expect(admin.page.getByRole("dialog")).toBeHidden();

    expect(posts).toEqual([]);
    // And the database agrees — nothing was billed.
    const list = await (await admin.api.get(`invoices?termId=${term.id}&classArmId=${arm.id}`)).json();
    expect(list.total).toBe(0);

    await admin.context.close();
    await admin.api.dispose();
  });

  test("confirming sends exactly ONE request even under repeated clicks, and reports what was created", async ({ browser }) => {
    const admin = await loginAsAdmin(browser);
    const suffix = uniqueSuffix();
    const { year, term, arm, scaffold } = await financeArm(admin, suffix);

    const posts: string[] = [];
    admin.page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/invoices/arm/generate")) posts.push(r.url());
    });

    await admin.page.goto("/finance/invoices", { waitUntil: "domcontentloaded" });
    await selectContext(admin.page, year.id, term.id, arm.id);
    await openReview(admin.page);

    const confirm = admin.page.getByRole("button", { name: /^Create \d+ invoices?$/ });
    await expect(confirm).toBeVisible();
    // Hammer it. The reducer must collapse this to one logical submission.
    await confirm.click({ clickCount: 3, delay: 20 }).catch(() => {});

    await expect(admin.page.getByText(/Done —/)).toBeVisible({ timeout: 30000 });
    expect(posts, `expected exactly one generation POST, saw ${posts.length}`).toHaveLength(1);

    // Success reports what was actually created, from the server's own numbers.
    await expect(admin.page.getByText(new RegExp(`${scaffold!.students.length} invoices? created`))).toBeVisible();

    const list = await (await admin.api.get(`invoices?termId=${term.id}&classArmId=${arm.id}`)).json();
    expect(list.total).toBe(scaffold!.students.length);

    await admin.context.close();
    await admin.api.dispose();
  });

  test("an arm that is already fully invoiced is not offered as a meaningful run", async ({ browser }) => {
    const admin = await loginAsAdmin(browser);
    const suffix = uniqueSuffix();
    const { year, term, arm, scaffold } = await financeArm(admin, suffix);
    // Bill it via the API so the UI meets an already-done arm.
    await admin.api.post("invoices/arm/generate", { data: { termId: term.id, classArmId: arm.id } });

    const posts: string[] = [];
    admin.page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/invoices/arm/generate")) posts.push(r.url());
    });

    await admin.page.goto("/finance/invoices", { waitUntil: "domcontentloaded" });
    await selectContext(admin.page, year.id, term.id, arm.id);
    await openReview(admin.page);

    const dialog = admin.page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: /nothing to invoice/i })).toBeVisible();
    await expect(dialog.getByText(/already has an invoice|already have an invoice|Every enrolled student already/i)).toBeVisible();
    // No create affordance at all, so a zero-impact run cannot be fired.
    await expect(admin.page.getByRole("button", { name: /^Create \d+ invoices?$/ })).toHaveCount(0);
    // It must also name the skipped students rather than just counting them.
    expect(await dialog.innerText()).toContain(scaffold!.students[0].firstName);

    await dialog.getByRole("button", { name: "Close" }).first().click();
    expect(posts).toEqual([]);

    await admin.context.close();
    await admin.api.dispose();
  });

  test("an arm with no enrolled students says so instead of reporting a successful run", async ({ browser }) => {
    const admin = await loginAsAdmin(browser);
    const suffix = uniqueSuffix();
    // seed:false — an arm with no roster and no fees.
    const { year, term, arm } = await financeArm(admin, suffix, { seed: false });

    await admin.page.goto("/finance/invoices", { waitUntil: "domcontentloaded" });
    await selectContext(admin.page, year.id, term.id, arm.id);
    await openReview(admin.page);

    const dialog = admin.page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: /nothing to invoice/i })).toBeVisible();
    await expect(dialog.getByText(/nobody to bill|No students are enrolled/i)).toBeVisible();
    // Never the green "Done — 0 invoices created" that the old path produced.
    await expect(admin.page.getByText(/Done —/)).toHaveCount(0);

    await admin.context.close();
    await admin.api.dispose();
  });

  test("a one-student arm reads in the singular", async ({ browser }) => {
    const admin = await loginAsAdmin(browser);
    const suffix = uniqueSuffix();
    const { level, year, term } = await financeArm(admin, suffix);
    const solo = await apiCreateClassArm(admin.api, level.id, {
      name: `Solo ${suffix}`, code: `solo-${suffix}`.toLowerCase().slice(0, 12),
    });
    const student = await apiCreateStudent(admin.api, {
      admissionNumber: `SKA/${suffix}/SOLO`,
      firstName: "Chiamaka", lastName: "Okonkwo-Adeyemi",
      dateOfBirth: "2012-05-14T00:00:00.000Z", gender: "FEMALE",
    });
    await apiCreateEnrollment(admin.api, { studentId: student.id, termId: term.id, classArmId: solo.id });

    await admin.page.goto("/finance/invoices", { waitUntil: "domcontentloaded" });
    await selectContext(admin.page, year.id, term.id, solo.id);
    await openReview(admin.page);

    const dialog = admin.page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Create 1 invoice" })).toBeVisible();
    expect(await dialog.innerText()).toContain("1 student ");
    expect(await dialog.innerText()).toContain("Chiamaka Okonkwo-Adeyemi");

    await admin.context.close();
    await admin.api.dispose();
  });

  test("a failed generation stays truthful and can be retried", async ({ browser }) => {
    const admin = await loginAsAdmin(browser);
    const suffix = uniqueSuffix();
    const { year, term, arm } = await financeArm(admin, suffix);

    // Fail only the generation call; the preview must still load.
    let failNext = true;
    await admin.page.route("**/invoices/arm/generate", async (route) => {
      if (failNext) {
        failNext = false;
        await route.fulfill({ status: 500, contentType: "application/json", body: '{"error":{"code":"INTERNAL","message":"boom"}}' });
        return;
      }
      await route.continue();
    });

    await admin.page.goto("/finance/invoices", { waitUntil: "domcontentloaded" });
    await selectContext(admin.page, year.id, term.id, arm.id);
    await openReview(admin.page);
    await admin.page.getByRole("button", { name: /^Create \d+ invoices?$/ }).click();

    // Truthful: an explicit failure, never an optimistic success.
    const alert = admin.page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 30000 });
    await expect(alert).toContainText(/No invoices have been created/i);
    await expect(admin.page.getByText(/Done —/)).toHaveCount(0);
    // Raw error objects must not leak (F-12).
    await expect(alert).not.toContainText(/ApiError|TypeError|\[object/);

    // Retryable: the same button works on the second attempt.
    await admin.page.getByRole("button", { name: /^Create \d+ invoices?$/ }).click();
    await expect(admin.page.getByText(/Done —/)).toBeVisible({ timeout: 30000 });

    await admin.context.close();
    await admin.api.dispose();
  });

  test("the review is usable at a narrow phone width", async ({ browser }) => {
    const admin = await loginAsAdmin(browser);
    const suffix = uniqueSuffix();
    const { year, term, arm } = await financeArm(admin, suffix);

    await admin.page.setViewportSize({ width: 390, height: 844 });
    await admin.page.goto("/finance/invoices", { waitUntil: "domcontentloaded" });
    await selectContext(admin.page, year.id, term.id, arm.id);
    await openReview(admin.page);

    const dialog = admin.page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Both decisions must be reachable, not pushed off-screen.
    await expect(dialog.getByRole("button", { name: /^Create \d+ invoices?$/ })).toBeInViewport();
    await expect(dialog.getByRole("button", { name: "Don't create" })).toBeInViewport();

    // The dialog itself must not exceed the viewport.
    const box = await dialog.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);

    await admin.context.close();
    await admin.api.dispose();
  });
});
