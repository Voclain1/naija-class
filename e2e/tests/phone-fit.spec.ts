import { expect, test, type Page } from "@playwright/test";

import { setupAcademicStructure } from "../fixtures/academic.js";
import { setupFinanceScaffold } from "../fixtures/finance.js";
import { loginAsAdmin } from "../fixtures/session.js";
import { inviteAndAcceptTeacher } from "../fixtures/teacher.js";
import { uniqueSuffix } from "../fixtures/unique.js";

// Nothing on an admin page may sit past the right edge of a phone screen
// (owner's rule, 2026-10-12: "items overflowing outside the page area is not
// proper UI/UX").
//
// Why the older checks missed it. a11y-wave3a asks whether the BODY scrolls
// sideways and whether a clipped control is still reachable by scrolling;
// finance-dashboard-mobile asks whether a figure fits inside its card. The
// admin shell's <main> is overflow-x-hidden, so the body never scrolls: a
// page 27px wider than its column (the finance dashboard), or a table whose
// last two columns ran off the screen (academic years), passed all three.
// This measures the thing a person sees: every element's right edge against
// the screen's.
//
// Seeded with real money and a real academic structure, because an empty
// school renders setup notices and no tables, and "nothing overflowed" on an
// empty page proves nothing (the same trap finance-dashboard-mobile records).

const PHONES = [390, 430];

// Set once the structure exists: the invoice list is filtered by this arm.
const ARM_NAME = { value: "" };

const PAGES: Array<{ path: string; ready: (page: Page) => Promise<unknown> }> = [
  {
    path: "/finance/dashboard",
    ready: (page) =>
      page.waitForFunction(
        () =>
          Array.from(document.querySelectorAll(".font-serif")).filter((el) => /[₦%]/.test(el.textContent ?? ""))
            .length >= 4,
        undefined,
        { timeout: 120_000 },
      ),
  },
  {
    // The list needs a term and a class chosen, then its own tab.
    path: "/finance/invoices",
    ready: async (page) => {
      await page.getByRole("combobox", { name: "Term" }).locator("option", { hasText: "(current)" }).waitFor({ state: "attached", timeout: 120_000 });
      const term = page.getByRole("combobox", { name: "Term" });
      await term.selectOption({ label: (await term.locator("option", { hasText: "(current)" }).first().textContent())!.trim() });
      const cls = page.getByRole("combobox", { name: "Class" });
      await cls.selectOption({ label: ARM_NAME.value });
      await page.getByRole("tab", { name: "Invoice list" }).click();
      await page.locator("main table tbody tr").first().waitFor({ timeout: 120_000 });
    },
  },
  { path: "/finance/debtors", ready: (page) => page.locator("main table tbody tr").first().waitFor({ timeout: 120_000 }) },
  {
    // Items show once a category is picked.
    path: "/finance/fees",
    ready: async (page) => {
      await page.getByRole("button", { name: /^Tuition / }).click({ timeout: 120_000 });
      await page.locator("main table tbody tr").first().waitFor({ timeout: 60_000 });
    },
  },
  {
    path: "/settings/academic/years",
    ready: (page) => page.locator("main table tbody tr").first().waitFor({ timeout: 120_000 }),
  },
  {
    path: "/settings/academic/class-levels",
    ready: (page) => page.locator("main table tbody tr").first().waitFor({ timeout: 120_000 }),
  },
  {
    path: "/settings/academic/class-arms",
    ready: (page) => page.locator("main table tbody tr").first().waitFor({ timeout: 120_000 }),
  },
  {
    path: "/settings/academic/subjects",
    ready: (page) => page.locator("main table tbody tr").first().waitFor({ timeout: 120_000 }),
  },
  { path: "/students", ready: (page) => page.locator("main table tbody tr").first().waitFor({ timeout: 120_000 }) },
  { path: "/staff", ready: (page) => page.locator("main table tbody tr").first().waitFor({ timeout: 120_000 }) },
  // Phase 9 / CP3.1 — the Health page's student list.
  { path: "/health", ready: (page) => page.locator("main ul li a").first().waitFor({ timeout: 120_000 }) },
];

async function pastTheEdge(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    let measured = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("main *"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      measured++;
      if (r.right <= vw + 1) continue;
      // Report the deepest offender only: its ancestors overflow because it does.
      if (Array.from(el.children).some((c) => c.getBoundingClientRect().right > vw + 1)) continue;
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      out.push(`<${el.tagName.toLowerCase()}> "${text}" ends at ${Math.round(r.right)}px`);
    }
    return { vw, measured, out: out.slice(0, 8) };
  });
}

test("admin pages fit a phone screen: nothing past the right edge", async ({ browser }) => {
  test.setTimeout(15 * 60 * 1000);
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api);
  await setupFinanceScaffold(admin.api, {
    suffix: uniqueSuffix(),
    termId: structure.termId,
    classArmId: structure.arms[0]!.id,
    classLevelId: structure.classLevelId,
    academicYearId: structure.academicYearId,
  });
  ARM_NAME.value = structure.arms[0]!.name;
  // A teacher, so the staff list has a row to lay out.
  await inviteAndAcceptTeacher(browser, { schoolId: admin.schoolId, invitedByUserId: admin.ownerUserId });
  await admin.api.post("invoices/arm/generate", {
    data: { termId: structure.termId, classArmId: structure.arms[0]!.id },
  });

  const problems: string[] = [];
  for (const width of PHONES) {
    await admin.page.setViewportSize({ width, height: 900 });
    for (const { path, ready } of PAGES) {
      await admin.page.goto(path, { waitUntil: "domcontentloaded" });
      await ready(admin.page);
      await admin.page.waitForTimeout(500);
      const { vw, measured, out } = await pastTheEdge(admin.page);
      expect(measured, `${path} @${width}px measured nothing — the page did not render`).toBeGreaterThan(20);
      // Collected, not asserted one by one: a fix for one page should not
      // hide the next page's problem until the following run.
      if (out.length) problems.push(`${path} @${width}px (screen ${vw}px): ${out.join(" ~ ")}`);
    }
  }
  expect(problems, problems.join("\n")).toEqual([]);

  await admin.context.close();
  await admin.api.dispose();
});
