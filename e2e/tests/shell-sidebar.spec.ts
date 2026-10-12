import { expect, test, type Page } from "@playwright/test";

import { inviteAndAcceptTeacher, loginAsAdmin, loginAsTeacher } from "../fixtures/index.js";

// The sidebar fills the shell's height on a short page (2026-10-12). Its print
// wrapper was a plain block, so the sidebar was only as tall as its links and
// its background stopped partway down the window on the teacher shell.

const WEB = "http://localhost:3001";

async function sidebarReachesTheBottom(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 1100 });
  const aside = page.locator("aside").first();
  await expect(aside).toBeVisible({ timeout: 60_000 });
  const box = await aside.boundingBox();
  expect(box, "sidebar is laid out").not.toBeNull();
  expect(box!.y + box!.height).toBeGreaterThanOrEqual(1100 - 1);
}

test("the teacher sidebar runs the full height of a short page", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  const teacher = await inviteAndAcceptTeacher(browser, { schoolId: admin.schoolId, invitedByUserId: admin.ownerUserId });
  const session = await loginAsTeacher(browser, teacher.email, teacher.password);

  await session.page.goto(`${WEB}/teacher/profile`);
  await sidebarReachesTheBottom(session.page);

  await session.context.close();
  await teacher.context.close();
  await admin.context.close();
  await admin.api.dispose();
});

test("the admin sidebar runs the full height of a short page", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  await admin.page.goto(`${WEB}/settings/admission-numbers`);
  await sidebarReachesTheBottom(admin.page);
  await admin.context.close();
  await admin.api.dispose();
});
