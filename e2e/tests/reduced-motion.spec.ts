import { expect, test, type BrowserContext } from "@playwright/test";

import { loginAsAdmin } from "../fixtures/index.js";

// prefers-reduced-motion is honoured (look-and-feel.md D6).
//
// D6's wording is "respect prefers-reduced-motion, AND MEAN IT", so this
// asserts the computed animation rather than the presence of a class. The
// failure mode it guards is specific and easy to reach: Tailwind's
// `motion-reduce:` variant only wins if it comes later in the stylesheet than
// the animation it is cancelling, and `animate-settle` is a custom keyframe
// added to the theme rather than one of tailwindcss-animate's. A class list
// that looks right can still animate for someone who asked for no motion, and
// only the browser can say.
//
// It also asserts the animation IS there without the preference — a spec that
// only checks the "off" state passes just as happily when the motion was never
// implemented.
test("route transitions animate normally, and not at all under reduced motion", async ({
  browser,
}) => {
  const toClose: BrowserContext[] = [];
  try {
    const admin = await loginAsAdmin(browser);
    toClose.push(admin.context);
    const page = admin.page;

    // The (admin) template wrapper carries the route transition. Located by
    // its own attribute rather than by position: <main>'s first child is the
    // calendar-setup prompt's wrapper, so "main > div" would silently assert
    // against an element that never animates — and the whole point of this
    // spec is that a plausible-looking check is not proof.
    const transition = page.locator("[data-route-transition]").first();

    await page.goto("/students");
    await expect(page.getByRole("heading", { name: "Students" })).toBeVisible();

    const animated = await transition.evaluate((el) => getComputedStyle(el).animationName);
    expect(animated).not.toBe("none");

    await page.emulateMedia({ reducedMotion: "reduce" });
    // A fresh navigation, because the declaration is evaluated per element and
    // this one is remounted on every route change.
    await page.goto("/students");
    await expect(page.getByRole("heading", { name: "Students" })).toBeVisible();

    const reduced = await transition.evaluate((el) => getComputedStyle(el).animationName);
    expect(reduced).toBe("none");
  } finally {
    await Promise.all(toClose.map((c) => c.close()));
  }
});
