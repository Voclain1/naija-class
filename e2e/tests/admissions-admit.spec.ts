import { createHmac } from "node:crypto";

import { expect, test } from "@playwright/test";

import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";
import { PORTAL_BASE_URL } from "../fixtures/guardian.js";

// Phase 9 / CP7.2 — from application to student (docs/modules/phase-9.md
// §16.8), in a real browser against a throwaway school: a family applies with
// a photo; the admin books an entrance exam and offers a place with its
// letter; the family reads the letter in full on the tracking page and
// accepts; the admin admits the child into a class; the student exists with
// the parent as primary guardian and the photo under admission documents.

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

async function ok<T>(res: { ok(): boolean; status(): number; text(): Promise<string>; json(): Promise<unknown> }, label: string): Promise<T> {
  if (!res.ok()) throw new Error(`${label}: ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

/** The family's tracking link is derived from the application id under the API's key (admission-tracking.ts). */
function trackingToken(applicationId: string): string {
  const key = process.env.RESULT_PIN_HMAC_KEY?.trim() || "school-kit-dev-result-pin-key-not-for-production";
  return createHmac("sha256", key).update(`admission-tracking:v1:${applicationId}`).digest("base64url");
}

/** YYYY-MM-DD in Lagos, `days` from today. */
function lagosDay(days: number): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test("an application becomes a student: exam, offer, the family accepts, the admin admits", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 2 Gold", code: `jss2g-${suffix}`.slice(0, 20) }],
    subjectCode: `math-${suffix}`.slice(0, 20),
  });
  const settings = await ok<{ applyPath: string }>(await admin.api.get("admissions/settings"), "settings");
  const slug = settings.applyPath.split("/").pop()!;
  const parentEmail = `kelechi-${suffix}@example.test`;
  const familyContext = await browser.newContext();

  try {
    // 1. A family applies (through the public endpoint the form uses), with a photo.
    const sent = await ok<{ reference: string }>(
      await admin.api.post(`apply/${slug}`, {
        multipart: {
          data: JSON.stringify({
            classLevelId: structure.classLevelId,
            child: { firstName: "Obinna", lastName: `Nwosu${suffix}`.slice(0, 40), dateOfBirth: "2013-02-11", gender: "MALE" },
            guardian: { firstName: "Kelechi", lastName: "Nwosu", relationship: "FATHER", phone: "08035556666", email: parentEmail },
            answers: {},
            consent: true,
          }),
          photo: { name: "photo.png", mimeType: "image/png", buffer: PNG },
        },
      }),
      "apply",
    );
    const list = await ok<{ items: { id: string; reference: string }[] }>(await admin.api.get("admissions/applications?status=SUBMITTED"), "list");
    const applicationId = list.items.find((i) => i.reference === sent.reference)!.id;

    // 2. The admin books the entrance exam and offers a place with its letter.
    const page = admin.page;
    await page.goto(`/admissions/${applicationId}`);
    await expect(page.getByRole("heading", { name: /^Obinna Nwosu/ })).toBeVisible();
    await page.getByRole("button", { name: "Book an assessment" }).click();
    await page.getByLabel("Kind").selectOption("ENTRANCE_EXAM");
    await page.getByLabel("Date").fill(lagosDay(3));
    await page.getByLabel("Time").fill("09:30");
    await page.getByLabel("Note for the family (optional)").fill("Come to the main hall with a pencil.");
    await page.getByRole("button", { name: "Book and tell the family" }).click();
    await expect(page.getByText(/Entrance exam:/)).toBeVisible();
    await expect(page.getByText("Under review", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Offer a place" }).click();
    await page.getByLabel("Offer letter").fill("Tuition: ₦180,000 a term.\nUniform and books: ₦45,000.\nResumption: 12 January. Accept within two weeks.");
    await page.getByRole("button", { name: "Send the offer" }).click();
    await expect(page.getByText("Offered", { exact: true })).toBeVisible();

    // 3. The family reads the letter in full on the tracking page and accepts.
    const family = await familyContext.newPage();
    await family.goto(`${PORTAL_BASE_URL}/apply/${slug}/track/${trackingToken(applicationId)}`);
    await expect(family.getByText("The school has offered a place.")).toBeVisible({ timeout: 60_000 });
    await expect(family.getByText("Entrance exam")).toBeVisible();
    await expect(family.getByText(/Uniform and books: ₦45,000\./)).toBeVisible();
    const accept = family.getByRole("button", { name: "Accept the offer" });
    await expect(accept).toBeDisabled();
    await family.getByLabel("I have read the full offer letter above.").check();
    await accept.click();
    await expect(family.getByText(/You have accepted the offer/)).toBeVisible();

    // 4. The admin admits the child into a class.
    await page.reload();
    await expect(page.getByText(/recorded by The family, online/)).toBeVisible();
    await expect(page.getByText(/Kelechi Nwosu will be added as a new guardian/)).toBeVisible();
    await page.getByLabel("Class").selectOption({ label: `JSS 2 — JSS 2 Gold` });
    const term = page.getByLabel("Term");
    if ((await term.inputValue()) === "") await term.selectOption({ index: 1 });
    await page.getByLabel("Admission number").fill(`ADM-${suffix}`.slice(0, 40));
    await page.getByRole("button", { name: "Admit and enrol" }).click();
    await expect(page.getByText(/Admitted on .* as Obinna Nwosu/)).toBeVisible();

    // 5. The student exists, in the class, with the parent and the photo.
    await page.getByRole("link", { name: "Open the student" }).click();
    await expect(page.getByRole("heading", { name: /Obinna/ })).toBeVisible();
    await expect(page.getByText("Admission documents")).toBeVisible();
    await expect(page.getByRole("button", { name: "Passport photograph" })).toBeVisible();
    const students = await ok<{ data: { id: string; admissionNumber: string }[] }>(await admin.api.get(`students?search=${encodeURIComponent(`ADM-${suffix}`)}`), "students");
    expect(students.data.some((s) => s.admissionNumber === `ADM-${suffix}`.slice(0, 40))).toBe(true);
  } finally {
    await familyContext.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
