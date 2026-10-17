import { expect, test } from "@playwright/test";

import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";
import { apiCreateAcademicYear, apiCreateTerm, apiSetCurrentTerm, apiSetCurrentYear } from "../fixtures/api.js";
import { apiCreateEnrollment } from "../fixtures/finance.js";
import { createPortalGuardian, PORTAL_BASE_URL } from "../fixtures/guardian.js";

// Phase 9 / CP6b.2 — boarding (docs/modules/phase-9.md §15 CP6b-D5, D7, D8),
// in a real browser against a throwaway school: the Boarding page lists the
// hostel's boarders and says, only, that the sickbay sent one home today; a
// visitor is logged and then marked gone; the sickbay page labels the boarder;
// and the parent's hostel card shows the bed but no visitors.

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

test("the house master's list, the visitor log, the sickbay label and the parent's hostel card", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 1 Blue", code: `jss1b-${suffix}`.slice(0, 20) }],
    subjectCode: `math-${suffix}`.slice(0, 20),
  });
  const arm = structure.arms[0]!;
  const year = await apiCreateAcademicYear(admin.api, {
    label: `Boarding ${suffix}`.slice(0, 30),
    startDate: `${lagosDay(-120)}T00:00:00.000Z`,
    endDate: `${lagosDay(120)}T00:00:00.000Z`,
  });
  const term = await apiCreateTerm(admin.api, year.id, {
    sequence: 1,
    name: "Boarding Term",
    startDate: `${lagosDay(-60)}T00:00:00.000Z`,
    endDate: `${lagosDay(60)}T00:00:00.000Z`,
  });
  await apiSetCurrentYear(admin.api, year.id);
  await apiSetCurrentTerm(admin.api, term.id);
  // The guardian fixture's child is a girl.
  const guardian = await createPortalGuardian(admin.api, { suffix, schoolId: admin.schoolId });
  await apiCreateEnrollment(admin.api, { studentId: guardian.studentId, termId: term.id, classArmId: arm.id });
  const hostelName = `Queen Amina ${suffix}`.slice(0, 40);
  const parentContext = await browser.newContext();

  try {
    // 1. A girls' hostel with a room, and the child given a bed.
    const hostel = await ok<{ id: string }>(await admin.api.post("hostels", { data: { name: hostelName, forGender: "GIRLS" } }), "hostel");
    const withRoom = await ok<{ rooms: { id: string }[] }>(
      await admin.api.post(`hostels/${hostel.id}/rooms`, { data: { name: "Room A", beds: 4 } }),
      "room",
    );
    await ok(await admin.api.post("hostels/beds", { data: { studentId: guardian.studentId, termId: term.id, roomId: withRoom.rooms[0]!.id } }), "bed");

    // 2. The sickbay sends her home today, with a complaint the house master must never see.
    await ok(
      await admin.api.post("health/sickbay/visits", {
        data: { studentId: guardian.studentId, visitedAt: new Date().toISOString(), complaint: "Malaria symptoms", sentHome: true },
      }),
      "sickbay",
    );

    // 3. Boarding: the boarder, flagged in words, and nothing about why.
    const page = admin.page;
    await page.goto("/boarding");
    await expect(page.getByRole("heading", { name: new RegExp(`${hostelName}: boarders`) })).toBeVisible();
    await expect(page.getByText(/Room A, bed 1/)).toBeVisible();
    await expect(page.getByText("Sent home by the sickbay today", { exact: true })).toBeVisible();
    await expect(page.getByText("1 boarder; 1 sent home by the sickbay today.")).toBeVisible();
    await expect(page.getByText("Malaria symptoms")).toHaveCount(0);

    // 4. A visitor logged, then gone.
    const form = page.getByRole("form", { name: "Log a visitor" });
    await form.getByLabel("Boarder").selectOption({ index: 1 });
    await form.getByLabel("Visitor's name").fill("Ngozi Eze");
    await form.getByLabel("Relationship").fill("Aunt");
    await form.getByLabel("Phone (optional)").fill("08031234567");
    await form.getByRole("button", { name: "Log visitor" }).click();
    await expect(page.getByText(/^Ngozi Eze \(Aunt\) to see /)).toBeVisible();
    await expect(page.getByText(/Still here/)).toBeVisible();
    await page.getByRole("button", { name: "Ngozi Eze has left" }).click();
    await expect(page.getByText(/Left \d\d:\d\d/)).toBeVisible();

    // 5. The sickbay page says she boards, so the health officer knows whom to tell.
    await page.goto("/sickbay");
    await expect(page.getByText(`Boarder: ${hostelName}, Room A`)).toBeVisible();

    // 6. The parent sees the hostel and bed, and no visitor log.
    const parent = await parentContext.newPage();
    await parent.goto(`${PORTAL_BASE_URL}/login`);
    await parent.getByLabel("Email").fill(guardian.email);
    await parent.getByLabel("Password", { exact: true }).fill(guardian.password);
    await parent.getByRole("button", { name: "Log in" }).click();
    await expect(parent.getByRole("heading", { name: "Your children" })).toBeVisible({ timeout: 60_000 });
    await parent.goto(`${PORTAL_BASE_URL}/students/${guardian.studentId}`);
    await expect(parent.getByRole("heading", { name: "Hostel" })).toBeVisible({ timeout: 60_000 });
    await expect(parent.getByText(hostelName)).toBeVisible();
    await expect(parent.getByText("Room A, bed 1")).toBeVisible();
    await expect(parent.getByText("Ngozi Eze")).toHaveCount(0);
  } finally {
    await parentContext.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
