import { expect, test } from "@playwright/test";
import type { AdminDashboardDto } from "@school-kit/types";

import { setupAcademicStructure } from "../fixtures/academic.js";
import { apiCreateEnrollment, apiCreateStudent } from "../fixtures/finance.js";
import { uniqueSuffix } from "../fixtures/unique.js";
import { loginAsAdmin } from "../fixtures/session.js";

// Owner's Android recording: even short amounts wrapped vertically inside
// the dashboard's half-width cards, with cards painting over one another.
// The finance page uses full-width phone cards, so its check missed this.
test("dashboard metrics stay on one line and inside their cards while resizing and scrolling", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api);
  // Empty schools intentionally show a setup checklist instead of KPI cards.
  // Seed the real prerequisite, rather than bypassing that product rule.
  const student = await apiCreateStudent(admin.api, {
    admissionNumber: `MET-${uniqueSuffix()}`,
    firstName: "Ada",
    lastName: "Okafor",
    dateOfBirth: "2014-05-12",
    gender: "FEMALE",
  });
  await apiCreateEnrollment(admin.api, {
    studentId: student.id,
    termId: structure.termId,
    classArmId: structure.arms[0]!.id,
  });
  // Keep the real authenticated dashboard response, but replay the two
  // amounts from the recording to catch the short-amount sizing path.
  await admin.page.route("**/api/v1/dashboard?*", async (route) => {
    const response = await route.fetch();
    const data = await response.json() as AdminDashboardDto;
    data.fees.collected = 47500;
    data.outstanding.amount = 92500;
    await route.fulfill({ response, json: data });
  });
  await admin.page.goto(`/dashboard?termId=${structure.termId}`);
  const metrics = admin.page.locator(".dashboard-stats .metric-value");
  await expect(metrics).toHaveCount(4);
  await expect(metrics.nth(1)).toContainText("475.00");
  await expect(metrics.nth(3)).toContainText("925.00");
  await admin.page.evaluate(() => document.fonts.ready);

  for (const width of [320, 360, 390, 430, 768, 1024]) {
    await admin.page.setViewportSize({ width, height: 800 });
    await metrics.last().scrollIntoViewIfNeeded();
    await expect.poll(async () => admin.page.evaluate(() => {
      const values = Array.from(document.querySelectorAll<HTMLElement>(".dashboard-stats .metric-value"));
      const problems: string[] = [];
      for (const value of values) {
        const text = value.querySelector(".metric-value-text");
        const card = value.closest(".metric-card");
        if (!text || !card) { problems.push("missing value/card"); continue; }
        const t = text.getBoundingClientRect();
        const c = card.getBoundingClientRect();
        const box = value.getBoundingClientRect();
        if (t.left < c.left || t.right > c.right + 1 || t.bottom > c.bottom + 1) problems.push(value.textContent ?? "overflow");
        if (t.width > box.width + 1 || t.height > box.height + 1) problems.push("wrapped or clipped");
      }
      const cards = Array.from(document.querySelectorAll(".dashboard-stats .metric-card"));
      for (let i = 0; i < cards.length; i++) {
        const a = cards[i]!.getBoundingClientRect();
        for (const next of cards.slice(i + 1)) {
          const b = next.getBoundingClientRect();
          if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) problems.push("overlapping cards");
        }
      }
      return { count: values.length, problems };
    }), { message: `metrics fit at ${width}px` }).toEqual({ count: 4, problems: [] });
    await admin.page.evaluate(() => window.scrollTo(0, 0));
  }
  await admin.context.close();
  await admin.api.dispose();
});
