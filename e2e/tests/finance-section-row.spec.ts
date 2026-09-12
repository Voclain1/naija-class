import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "../fixtures/session.js";

// The finance section row: seven tabs plus "Record payment".
//
// Pass 3 put the button BESIDE the tab strip at every width. On a 430px phone
// it took roughly half the row, so the tab scrollport shrank to what was left
// and "Discounts" rendered cut off mid-word ("iscounts") — found by looking at
// a phone during review, not by the suite. Nothing was technically hidden
// (the strip still scrolled), which is exactly why the existing checks passed:
// a11y-wave3a asserts the strip is SCROLLABLE, not that it is USABLE.
//
// THE RULE, at every width: either the button sits on a different row from
// the tabs, or the tabs are not being squeezed by it. "Squeezed" is measured,
// not eyeballed — the strip's scrollWidth exceeding its clientWidth while the
// button shares its row.

const WIDTHS = [390, 430, 768, 1024, 1280, 1440];

test("Record payment never squeezes the finance tabs", async ({ browser }) => {
  test.setTimeout(4 * 60 * 1000);
  const admin = await loginAsAdmin(browser);

  for (const width of WIDTHS) {
    await admin.page.setViewportSize({ width, height: 900 });
    await admin.page.goto("/finance/invoices", { waitUntil: "domcontentloaded" });

    const button = admin.page.getByRole("link", { name: "Record payment" });
    // Non-vacuity: if the button is not rendered (a permission change, a
    // renamed label), there is nothing to share a row with and every
    // measurement below would pass for the wrong reason.
    await expect(button, `button visible at ${width}px`).toBeVisible();

    const m = await admin.page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>('nav[aria-label="Finance sections"]');
      const btn = Array.from(document.querySelectorAll<HTMLElement>("a")).find(
        (a) => a.textContent?.trim() === "Record payment",
      );
      if (!nav || !btn) return null;
      const n = nav.getBoundingClientRect();
      const b = btn.getBoundingClientRect();
      return {
        sameRow: b.top < n.bottom && b.bottom > n.top,
        overflows: nav.scrollWidth > nav.clientWidth + 1,
        navWidth: Math.round(n.width),
        buttonLeft: Math.round(b.left),
        navRight: Math.round(n.right),
      };
    });

    expect(m, `row measured at ${width}px`).not.toBeNull();
    expect(
      m!.sameRow && m!.overflows,
      `${width}px: button shares the tabs' row while the tabs overflow ` +
        `(nav ${m!.navWidth}px wide, ends at ${m!.navRight}, button starts at ${m!.buttonLeft})`,
    ).toBe(false);
    // And it must never sit ON TOP of the strip, whichever row it is on.
    expect(m!.sameRow && m!.buttonLeft < m!.navRight - 1, `${width}px: button overlaps the tabs`).toBe(
      false,
    );
  }

  await admin.context.close();
  await admin.api.dispose();
});
