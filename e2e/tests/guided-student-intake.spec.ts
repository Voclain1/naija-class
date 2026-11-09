import { basePrisma } from "@school-kit/db";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";

async function setup(browser: Browser, automatic = false, guided = true, reviewed = false) {
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api, { arms: [{ name: "Guided Intake A", code: "guided-intake-a" }] });
  if (automatic) {
    const res = await admin.api.patch("schools/me/admission-numbers", { data: { mode: "AUTO", format: "GI/{NNNNN}", order: "SCHOOL" } });
    expect(res.ok()).toBe(true);
  }
  if (reviewed) await basePrisma.school.update({ where: { id: admin.schoolId }, data: { featureSwitches: { "student-intake": true } } });
  await admin.page.goto(guided ? "/students/intake" : "/students/new/bulk");
  if (guided) await admin.page.getByRole("button", { name: "Start guided class list" }).click();
  await expect(admin.page.getByText(automatic ? /Admission numbers: automatic/ : "Admission numbers: typed by you")).toBeVisible();
  return { admin, page: admin.page, structure };
}
async function row(page: Page, index: number, admission = `GI-${uniqueSuffix()}`) {
  await page.locator(`[data-cell="${index}:0"]`).fill(admission);
  await page.locator(`[data-cell="${index}:1"]`).fill(`Guided${index}`);
  await page.locator(`[data-cell="${index}:3"]`).fill("Example");
  await page.locator(`[data-cell="${index}:4"]`).fill("2012-05-04");
  await page.locator(`[data-cell="${index}:5"]`).selectOption("MALE");
}
async function confirm(page: Page) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: "I checked these students and their placement." }).check();
  await dialog.getByRole("button", { name: /Confirm and save/ }).click();
}

// This checks the frontend visibility gate only. The API token is not altered;
// existing backend permission tests remain the authorization evidence.
test("frontend intake controls are hidden when student.create is absent", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  try {
    await admin.page.route("**/auth/me", async (route) => {
      const response = await route.fetch();
      const me = await response.json();
      await route.fulfill({ json: { ...me, permissions: ["student.read"], roles: me.roles.map((r: { key: string }) => ({ ...r, key: "bursar" })) } });
    });
    await admin.page.goto("/students/intake");
    await expect(admin.page.getByRole("heading", { name: "Student intake is not available for this account" })).toBeVisible();
    await expect(admin.page.getByRole("button", { name: "Start guided class list" })).toHaveCount(0);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("guided intake reviews without writing, allows editing, then creates and enrolls the reviewed rows", async ({ browser }, testInfo) => {
  const { admin, page, structure } = await setup(browser);
  try {
    let posts = 0;
    page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/students/bulk")) posts++; });
    await row(page, 0); await row(page, 1);
    await page.getByRole("combobox", { name: "Class", exact: true }).selectOption(structure.arms[0]!.id);
    const term = page.getByRole("combobox", { name: "Term", exact: true });
    await expect(term).toHaveValue("");
    await page.getByRole("button", { name: "Review students", exact: true }).click();
    await expect(page.getByText("Choose the term for this class before reviewing.")).toBeVisible();
    expect(posts).toBe(0);
    await term.selectOption(structure.termId);
    await page.getByRole("button", { name: "Review students", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Review students before saving" })).toBeVisible();
    await expect(dialog.getByText("Guided0 Example", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/Guided Intake A/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Confirm and save/ })).toBeDisabled();
    expect(posts).toBe(0);
    await dialog.getByRole("button", { name: "Back to editing" }).click();
    await page.locator('[data-cell="0:1"]').fill("Corrected");
    await page.getByRole("button", { name: "Review students", exact: true }).click();
    await expect(dialog.getByText("Corrected Example", { exact: true })).toBeVisible();
    await testInfo.attach("intake-review", { body: await page.screenshot(), contentType: "image/png" });
    await confirm(page);
    await expect(page.getByText("All 2 students created.", { exact: true })).toBeVisible();
    expect(posts).toBe(1);
    await expect(page.getByText("Next: link parents and check class placement")).toBeVisible();
    const enrolled = await admin.api.get(`enrollments?termId=${structure.termId}`);
    const body = await enrolled.json() as { data: { classArmId: string }[] };
    expect(body.data).toHaveLength(2);
    expect(body.data.every((r) => r.classArmId === structure.arms[0]!.id)).toBe(true);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("guided intake refuses duplicates before review and explicitly warns about deferred placement", async ({ browser }) => {
  const { admin, page } = await setup(browser);
  try {
    const admission = `SAME-${uniqueSuffix()}`;
    await row(page, 0, admission); await row(page, 1, admission);
    await page.getByRole("combobox", { name: "Class", exact: true }).selectOption("__later__");
    await page.getByRole("button", { name: "Review students", exact: true }).click();
    await expect(page.getByText(/admission number is repeated/)).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator('[data-cell="1:0"]').fill(`OTHER-${uniqueSuffix()}`);
    await page.getByRole("button", { name: "Review students", exact: true }).click();
    await expect(page.getByRole("dialog").getByText(/No class placement/)).toBeVisible();
    await confirm(page);
    await expect(page.getByText("All 2 students created.", { exact: true })).toBeVisible();
    await expect(page.getByText(/They are not in a class yet/)).toBeVisible();
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

for (const guided of [true, false]) test(`a lost automatic-number save response disables retry (${guided ? "guided" : "direct"} grid)`, async ({ browser }) => {
  const { admin, page, structure } = await setup(browser, true, guided);
  try {
    await row(page, 0, "");
    await page.getByRole("combobox", { name: "Class", exact: true }).selectOption(structure.arms[0]!.id);
    await page.getByRole("combobox", { name: "Term", exact: true }).selectOption(structure.termId);
    let posts = 0;
    await page.route("**/students/bulk", async (route) => {
      posts++;
      const saved = await route.fetch(); expect(saved.ok()).toBe(true);
      await route.abort("failed");
    });
    await page.getByRole("button", { name: guided ? "Review students" : "Create students", exact: true }).click();
    if (guided) await confirm(page);
    await expect(page.getByRole("alert").getByText("Check the roster before saving again", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: guided ? "Review students" : "Create students", exact: true })).toBeDisabled();
    expect(posts).toBe(1);
    const response = await admin.api.get("students");
    expect((await response.json()).data).toHaveLength(1);
    await expect(page.getByText(/Nothing in this batch was added/)).toHaveCount(0);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("intake entry and review fit a phone and leave no browser draft", async ({ browser }, testInfo) => {
  const { admin, page } = await setup(browser);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await row(page, 0);
    await page.getByRole("combobox", { name: "Class", exact: true }).selectOption("__later__");
    await page.getByRole("button", { name: "Review students", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await testInfo.attach("intake-review-phone", { body: await page.screenshot(), contentType: "image/png" });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: "Start guided class list" }).click();
    await expect(page.locator('[data-cell="0:1"]')).toHaveValue("");
  } finally { await admin.context.close(); await admin.api.dispose(); }
});


test("server-reviewed intake recovers a lost confirm through the original proposal even with the feature off", async ({ browser }) => {
  const { admin, page, structure } = await setup(browser, true, true, true);
  try {
    await row(page, 0, "");
    await page.getByRole("combobox", { name: "Class", exact: true }).selectOption(structure.arms[0]!.id);
    await page.getByRole("combobox", { name: "Term", exact: true }).selectOption(structure.termId);
    let prepares = 0, confirms = 0, reads = 0;
    page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/student-intake/proposals")) prepares++; });
    await page.route("**/student-intake/proposals/*/confirm", async (route) => {
      confirms++; const response = await route.fetch(); expect(response.ok()).toBe(true);
      await basePrisma.school.update({ where: { id: admin.schoolId }, data: { featureSwitches: {} } });
      await route.abort("failed");
    });
    await page.route(/\/student-intake\/proposals\/[^/]+$/, async (route) => {
      if (route.request().method() !== "GET") { await route.continue(); return; }
      reads++; if (reads === 1) await route.abort("failed"); else await route.continue();
    });
    await page.getByRole("button", { name: "Review students", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Assigned when you confirm", { exact: true })).toBeVisible();
    await confirm(page);
    await expect(dialog.getByRole("button", { name: "Check save outcome" })).toBeVisible();
    await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Check save outcome" }).click();
    await expect(page.getByText("All 1 student created.", { exact: true })).toBeVisible();
    expect(prepares).toBe(1); expect(confirms).toBe(1);
    expect((await (await admin.api.get("students")).json()).data).toHaveLength(1);
    expect((await (await admin.api.get(`enrollments?termId=${structure.termId}`)).json()).data).toHaveLength(1);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("server preview exposes duplicate warnings and blocks taken admission numbers before confirmation", async ({ browser }) => {
  const { admin, page } = await setup(browser, false, true, true);
  try {
    const number = `TAKEN-${uniqueSuffix()}`;
    expect((await admin.api.post("students", { data: { admissionNumber: number, firstName: "Guided0", lastName: "Example", dateOfBirth: "2012-05-04", gender: "MALE" } })).ok()).toBe(true);
    await row(page, 0, number);
    await page.getByRole("combobox", { name: "Class", exact: true }).selectOption("__later__");
    await page.getByRole("button", { name: "Review students", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: /Confirm and save/ })).toBeDisabled();
    await expect(dialog.getByText("A student of this school already has this admission number.", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/same first name, last name and date of birth/i)).toBeVisible();
    await dialog.getByRole("button", { name: "Back to editing" }).click();
    await page.locator('[data-cell="0:0"]').fill(`NEW-${uniqueSuffix()}`);
    await page.getByRole("button", { name: "Review students", exact: true }).click();
    await expect(dialog.getByRole("checkbox")).not.toBeChecked();
    await confirm(page); await expect(page.getByText("All 1 student created.", { exact: true })).toBeVisible();
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("a changed numbering policy requires refresh and a new human confirmation", async ({ browser }) => {
  const { admin, page, structure } = await setup(browser, true, true, true);
  try {
    await row(page, 0, "");
    await page.getByRole("combobox", { name: "Class", exact: true }).selectOption(structure.arms[0]!.id);
    await page.getByRole("combobox", { name: "Term", exact: true }).selectOption(structure.termId);
    await page.getByRole("button", { name: "Review students", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("checkbox")).toBeVisible();
    expect((await admin.api.patch("schools/me/admission-numbers", { data: { mode: "AUTO", format: "REFRESH/{NNNNN}", order: "SCHOOL" } })).ok()).toBe(true);
    await confirm(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Refresh preview" })).toBeVisible();
    expect((await (await admin.api.get("students")).json()).data).toHaveLength(0);
    await dialog.getByRole("button", { name: "Refresh preview" }).click();
    await expect(dialog.getByRole("checkbox")).not.toBeChecked();
    await expect(dialog.getByRole("button", { name: /Confirm and save/ })).toBeDisabled();
    await confirm(page); await expect(page.getByText("All 1 student created.", { exact: true })).toBeVisible();
    expect((await (await admin.api.get("students")).json()).data[0].admissionNumber).toMatch(/^REFRESH\//);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("a lost prepare retries the same client request instead of making another batch", async ({ browser }) => {
  const { admin, page } = await setup(browser, false, true, true);
  try {
    await row(page, 0); await page.getByRole("combobox", { name: "Class", exact: true }).selectOption("__later__");
    const requestIds: string[] = [];
    await page.route("**/student-intake/proposals", async (route) => {
      requestIds.push(route.request().postDataJSON().clientRequestId);
      if (requestIds.length === 1) { const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort("failed"); }
      else await route.continue();
    });
    await page.getByRole("button", { name: "Review students", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Retry preview" }).click();
    await expect(page.getByRole("dialog").getByRole("checkbox")).toBeVisible();
    expect(requestIds).toHaveLength(2); expect(requestIds[0]).toBe(requestIds[1]);
    await confirm(page); await expect(page.getByText("All 1 student created.", { exact: true })).toBeVisible();
  } finally { await admin.context.close(); await admin.api.dispose(); }
});
