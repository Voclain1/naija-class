import { expect, test } from "@playwright/test";

import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";
import { apiCreateAcademicYear, apiCreateTerm, apiSetCurrentTerm, apiSetCurrentYear } from "../fixtures/api.js";
import { apiCreateEnrollment } from "../fixtures/finance.js";
import { createPortalGuardian, PORTAL_BASE_URL } from "../fixtures/guardian.js";

// Phase 9 / CP6b.3 — leave out (exeats, docs/modules/phase-9.md §15
// CP6b-D6), in a real browser against a throwaway school: the parent asks in
// the portal, naming who will collect; the house master's page approves it and
// logs the child out and back; the parent sees each step in words.

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

test("a parent asks for leave out; the house master approves it and logs the child out and back", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 1 Blue", code: `jss1b-${suffix}`.slice(0, 20) }],
    subjectCode: `math-${suffix}`.slice(0, 20),
  });
  const arm = structure.arms[0]!;
  const year = await apiCreateAcademicYear(admin.api, {
    label: `Exeat ${suffix}`.slice(0, 30),
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
    const hostel = await ok<{ id: string }>(await admin.api.post("hostels", { data: { name: hostelName, forGender: "GIRLS" } }), "hostel");
    const withRoom = await ok<{ rooms: { id: string }[] }>(
      await admin.api.post(`hostels/${hostel.id}/rooms`, { data: { name: "Room A", beds: 4 } }),
      "room",
    );
    await ok(await admin.api.post("hostels/beds", { data: { studentId: guardian.studentId, termId: term.id, roomId: withRoom.rooms[0]!.id } }), "bed");

    // 1. The parent asks, naming who will collect.
    const parent = await parentContext.newPage();
    await parent.goto(`${PORTAL_BASE_URL}/login`);
    await parent.getByLabel("Email").fill(guardian.email);
    await parent.getByLabel("Password", { exact: true }).fill(guardian.password);
    await parent.getByRole("button", { name: "Log in" }).click();
    await expect(parent.getByRole("heading", { name: "Your children" })).toBeVisible({ timeout: 60_000 });
    await parent.goto(`${PORTAL_BASE_URL}/students/${guardian.studentId}`);
    await expect(parent.getByRole("heading", { name: "Hostel" })).toBeVisible({ timeout: 60_000 });
    await parent.getByRole("button", { name: "Ask for leave out" }).click();
    const form = parent.getByRole("form", { name: "Ask for leave out" });
    await form.getByLabel("Out on").fill(lagosDay(0));
    await form.getByLabel("Out at").fill("08:00");
    await form.getByLabel("Back on").fill(lagosDay(2));
    await form.getByLabel("Back by").fill("18:00");
    await form.getByLabel("Reason").fill("Grandmother's 80th birthday");
    await form.getByLabel("Who will collect").fill("Chidi Okafor");
    await form.getByLabel("Their relationship").fill("Uncle");
    await form.getByLabel("Their phone").fill("08035550000");
    await form.getByRole("button", { name: "Send request" }).click();
    await expect(parent.getByText("Waiting for the house master")).toBeVisible();
    await expect(parent.getByRole("button", { name: "Cancel this leave out" })).toBeVisible();

    // 2. The house master's page: approve, out (with someone else collecting), back.
    const page = admin.page;
    await page.goto("/boarding");
    await expect(page.getByRole("heading", { name: "Leave out" })).toBeVisible();
    await expect(page.getByText("Grandmother's 80th birthday")).toBeVisible();
    await expect(page.getByText("Collected by Chidi Okafor (Uncle) · 08035550000")).toBeVisible();
    const name = (await page.getByRole("button", { name: /^Approve leave out for / }).getAttribute("aria-label"))!.replace("Approve leave out for ", "");
    await page.getByRole("button", { name: `Approve leave out for ${name}` }).click();
    await expect(page.getByText("Approved", { exact: true })).toBeVisible();

    await parent.reload();
    await expect(parent.getByText("Approved", { exact: true })).toBeVisible({ timeout: 60_000 });

    await page.getByRole("button", { name: `${name} has left` }).click();
    await page.getByLabel("Collected by, if not Chidi Okafor").fill("Mrs Okafor, his wife");
    await page.getByRole("button", { name: "Mark left now" }).click();
    await expect(page.getByText("Out of school", { exact: true })).toBeVisible();
    await expect(page.getByText(/Left .* with Mrs Okafor, his wife/)).toBeVisible();

    await parent.reload();
    await expect(parent.getByText("Out of school", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(parent.getByText("Collected by Mrs Okafor, his wife")).toBeVisible();
    await expect(parent.getByRole("button", { name: "Cancel this leave out" })).toHaveCount(0);

    await page.getByRole("button", { name: `${name} is back` }).click();
    await expect(page.getByText("No leave out waiting, approved or under way.")).toBeVisible();
    await page.getByRole("button", { name: "Past", exact: true }).click();
    await expect(page.getByText("Back in school", { exact: true })).toBeVisible();

    await parent.reload();
    await expect(parent.getByText("Back in school", { exact: true })).toBeVisible({ timeout: 60_000 });
  } finally {
    await parentContext.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
