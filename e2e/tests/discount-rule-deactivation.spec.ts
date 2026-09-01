// Discount-rule deactivation — the Fee Catalog → Discount Rules → Deactivate path.
//
// This path had been reviewed at the code level but never clicked through in a
// real browser. These tests are that click-through, and they assert three
// separate things, because "it works" is three different claims here:
//
//   1. CONFIRMATION. Deactivating a discount rule is money-adjacent and not
//      undoable from the UI (the rule cannot be reactivated — see D below), so
//      it must be confirmed first. This is the same guarantee F-01 established
//      for invoice cancellation and F-34 for bulk generation; the discounts
//      table was the one destructive finance action still wired straight from
//      a row button to the mutation.
//
//   2. THE DEACTIVATION ITSELF. The row flips to Inactive and the server
//      agrees — it is a soft deactivate (`active = false`), never a row
//      delete, so invoice history stays reconstructable.
//
//   3. DEPENDENT STATE, which is the subtle one and the reason this needs a
//      real invoice rather than a unit test. Invoices are snapshot-on-issue:
//      an invoice ALREADY issued with the discount must keep its discounted
//      total forever, while the NEXT invoice issued must be at full price
//      because `fetchDiscountRules` filters on `active: true`. Those two
//      facts pull in opposite directions and only a live round-trip through
//      generation proves both hold at once.
//
// D — "Deactivate", not "Delete": there is no delete endpoint and no
// reactivate endpoint. DELETE /discount-rules/:id sets `active = false` and
// writes an audit row. The correct way to undo is to create a new rule, which
// is exactly why the confirmation matters.
//
// Every test seeds its own disposable school through the real API against the
// local docker Postgres.

import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  apiCreateClassArm,
  apiListAcademicYears,
  apiListClassLevels,
  apiListTerms,
} from "../fixtures/api.js";
import {
  apiCreateEnrollment,
  apiCreateFeeCategory,
  apiCreateFeeItem,
  apiCreateStudent,
} from "../fixtures/finance.js";
import { loginAsAdmin, type AdminSession } from "../fixtures/session.js";
import { uniqueSuffix } from "../fixtures/unique.js";

const TUITION_KOBO = 50_000_00; // ₦50,000.00

interface Scene {
  studentId: string;
  studentName: string;
  admissionNumber: string;
  feeItemId: string;
  termId: string;
  secondTermId: string;
  academicYearId: string;
  classArmId: string;
  classLevelId: string;
}

/**
 * One student, enrolled in one arm, with one term-scoped fee item.
 *
 * Deliberately does NOT use setupFinanceScaffold: that helper seeds three
 * students and discards the fee-item id, and both of those matter here — the
 * discount rule is per-student and must target a known fee item.
 */
async function setupScene(admin: AdminSession, suffix: string): Promise<Scene> {
  const levels = await apiListClassLevels(admin.api);
  const level = levels[0];
  const years = await apiListAcademicYears(admin.api);
  const year = years[0];
  const terms = await apiListTerms(admin.api, year.id);
  const term = terms[0];
  // A second term in the same year gives us somewhere to issue the
  // "after deactivation" invoice without colliding with the first one.
  const secondTerm = terms[1] ?? terms[0];

  const arm = await apiCreateClassArm(admin.api, level.id, {
    name: `Disc ${suffix}`,
    code: `disc-${suffix}`.toLowerCase().slice(0, 12),
  });

  const firstName = "Adaeze";
  const lastName = "Okonkwo";
  const admissionNumber = `SKA/${suffix}/0001`;
  const student = await apiCreateStudent(admin.api, {
    admissionNumber,
    firstName,
    lastName,
    dateOfBirth: "2012-05-14T00:00:00.000Z",
    gender: "FEMALE",
  });
  await apiCreateEnrollment(admin.api, {
    studentId: student.id,
    termId: term.id,
    classArmId: arm.id,
  });
  await apiCreateEnrollment(admin.api, {
    studentId: student.id,
    termId: secondTerm.id,
    classArmId: arm.id,
  });

  const category = await apiCreateFeeCategory(admin.api, { name: `Tuition ${suffix}` });
  const feeItem = await apiCreateFeeItem(admin.api, {
    categoryId: category.id,
    name: "Term tuition",
    amount: TUITION_KOBO,
    classLevelId: level.id,
    termId: term.id,
    academicYearId: year.id,
  });
  // The same fee, scoped to the second term, so the post-deactivation invoice
  // bills a comparable amount rather than nothing.
  await apiCreateFeeItem(admin.api, {
    categoryId: category.id,
    name: "Term tuition",
    amount: TUITION_KOBO,
    classLevelId: level.id,
    termId: secondTerm.id,
    academicYearId: year.id,
  });

  return {
    studentId: student.id,
    studentName: `${firstName} ${lastName}`,
    admissionNumber,
    feeItemId: feeItem.id,
    termId: term.id,
    secondTermId: secondTerm.id,
    academicYearId: year.id,
    classArmId: arm.id,
    classLevelId: level.id,
  };
}

async function createHalfPriceRule(
  api: APIRequestContext,
  scene: Scene,
  name: string,
): Promise<{ id: string }> {
  const res = await api.post("discount-rules", {
    data: {
      studentId: scene.studentId,
      name,
      feeItemId: scene.feeItemId,
      duration: "LIFETIME",
      discountType: "PERCENTAGE",
      value: 5000, // 50.00% in basis points
    },
  });
  if (!res.ok()) {
    throw new Error(`createDiscountRule failed: ${res.status()} — ${await res.text()}`);
  }
  return (await res.json()) as { id: string };
}

async function generateInvoices(
  api: APIRequestContext,
  scene: Scene,
  termId: string,
): Promise<void> {
  const res = await api.post("invoices/arm/generate", {
    data: { classArmId: scene.classArmId, termId },
  });
  if (!res.ok()) {
    throw new Error(`generateInvoices failed: ${res.status()} — ${await res.text()}`);
  }
}

async function invoiceTotalFor(
  api: APIRequestContext,
  scene: Scene,
  termId: string,
): Promise<number> {
  const res = await api.get(`invoices?termId=${termId}&classArmId=${scene.classArmId}`);
  const body = (await res.json()) as { data: Array<{ studentId: string; totalDue: number }> };
  const mine = body.data.find((row) => row.studentId === scene.studentId);
  if (!mine) throw new Error(`no invoice found for student in term ${termId}`);
  return mine.totalDue;
}

/**
 * Open the discounts page and select the student whose rules we care about.
 *
 * The rules table is student-scoped — it renders nothing until a student is
 * picked — so every browser assertion below has to go through here first.
 * Selected by id rather than by label because the option text is
 * "Lastname, Firstname (admission)" and reconstructing that in the test would
 * be asserting the page's formatting, not its behaviour.
 */
async function openRulesFor(admin: AdminSession, scene: Scene): Promise<void> {
  await admin.page.goto("/finance/discounts", { waitUntil: "domcontentloaded" });
  await admin.page.getByLabel("Student").selectOption(scene.studentId);
}

async function readRuleActive(api: APIRequestContext, ruleId: string): Promise<boolean> {
  const res = await api.get("discount-rules?includeInactive=true");
  const rules = (await res.json()) as Array<{ id: string; active: boolean }>;
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) throw new Error(`rule ${ruleId} not found`);
  return rule.active;
}

test.describe("discount rule deactivation", () => {
  test("asks for confirmation, and deactivates nothing until it is given", async ({ browser }) => {
    const admin = await loginAsAdmin(browser);
    const suffix = uniqueSuffix();
    const scene = await setupScene(admin, suffix);
    const ruleName = `Staff child ${suffix}`;
    const rule = await createHalfPriceRule(admin.api, scene, ruleName);

    await openRulesFor(admin, scene);
    await expect(admin.page.getByRole("cell", { name: ruleName, exact: true })).toBeVisible();

    // The dismiss path: opening the confirmation and backing out must leave
    // the rule exactly as it was. This is the assertion that a straight-to-
    // mutation row button cannot satisfy — by the time the dialog would be
    // dismissed, the rule is already gone.
    await admin.page.getByRole("button", { name: `Deactivate ${ruleName}` }).click();
    const dialog = admin.page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(ruleName);

    await dialog.getByRole("button", { name: "Keep discount" }).click();
    await expect(dialog).toHaveCount(0);

    expect(await readRuleActive(admin.api, rule.id)).toBe(true);
    await expect(admin.page.getByRole("cell", { name: "Active" })).toBeVisible();

    await admin.context.close();
    await admin.api.dispose();
  });

  test("deactivates on confirmation, and the server agrees", async ({ browser }) => {
    const admin = await loginAsAdmin(browser);
    const suffix = uniqueSuffix();
    const scene = await setupScene(admin, suffix);
    const ruleName = `Bursary ${suffix}`;
    const rule = await createHalfPriceRule(admin.api, scene, ruleName);

    await openRulesFor(admin, scene);
    await admin.page.getByRole("button", { name: `Deactivate ${ruleName}` }).click();
    await admin.page.getByRole("dialog").getByRole("button", { name: "Deactivate discount" }).click();

    // The row is still listed — a deactivated rule is retained, not removed,
    // so the audit trail and past invoices stay explicable.
    await expect(admin.page.getByRole("cell", { name: "Inactive" })).toBeVisible();
    await expect(admin.page.getByRole("cell", { name: ruleName, exact: true })).toBeVisible();
    // And the action is gone: there is nothing left to deactivate.
    await expect(
      admin.page.getByRole("button", { name: `Deactivate ${ruleName}` }),
    ).toHaveCount(0);

    expect(await readRuleActive(admin.api, rule.id)).toBe(false);

    await admin.context.close();
    await admin.api.dispose();
  });

  test("leaves already-issued invoices alone but stops discounting new ones", async ({ browser }) => {
    const admin = await loginAsAdmin(browser);
    const suffix = uniqueSuffix();
    const scene = await setupScene(admin, suffix);
    const ruleName = `Sibling ${suffix}`;
    await createHalfPriceRule(admin.api, scene, ruleName);

    // Issued WHILE the rule is live: half of ₦50,000.
    await generateInvoices(admin.api, scene, scene.termId);
    const discountedTotal = await invoiceTotalFor(admin.api, scene, scene.termId);
    expect(discountedTotal).toBe(TUITION_KOBO / 2);

    // Deactivate through the browser, the same way a bursar would.
    await openRulesFor(admin, scene);
    await admin.page.getByRole("button", { name: `Deactivate ${ruleName}` }).click();
    await admin.page.getByRole("dialog").getByRole("button", { name: "Deactivate discount" }).click();
    await expect(admin.page.getByRole("cell", { name: "Inactive" })).toBeVisible();

    // The already-issued invoice is a snapshot and must not have moved.
    expect(await invoiceTotalFor(admin.api, scene, scene.termId)).toBe(discountedTotal);

    // The next invoice is at full price, because generation filters on
    // `active: true`. Skipped if this school has only one term.
    test.skip(scene.secondTermId === scene.termId, "school has a single term");
    await generateInvoices(admin.api, scene, scene.secondTermId);
    expect(await invoiceTotalFor(admin.api, scene, scene.secondTermId)).toBe(TUITION_KOBO);

    await admin.context.close();
    await admin.api.dispose();
  });
});
