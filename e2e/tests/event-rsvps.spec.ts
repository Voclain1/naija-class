import { expect, test } from "@playwright/test";

import { loginAsAdmin, uniqueSuffix } from "../fixtures/index.js";
import { createPortalGuardian, PORTAL_BASE_URL } from "../fixtures/guardian.js";

// Phase 9 / CP10.1 — event RSVPs (docs/modules/phase-9.md §19.2), in a real
// browser: the admin adds an event that asks families to reply, with "how many
// are coming"; a parent answers in the portal; the admin sees the counts and
// the list of replies.

const lagos = (offsetDays: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000));

test("an event asks families to reply; a parent answers; the school sees it", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const admin = await loginAsAdmin(browser);
  const guardian = await createPortalGuardian(admin.api, { suffix, schoolId: admin.schoolId });
  const parentContext = await browser.newContext();

  // The parent's child must be enrolled this term to be asked.
  const { withTenant } = await import("@school-kit/db");
  await withTenant(admin.schoolId, async (db) => {
    const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
    let term = await db.term.findFirst({ where: { schoolId: admin.schoolId, isCurrent: true }, select: { id: true, academicYearId: true } });
    if (!term) {
      const year = await db.academicYear.create({ data: { schoolId: admin.schoolId, label: `RSVP ${suffix}`, startDate: d("2025-09-01"), endDate: d("2099-07-31") }, select: { id: true } });
      term = await db.term.create({
        data: { schoolId: admin.schoolId, academicYearId: year.id, sequence: 1, name: "Now", startDate: d("2025-09-01"), endDate: d("2098-12-31"), isCurrent: true },
        select: { id: true, academicYearId: true },
      });
    }
    const level = await db.classLevel.findFirstOrThrow({ where: { schoolId: admin.schoolId }, orderBy: { orderIndex: "asc" }, select: { id: true } });
    const arm = await db.classArm.create({ data: { schoolId: admin.schoolId, classLevelId: level.id, name: `RSVP ${suffix}`, code: `rsvp-${suffix}` }, select: { id: true } });
    await db.enrollment.create({ data: { schoolId: admin.schoolId, studentId: guardian.studentId, termId: term.id, academicYearId: term.academicYearId, classArmId: arm.id } });
  });

  try {
    // 1. The admin adds an event that asks families to reply.
    const page = admin.page;
    await page.goto("/events");
    await page.getByRole("button", { name: "Add event" }).click();
    await page.getByLabel("Title").fill(`Sports day ${suffix}`);
    await page.getByLabel("Start date").fill(lagos(7));
    await page.getByLabel("End date").fill(lagos(7));
    await page.getByRole("checkbox", { name: /Ask families to reply/ }).check();
    await page.getByLabel("Reply by (optional)").fill(lagos(5));
    await page.getByRole("checkbox", { name: "Ask how many people will come" }).check();
    await page.getByRole("dialog").getByRole("button", { name: "Add event" }).click();
    const row = page.getByRole("listitem").filter({ hasText: `Sports day ${suffix}` });
    await expect(row.getByText(/Replies: 0 yes · 0 no · 0 maybe · \d+ not answered · 0 coming of \d+ asked/)).toBeVisible({ timeout: 30_000 });

    // 2. The parent answers in the portal.
    const parent = await parentContext.newPage();
    await parent.goto(`${PORTAL_BASE_URL}/login`);
    await parent.getByLabel("Email").fill(guardian.email);
    await parent.getByLabel("Password", { exact: true }).fill(guardian.password);
    await parent.getByRole("button", { name: "Log in" }).click();
    await expect(parent.getByRole("heading", { name: "Your children" })).toBeVisible({ timeout: 60_000 });
    await parent.goto(`${PORTAL_BASE_URL}/calendar`);
    const reply = parent.getByLabel(`Reply to Sports day ${suffix}`);
    await expect(reply.getByText(/The school asks you to reply by/)).toBeVisible({ timeout: 30_000 });
    await reply.getByLabel("How many people will come?").selectOption("3");
    await reply.getByRole("button", { name: "Yes" }).click();
    await expect(reply.getByText(/Saved\. Your answer: Yes, 3 coming/)).toBeVisible();

    // 3. The school sees the counts and the reply.
    await page.reload();
    await expect(row.getByText(/Replies: 1 yes · 0 no · 0 maybe · \d+ not answered · 3 coming/)).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "See replies" }).click();
    const list = page.getByLabel(`Replies to Sports day ${suffix}`);
    await expect(list.getByText("Replies are open")).toBeVisible();
    await expect(list.getByRole("listitem").filter({ hasText: "Ngozi Adeleke" }).getByText("Yes · 3 coming")).toBeVisible();
    await expect(list.getByRole("button", { name: "Download CSV" })).toBeVisible();
  } finally {
    await parentContext.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
