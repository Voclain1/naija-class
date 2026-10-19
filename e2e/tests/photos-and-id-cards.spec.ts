import { expect, test } from "@playwright/test";

import {
  armId,
  loginAsAdmin,
  openFromMenu,
  setupAcademicStructure,
  uniqueSuffix,
} from "../fixtures/index.js";
import { apiCreateEnrollment, apiCreateStudent } from "../fixtures/finance.js";
import { PORTAL_BASE_URL } from "../fixtures/guardian.js";

// ID cards build (2026-10-19, docs/modules/id-cards-and-store.md):
//   §2 a passport photo is uploaded, cropped in the browser, on the student's page;
//   §3 an ID card is issued, printed, and its QR code checks on the portal.

test("upload a passport photo, issue and print an ID card, and check its code", async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const admin = await loginAsAdmin(browser);
  const page = admin.page;
  const suffix = uniqueSuffix();
  const structure = await setupAcademicStructure(admin.api, { arms: [{ name: `JSS 2 Card ${suffix}`, code: `card${suffix}` }] });
  const student = await apiCreateStudent(admin.api, {
    admissionNumber: `IDC/${suffix}`,
    firstName: "Chiamaka",
    lastName: `Card${suffix}`,
    dateOfBirth: "2012-05-14T00:00:00.000Z",
    gender: "FEMALE",
  });
  await apiCreateEnrollment(admin.api, {
    studentId: student.id,
    termId: structure.termId,
    classArmId: armId(structure, `JSS 2 Card ${suffix}`),
  });

  // A real picture, made by the browser, as a school's phone photo would be.
  await page.goto(`/students/${student.id}`);
  const jpeg = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#4a7";
    ctx.fillRect(0, 0, 800, 600);
    ctx.fillStyle = "#fc9";
    ctx.beginPath();
    ctx.arc(400, 260, 120, 0, Math.PI * 2);
    ctx.fill();
    const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.9));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByLabel(`Choose a photo of Chiamaka Card${suffix}`).setInputFiles({
    name: "chiamaka.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(jpeg),
  });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Photo preview")).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "Save photo" }).click();
  await expect(page.getByRole("img", { name: `Photo of Chiamaka Card${suffix}` })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible();

  // Student ID cards: tick the child, issue, print.
  await openFromMenu(page, "Student ID cards");
  await expect(page).toHaveURL(/\/id-cards\/students/);
  await page.getByLabel(`Choose Chiamaka Card${suffix}`).check({ timeout: 60_000 });
  await page.getByRole("button", { name: /^Issue 1 card/ }).click();
  await expect(page.getByText("1 card issued.")).toBeVisible({ timeout: 30_000 });
  const row = page.getByRole("row", { name: new RegExp(`Chiamaka Card${suffix}`) });
  await expect(row.getByText(/^ID-\d{4}-\d{5}$/)).toBeVisible();

  await page.getByLabel(`Choose Chiamaka Card${suffix}`).check();
  await page.getByRole("button", { name: /^Print 1 card/ }).click();
  await expect(page).toHaveURL(/\/id-cards\/print/);
  const front = page.getByTestId("id-card-front").first();
  await expect(front.getByText(`Chiamaka Card${suffix}`)).toBeVisible({ timeout: 30_000 });
  await expect(front.getByRole("img", { name: `Photo of Chiamaka Card${suffix}` })).toBeVisible();
  await expect(page.getByTestId("id-card-back").first().getByText("If found, please return to")).toBeVisible();
  await page.getByLabel(/PVC card printer/).check();
  await expect(page.getByTestId("id-card-front")).toHaveCount(1);

  // The QR code's address, as the print data gives it, opens the portal check.
  const list = await (await admin.api.get(`id-cards?kind=STUDENT&classArmId=${armId(structure, `JSS 2 Card ${suffix}`)}`)).json();
  const cardId = list.data[0].card.id as string;
  const printed = await (await admin.api.post("id-cards/print", { data: { cardIds: [cardId] } })).json();
  const verifyUrl = (printed.cards[0].verifyUrl as string).replace(/^https?:\/\/[^/]+/, PORTAL_BASE_URL);
  const visitor = await browser.newPage();
  await visitor.goto(verifyUrl);
  // The fixture's session may already have ended by the calendar, in which
  // case "Expired" is the right answer; either way the school issued it.
  await expect(visitor.getByText(/^(Valid|Expired) card$/)).toBeVisible({ timeout: 60_000 });
  await expect(visitor.getByText(`Chiamaka Card${suffix}`)).toBeVisible();
  await visitor.close();

  await admin.context.close();
  await admin.api.dispose();
});
