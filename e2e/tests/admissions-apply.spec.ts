import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "../fixtures/index.js";
import { PORTAL_BASE_URL } from "../fixtures/guardian.js";

// Phase 9 / CP7.1 — online admission applications (docs/modules/phase-9.md
// §16, §16.8), in a real browser against a throwaway school: the admin adds a
// question of the school's own and asks for the passport photo; a family
// applies on the portal's public page with a photo; the application waits on
// the Admissions page, apart from students, with the answer and the document.

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

async function ok<T>(res: { ok(): boolean; status(): number; text(): Promise<string>; json(): Promise<unknown> }, label: string): Promise<T> {
  if (!res.ok()) throw new Error(`${label}: ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

test("a family applies online with a photo, and the application waits on the Admissions page", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const admin = await loginAsAdmin(browser);
  const settings = await ok<{ applyPath: string; classLevels: { name: string }[] }>(await admin.api.get("admissions/settings"), "settings");
  const levelName = settings.classLevels[0]!.name;
  const familyContext = await browser.newContext();

  try {
    const page = admin.page;

    // 1. Applications are open by default; the admin asks for a photo and adds a question.
    await page.goto("/settings/admissions");
    await expect(page.getByLabel("Take applications online")).toBeChecked();
    await page.getByLabel("Passport photograph").selectOption("REQUIRED");
    await page.getByRole("button", { name: "Add a question" }).click();
    await page.getByLabel("Question 1", { exact: true }).fill("Boarding or day?");
    await page.getByLabel("Question 1: kind of answer").selectOption("CHOICE");
    await page.getByLabel("Choices, one per line").fill("Boarding\nDay");
    await page.getByRole("button", { name: "Save admissions settings" }).click();
    await expect(page.getByText("Admissions settings saved.")).toBeVisible();

    // 2. A family applies on the public page.
    const family = await familyContext.newPage();
    await family.goto(`${PORTAL_BASE_URL}${settings.applyPath}`);
    const form = family.getByRole("form", { name: "Application form" });
    await expect(form).toBeVisible({ timeout: 60_000 });
    await form.getByLabel("Class applying for").selectOption({ label: levelName });
    await form.getByLabel("First name").first().fill("Chiamaka");
    await form.getByLabel("Surname").first().fill("Obi");
    await form.getByLabel("Date of birth").fill("2015-06-02");
    await form.getByLabel("Gender").selectOption("FEMALE");
    await form.getByLabel("First name").nth(1).fill("Ifeoma");
    await form.getByLabel("Surname").nth(1).fill("Obi");
    await form.getByLabel("Phone").fill("08031112222");
    await form.getByLabel("Email (the school replies here)").fill(`ifeoma-${Date.now()}@example.test`);
    await form.getByLabel("Boarding or day? (optional)").selectOption("Day");
    await form.getByLabel(/Passport photograph/).setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG });
    // Sending without consent is stopped, in words.
    await form.getByRole("button", { name: "Send application" }).click();
    await expect(family.getByText("Tick the consent box to send the application.")).toBeVisible();
    await form.getByRole("checkbox").check();
    await form.getByRole("button", { name: "Send application" }).click();
    await expect(family.getByRole("heading", { name: "Application sent" })).toBeVisible();
    const reference = (await family.getByText(/Your reference is/).locator("strong").textContent())!;
    expect(reference).toMatch(/^APP-\d{4}-\d{4}$/);

    // 3. The school sees it on Admissions, apart from students.
    await page.goto("/admissions");
    await expect(page.getByRole("button", { name: /^New \(1\)/ })).toBeVisible();
    await page.getByText("Chiamaka Obi").click();
    await expect(page.getByRole("heading", { name: "Chiamaka Obi" })).toBeVisible();
    await expect(page.getByText(reference, { exact: false })).toBeVisible();
    await expect(page.getByText("Boarding or day?")).toBeVisible();
    await expect(page.getByText("Day", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Passport photograph" })).toBeVisible();

  } finally {
    await familyContext.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
