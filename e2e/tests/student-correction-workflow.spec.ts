import { expect, test, type Browser } from "@playwright/test";
import { basePrisma } from "@school-kit/db";
import { loginAsAdmin, uniqueSuffix } from "../fixtures/index.js";
async function setup(browser: Browser, enabled = true) {
  const admin = await loginAsAdmin(browser); const suffix = uniqueSuffix(); const number = `FIX-${suffix}`;
  const response = await admin.api.post("students", { data: { admissionNumber: number, firstName: "Ada", middleName: "Mid", lastName: "Example", dateOfBirth: "2012-05-04", gender: "FEMALE", email: `original-${suffix}@school-kit.test` } }); expect(response.ok()).toBe(true);
  const student = await response.json() as { id: string };
  if (enabled) await basePrisma.school.update({ where: { id: admin.schoolId }, data: { featureSwitches: { "student-corrections": true } } });
  await admin.page.goto("/students/corrections");
  await expect(admin.page.getByRole("heading", { name: "Correct student records together." })).toBeVisible();
  if (enabled) {
    await admin.page.getByLabel("Find existing students").fill(number); await admin.page.getByRole("button", { name: "Search roster", exact: true }).click();
    await admin.page.getByRole("button", { name: "Add Ada Example", exact: true }).click();
  }
  return { admin, page: admin.page, student, number };
}
async function confirm(page: import("@playwright/test").Page) {
  await page.getByRole("checkbox", { name: /I checked each student/ }).check(); await page.getByRole("button", { name: "Confirm and apply corrections" }).click();
}

test("corrections preview names before/after values and explicit clears before any write", async ({ browser }, testInfo) => {
  const { admin, page, student, number } = await setup(browser);
  try {
    let writes = 0; page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/confirm")) writes++; });
    await page.getByLabel(`First name for ${number}`, { exact: true }).fill("Adaeze");
    await page.getByRole("checkbox", { name: `Clear email for ${number}`, exact: true }).check();
    await page.getByRole("button", { name: "Review record changes" }).click();
    const dialog = page.getByRole("dialog"); await expect(dialog.getByRole("heading", { name: "Review student corrections" })).toBeVisible();
    await expect(dialog.getByRole("cell", { name: "Ada", exact: true })).toBeVisible(); await expect(dialog.getByRole("cell", { name: "Adaeze", exact: true })).toBeVisible();
    await expect(dialog.getByRole("cell", { name: "Will be cleared", exact: true })).toBeVisible(); expect(writes).toBe(0);
    await expect(dialog.getByRole("button", { name: "Confirm and apply corrections" })).toBeDisabled();
    expect((await (await admin.api.get(`students/${student.id}`)).json()).firstName).toBe("Ada");
    await testInfo.attach("student-correction-review", { body: await page.screenshot(), contentType: "image/png" });
    await dialog.getByRole("button", { name: "Back to editing" }).click();
    await expect(page.getByLabel(`First name for ${number}`, { exact: true })).toHaveValue("Adaeze");
    await page.getByRole("button", { name: "Review record changes" }).click(); await confirm(page);
    await expect(page.getByRole("heading", { name: "Student corrections applied" })).toBeVisible(); expect(writes).toBe(1);
    const saved = await (await admin.api.get(`students/${student.id}`)).json(); expect(saved.firstName).toBe("Adaeze"); expect(saved.email).toBeNull(); expect(saved.middleName).toBe("Mid"); expect(saved.admissionNumber).toBe(number);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("a changed student refuses confirmation and requires a fresh before/after review", async ({ browser }) => {
  const { admin, page, student, number } = await setup(browser);
  try {
    await page.getByLabel(`First name for ${number}`, { exact: true }).fill("Adaeze"); await page.getByRole("button", { name: "Review record changes" }).click();
    await expect(page.getByRole("dialog").getByRole("checkbox", { name: /I checked each student/ })).toBeVisible();
    expect((await admin.api.patch(`students/${student.id}`, { data: { firstName: "Changed elsewhere" } })).ok()).toBe(true);
    await confirm(page); await page.getByRole("button", { name: "Refresh correction review" }).click();
    await expect(page.getByRole("cell", { name: "Changed elsewhere", exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /I checked each student/ })).not.toBeChecked();
    expect((await (await admin.api.get(`students/${student.id}`)).json()).firstName).toBe("Changed elsewhere");
    await confirm(page); await expect(page.getByRole("heading", { name: "Student corrections applied" })).toBeVisible();
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("a lost correction response recovers the same outcome and survives reload with the switch off", async ({ browser }) => {
  const { admin, page, student, number } = await setup(browser);
  try {
    let prepares = 0, confirms = 0;
    page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/student-corrections/proposals")) prepares++; });
    await page.route("**/student-corrections/proposals/*/confirm", async (route) => { confirms++; const r = await route.fetch(); expect(r.ok()).toBe(true); await route.abort("failed"); });
    await page.getByLabel(`First name for ${number}`, { exact: true }).fill("Corrected"); await page.getByRole("button", { name: "Review record changes" }).click(); await confirm(page);
    await expect(page.getByRole("heading", { name: "Student corrections applied" })).toBeVisible();
    expect(prepares).toBe(1); expect(confirms).toBe(1);
    await expect(page).toHaveURL(/review=[0-9a-f-]+/);
    await basePrisma.school.update({ where: { id: admin.schoolId }, data: { featureSwitches: {} } });
    await page.reload(); await expect(page.getByRole("heading", { name: "Student corrections applied" })).toBeVisible();
    expect(prepares).toBe(1); expect((await (await admin.api.get(`students/${student.id}`)).json()).firstName).toBe("Corrected");
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("optional blanks need explicit clearing and the review fits a phone", async ({ browser }, testInfo) => {
  const { admin, page, number } = await setup(browser);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel(`Email for ${number}`, { exact: true }).fill(""); await page.getByRole("button", { name: "Review record changes" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Tick Clear email" })).toBeVisible(); await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("checkbox", { name: `Clear email for ${number}`, exact: true }).check(); await page.getByRole("button", { name: "Review record changes" }).click();
    await expect(page.getByRole("dialog")).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await testInfo.attach("student-correction-phone", { body: await page.screenshot(), contentType: "image/png" });
    await page.getByRole("button", { name: "Back to editing" }).click(); await page.reload(); await expect(page.getByRole("region", { name: "Correction editor" })).toHaveCount(0);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("disabled batch corrections never fall back to unreviewed PATCH writes", async ({ browser }) => {
  const { admin, page } = await setup(browser, false);
  try { await expect(page.getByText(/Reviewed batch corrections are not enabled/)).toBeVisible(); await expect(page.getByRole("button", { name: "Review record changes" })).toHaveCount(0); }
  finally { await admin.context.close(); await admin.api.dispose(); }
});

test("a future date blocks a whole two-student batch until corrected", async ({ browser }) => {
  const { admin, page, student, number } = await setup(browser);
  try {
    const secondNumber = `${number}-2`;
    const created = await admin.api.post("students", { data: { admissionNumber: secondNumber, firstName: "Bello", lastName: "Example", dateOfBirth: "2012-05-04", gender: "MALE" } }); expect(created.ok()).toBe(true);
    await page.getByRole("button", { name: "Search roster", exact: true }).click(); await page.getByRole("button", { name: "Add Bello Example", exact: true }).click();
    await page.getByLabel(`First name for ${number}`, { exact: true }).fill("Adaeze");
    await page.getByLabel(`Date of birth for ${secondNumber}`, { exact: true }).fill("2099-01-01");
    await page.getByRole("button", { name: "Review record changes" }).click();
    await expect(page.getByRole("button", { name: "Confirm and apply corrections" })).toBeDisabled();
    expect((await (await admin.api.get(`students/${student.id}`)).json()).firstName).toBe("Ada");
    await page.getByRole("button", { name: "Back to editing" }).click();
    await page.getByLabel(`Date of birth for ${secondNumber}`, { exact: true }).fill("2013-05-04");
    await page.getByRole("button", { name: "Review record changes" }).click(); await confirm(page);
    await expect(page.getByRole("status").filter({ hasText: "Updated 2 students." })).toBeVisible();
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("frontend correction editor also requires an owner or admin role", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  try {
    // Frontend visibility only. The real API token is unchanged; backend
    // authorization is verified by the backend's real-Postgres suite.
    await admin.page.route("**/auth/me", async (route) => { const response = await route.fetch(); const me = await response.json(); await route.fulfill({ json: { ...me, permissions: ["student.read", "student.update"], roles: me.roles.map((r: { key: string }) => ({ ...r, key: "bursar" })) } }); });
    await admin.page.goto("/students/corrections"); await expect(admin.page.getByRole("alert")).toContainText("not available for this account");
    await expect(admin.page.getByRole("button", { name: "Review record changes" })).toHaveCount(0);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});
