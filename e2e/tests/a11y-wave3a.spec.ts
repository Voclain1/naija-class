// Regression coverage for UX Hardening Wave 3A.
//
// Each test below pins one defect this slice fixed, chosen so it FAILS against
// the pre-fix code rather than merely asserting the page still renders. Where a
// fix was mechanical and repeated (the finance label/control associations), the
// test asserts the accessible-name outcome via getByLabel rather than the
// htmlFor attribute, so a future refactor onto a different labelling mechanism
// keeps passing while an actual regression to an unnamed control fails.

import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "../fixtures/session.js";
import { createPortalGuardian, PORTAL_BASE_URL } from "../fixtures/guardian.js";
import { uniqueSuffix } from "../fixtures/unique.js";

// A deliberately long, realistic Nigerian name — the width case the responsive
// half of this slice is about.
const LONG = {
  firstName: "Oluwadamilareoluwa",
  lastName: "Chukwuemeka-Adebayorwale",
  middleName: "Oluwaseyifunmi",
};

const VIEWPORTS = [
  { name: "1280", width: 1280, height: 900 },
  { name: "1024", width: 1024, height: 800 },
  { name: "768", width: 768, height: 1024 },
  { name: "430", width: 430, height: 932 },
  { name: "390", width: 390, height: 844 },
];


// Responsive oracle: does any content end up OFF-SCREEN AND UNREACHABLE?
//
// Two things this deliberately does NOT do.
//
// It does not use `document.documentElement.scrollWidth`. Chromium inflates
// that to include content inside a descendant's own scroll container, so a
// correctly-behaving wide table inside `overflow-auto` (exactly what
// components/ui/table.tsx renders) reports hundreds of pixels of phantom
// overflow. Measured on /students @430px: documentElement said 645 while
// body said 430 and every ancestor of the table measured 430 — the page did
// not scroll sideways at all.
//
// And it does not merely assert "the page doesn't scroll horizontally". The
// admin shell's <main className="min-w-0 flex-1 overflow-x-hidden"> makes that
// true BY CONSTRUCTION, so such an assertion can never fail and would be
// worthless. What that clipping does not guarantee is that the clipped content
// is still reachable.
//
// So this classifies every element extending past the viewport by the nearest
// ancestor that manages overflow: `auto`/`scroll` means the user can scroll to
// it (fine), `hidden` means it is clipped with no way to reach it, and no such
// ancestor means it escapes the layout. Only text-bearing and interactive
// elements are considered, so decorative bleed does not trip it.
async function offscreenUnreachable(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const clipped: string[] = [];
    document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right <= vw + 1) return;
      const interactive = el.matches("a,button,input,select,textarea,[role=button],[tabindex]");
      const hasText = (el.textContent ?? "").trim().length > 0 && el.children.length === 0;
      if (!interactive && !hasText) return;
      let verdict = "escapes";
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll") { verdict = "scrollable"; break; }
        if (ox === "hidden") { verdict = "clipped"; break; }
      }
      if (verdict !== "scrollable") {
        clipped.push(`${verdict}: ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 45)} right=${Math.round(r.right)}`);
      }
    });
    return { bodyOverflow: document.body.scrollWidth - vw, clipped: [...new Set(clipped)].slice(0, 6) };
  });
}

test.describe("wave 3A — accessibility regressions", () => {
  test("account menu has an accessible name at phone width", async ({ browser }) => {
    const admin = await loginAsAdmin(browser);
    // 390px: below the `sm` (640px) breakpoint where the visible name appears.
    // Pre-fix the trigger was an icon-only button with no accessible name at
    // all (axe button-name, critical, on every admin surface).
    await admin.page.setViewportSize({ width: 390, height: 844 });
    await admin.page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    const trigger = admin.page.getByRole("button", { name: /account menu/i });
    await expect(trigger).toBeVisible();

    // It must actually open the menu holding Log out — i.e. the name belongs
    // to the real trigger, not a decorative element that merely matched.
    await trigger.click();
    await expect(admin.page.getByRole("menuitem", { name: /log out/i })).toBeVisible();

    await admin.context.close();
    await admin.api.dispose();
  });

  test("account menu is not double-named at desktop width", async ({ browser }) => {
    // Guards the other direction: the sr-only twin must drop at `sm` so the
    // trigger does not read "Eve Owner Eve Owner — account menu".
    const admin = await loginAsAdmin(browser);
    await admin.page.setViewportSize({ width: 1280, height: 900 });
    await admin.page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    // At >=sm the sr-only twin is dropped, so no button should carry the
    // "account menu" name; the visible personal name is the label instead.
    await expect(admin.page.getByRole("button", { name: /account menu/i })).toHaveCount(0);
    const trigger = admin.page.locator("header [aria-haspopup=menu]").last();
    await trigger.click();
    await expect(admin.page.getByRole("menuitem", { name: /log out/i })).toBeVisible();

    await admin.context.close();
    await admin.api.dispose();
  });

  test("finance term selectors are reachable by their visible label", async ({ browser }) => {
    // Pre-fix these were <label> elements with no htmlFor beside <select>
    // elements with no id — visually labelled, programmatically anonymous
    // (axe select-name, critical).
    const admin = await loginAsAdmin(browser);
    for (const path of ["/finance/dashboard", "/finance/debtors"]) {
      await admin.page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(admin.page.getByLabel("Academic year")).toBeVisible();
      await expect(admin.page.getByLabel("Term")).toBeVisible();
    }
    await admin.context.close();
    await admin.api.dispose();
  });

  test("fee-category dialog fields are reachable by label and typable", async ({ browser }) => {
    const admin = await loginAsAdmin(browser);
    await admin.page.goto("/finance/fees", { waitUntil: "domcontentloaded" });

    // Pre-fix this button's accessible name was the bare, ambiguous "New";
    // the slice gave it an sr-only suffix, so this selector also pins that.
    await admin.page.getByRole("button", { name: "New category" }).click();
    const name = admin.page.getByLabel("Name", { exact: true });
    await expect(name).toBeVisible();
    // Typing *through the label* proves the association is real, not cosmetic.
    await name.fill("Boarding Levy");
    await expect(name).toHaveValue("Boarding Levy");

    await admin.context.close();
    await admin.api.dispose();
  });

  test("discount radio groups expose their group name", async ({ browser }) => {
    // "Discount type" / "Applies to" / "Duration" were bare <label> elements
    // labelling nothing, so each radio announced only its own option text.
    const admin = await loginAsAdmin(browser);
    // A student must be picked before the assign form renders. Selecting via
    // getByLabel also exercises this slice's label association on that select.
    await admin.api.post("students", {
      data: {
        ...LONG,
        gender: "MALE",
        dateOfBirth: "2012-04-11",
        admissionNumber: `ADM/2026/DISC/${uniqueSuffix()}`,
      },
    });
    await admin.page.goto("/finance/discounts", { waitUntil: "domcontentloaded" });
    const student = admin.page.getByLabel("Student");
    await expect(student).toBeVisible();
    await student.selectOption({ index: 1 });
    await admin.page.getByRole("button", { name: /assign discount/i }).click();

    for (const group of ["Discount type", "Applies to", "Duration"]) {
      await expect(admin.page.getByRole("radiogroup", { name: group })).toBeVisible();
    }
    await admin.context.close();
    await admin.api.dispose();
  });

  test("password forms post rather than leaking credentials into the URL", async ({ browser }) => {
    // Without method="post" a submit landing before React hydrates falls back
    // to a native GET, putting the plaintext password in the address bar,
    // browser history and any referrer. Asserted against the rendered markup.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    for (const url of ["http://localhost:3001/login", `${PORTAL_BASE_URL}/login`]) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const form = page
        .locator("form")
        .filter({ has: page.locator("input[type=password]") })
        .first();
      await expect(form).toHaveAttribute("method", /post/i);
    }
    await ctx.close();
  });

  test("nav 'Coming soon' heading is not rendered at reduced opacity", async ({ browser }) => {
    // Was text-muted-foreground/70 => 2.81:1 on Paper (AA needs 4.5:1). The
    // /70 opacity modifier was the entire defect; full muted-foreground is
    // 5.22:1, so asserting the alpha channel pins the fix at its cause.
    const admin = await loginAsAdmin(browser);
    await admin.page.setViewportSize({ width: 1280, height: 900 });
    await admin.page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    const heading = admin.page.getByText("Coming soon", { exact: true }).first();
    await expect(heading).toBeVisible();
    const color = await heading.evaluate((el) => getComputedStyle(el).color);
    // rgba(...) with alpha < 1 is exactly what the /70 modifier produced.
    expect(color).not.toMatch(/rgba\([^)]*,\s*0?\.\d+\s*\)/);

    await admin.context.close();
    await admin.api.dispose();
  });

  test("finance selectors are operable by keyboard alone", async ({ browser }) => {
    const admin = await loginAsAdmin(browser);
    await admin.page.goto("/finance/dashboard", { waitUntil: "domcontentloaded" });

    const year = admin.page.getByLabel("Academic year");
    await year.focus();
    await expect(year).toBeFocused();
    // Tab must reach the adjacent Term selector without a mouse.
    await admin.page.keyboard.press("Tab");
    await expect(admin.page.getByLabel("Term")).toBeFocused();

    await admin.context.close();
    await admin.api.dispose();
  });

  test("every finance sub-nav tab stays reachable at tablet width", async ({ browser }) => {
    // The seven finance tabs are wider than a 768px viewport. Pre-fix the strip
    // was a plain flex row that neither wrapped nor scrolled, so the trailing
    // tabs were clipped by the shell's `overflow-x-hidden` <main>: invisible,
    // unclickable, and impossible for a user to scroll to — yet still
    // keyboard-focusable into off-screen space.
    //
    // NOTE ON METHOD: Playwright's scrollIntoViewIfNeeded() does NOT prove
    // reachability here and an earlier version of this test passed against the
    // broken code because of it. `overflow-x: hidden` still creates a scroll
    // container that can be scrolled PROGRAMMATICALLY (scrollLeft is settable)
    // while offering the user no scrollbar and no gesture. So this asserts the
    // structural property instead: whenever the strip is wider than its
    // scrollport, that scrollport must be genuinely user-scrollable.
    const admin = await loginAsAdmin(browser);
    await admin.page.setViewportSize({ width: 768, height: 1024 });
    await admin.page.goto("/finance/invoices", { waitUntil: "domcontentloaded" });

    const tabs = admin.page.getByRole("navigation", { name: /finance/i }).getByRole("link");
    // Wait for the strip to render before counting — a bare count() races the
    // client-side render and silently sees zero.
    await expect(tabs.first()).toBeVisible();
    const count = await tabs.count();
    expect(count).toBeGreaterThan(3);

    const strip = await admin.page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>('nav[aria-label="Finance sections"]');
      if (!nav) return null;
      const overflows = nav.scrollWidth > nav.clientWidth + 1;
      // Walk up for the first ancestor (nav included) that manages overflow-x.
      let owner: HTMLElement | null = nav;
      let mode = "none";
      while (owner) {
        const ox = getComputedStyle(owner).overflowX;
        if (ox !== "visible") { mode = ox; break; }
        owner = owner.parentElement;
      }
      return { overflows, mode, scrollWidth: nav.scrollWidth, clientWidth: nav.clientWidth };
    });
    expect(strip).not.toBeNull();
    // The strip is expected to be wider than 768px — that is the whole premise.
    expect(strip!.overflows, `strip did not overflow (${strip!.scrollWidth} vs ${strip!.clientWidth}); premise no longer holds`).toBe(true);
    // ...and the container that owns that overflow must let the user scroll.
    expect(["auto", "scroll"], `overflow-x resolved to "${strip!.mode}" — clipped, not scrollable`).toContain(strip!.mode);

    await admin.context.close();
    await admin.api.dispose();
  });
});

test.describe("wave 3A — responsive regressions", () => {
  test("admin surfaces do not overflow horizontally with long Nigerian names", async ({ browser }) => {
    test.setTimeout(10 * 60 * 1000);
    const admin = await loginAsAdmin(browser);
    await admin.api.post("students", {
      data: {
        ...LONG,
        gender: "MALE",
        dateOfBirth: "2012-04-11",
        admissionNumber: `ADM/2026/WIDE/${uniqueSuffix()}`,
      },
    });

    for (const path of ["/students", "/finance/invoices", "/settings/users"]) {
      for (const vp of VIEWPORTS) {
        await admin.page.setViewportSize({ width: vp.width, height: vp.height });
        await admin.page.goto(path, { waitUntil: "domcontentloaded" });
        await admin.page.waitForTimeout(1200);
        const { bodyOverflow, clipped } = await offscreenUnreachable(admin.page);
        expect(clipped, `${path} @${vp.name}px: ${clipped.join(" ~ ")}`).toEqual([]);
        expect(bodyOverflow, `${path} @${vp.name}px body overflowed by ${bodyOverflow}px`).toBeLessThanOrEqual(1);
      }
    }
    await admin.context.close();
    await admin.api.dispose();
  });

  test("guardian portal login does not overflow at any audited width", async ({ browser }) => {
    test.setTimeout(10 * 60 * 1000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${PORTAL_BASE_URL}/login`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(800);
      const { bodyOverflow, clipped } = await offscreenUnreachable(page);
      expect(clipped, `portal login @${vp.name}px: ${clipped.join(" ~ ")}`).toEqual([]);
      expect(bodyOverflow, `portal login @${vp.name}px body overflowed by ${bodyOverflow}px`).toBeLessThanOrEqual(1);
    }
    await ctx.close();
  });

  test("guardian portal home does not overflow with a real signed-in guardian", async ({ browser }) => {
    test.setTimeout(10 * 60 * 1000);
    const admin = await loginAsAdmin(browser);
    const g = await createPortalGuardian(admin.api, {
      suffix: uniqueSuffix(),
      schoolId: admin.schoolId,
    });

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${PORTAL_BASE_URL}/login`, { waitUntil: "load" });
    // Next dev-mode hydration is slow; without this the click fires against
    // the server-rendered form before React attaches onSubmit.
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2500);
    await page.getByLabel(/email/i).fill(g.email);
    await page.getByLabel(/password/i).fill(g.password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${PORTAL_BASE_URL}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      const { bodyOverflow, clipped } = await offscreenUnreachable(page);
      expect(clipped, `portal home @${vp.name}px: ${clipped.join(" ~ ")}`).toEqual([]);
      expect(bodyOverflow, `portal home @${vp.name}px body overflowed by ${bodyOverflow}px`).toBeLessThanOrEqual(1);
    }

    await ctx.close();
    await admin.context.close();
    await admin.api.dispose();
  });
});
