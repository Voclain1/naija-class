import { expect, test } from "@playwright/test";

import { setupAcademicStructure } from "../fixtures/academic.js";
import { setupFinanceScaffold } from "../fixtures/finance.js";
import { loginAsAdmin } from "../fixtures/session.js";
import { uniqueSuffix } from "../fixtures/unique.js";

// Text CLIPPED INSIDE a card, on a phone.
//
// a11y-wave3a's responsive suite does not catch this and was never meant to:
// it asserts the BODY does not overflow and that nothing is pushed
// offscreen-and-unreachable. A naira figure cut off mid-digit inside a card
// that itself fits the viewport passes both checks perfectly.
//
// It shipped exactly that way — the finance dashboard packed two KPI columns
// at 430px while the admin dashboard used one, and StatCard's numeral was a
// fixed text-3xl, so "₦1,530,000.00" rendered clipped. Found by looking at a
// phone, not by the suite.
//
// TWO EARLIER VERSIONS OF THIS TEST WERE VACUOUS, which is why the seeding
// below exists and why the non-vacuity guard is not optional:
//   1. It measured scrollWidth vs clientWidth and passed with the bug
//      deliberately reinstated.
//   2. The cause was the fixture: loginAsAdmin creates a FRESH school with no
//      academic year, term or invoices, so the finance dashboard renders its
//      setup notice and there are no figures on the page at all. An empty
//      "nothing was clipped" list is indistinguishable from "nothing was
//      looked at".

const PHONES = [
  { name: "iPhone 15 Pro Max", width: 430, height: 932 },
  { name: "small Android", width: 390, height: 844 },
];

test.describe("finance dashboard — phone widths", () => {
  test("KPI figures are never clipped inside their cards", async ({ browser }) => {
    test.setTimeout(8 * 60 * 1000);
    const admin = await loginAsAdmin(browser);
    const suffix = uniqueSuffix();

    // Real money on the page, at a realistic magnitude: the scaffold bills
    // ₦45,000.00 per student, so the totals run to seven figures — which is
    // exactly the width that was being cut off.
    const structure = await setupAcademicStructure(admin.api);
    await setupFinanceScaffold(admin.api, {
      suffix,
      termId: structure.termId,
      classArmId: structure.arms[0]!.id,
      classLevelId: structure.classLevelId,
      academicYearId: structure.academicYearId,
    });
    await admin.api.post("invoices/arm/generate", {
      data: { termId: structure.termId, classArmId: structure.arms[0]!.id },
    });

    for (const phone of PHONES) {
      await admin.page.setViewportSize({ width: phone.width, height: phone.height });
      await admin.page.goto("/finance/dashboard", { waitUntil: "domcontentloaded" });
      // Wait for the FIGURES, not a fixed sleep. In dev mode this route has to
      // compile before it even mounts, and then resolve the current year/term
      // and fetch — a 3s sleep landed on the loading spinner every time, which
      // is what made the previous version of this test fail its own guard.
      await admin.page.waitForFunction(
        () =>
          Array.from(document.querySelectorAll(".font-serif")).filter((el) =>
            /[₦%]/.test((el.textContent ?? "").trim()),
          ).length >= 4,
        undefined,
        { timeout: 90_000 },
      );

      const result = await admin.page.evaluate(() => {
        const bad: string[] = [];
        const measured: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(".font-serif"))) {
          const text = (el.textContent ?? "").trim();
          // Only the money/percentage figures — the page title is serif too
          // and is allowed to wrap.
          if (!/[₦%]/.test(text)) continue;
          if (el.offsetWidth === 0) continue; // not visible
          measured.push(text);
          // Range width vs the box: a text run wider than its container is
          // being cut off, whether or not the page itself scrolls.
          const range = document.createRange();
          range.selectNodeContents(el);
          const textWidth = range.getBoundingClientRect().width;
          const boxWidth = el.getBoundingClientRect().width;
          if (textWidth > boxWidth + 1) {
            bad.push(`"${text}" text=${Math.round(textWidth)} box=${Math.round(boxWidth)}`);
          }
        }
        return { bad, measured };
      });

      // NON-VACUITY GUARD — see the header. Without this the assertion below
      // passes on a page that rendered no figures whatsoever.
      expect(
        result.measured.length,
        `${phone.name} @${phone.width}px measured no figures — the page did not render them, so the clipping assertion would be meaningless. Saw: ${result.measured.join(" ~ ")}`,
      ).toBeGreaterThanOrEqual(4);

      expect(
        result.bad,
        `${phone.name} @${phone.width}px clipped: ${result.bad.join(" ~ ")}`,
      ).toEqual([]);
    }

    await admin.context.close();
    await admin.api.dispose();
  });
});
