import { expect, test } from "@playwright/test";

// The brand typeface is actually USED (docs/modules/look-and-feel.md).
//
// This exists because of a bug that was invisible to every other kind of
// check, and shipped to production for months:
//
//   globals.css declared `--font-sans: var(--font-dm-sans)` on :root, while
//   next/font defines --font-dm-sans through a class it puts on <body>. At
//   :root that variable does not exist, so the token resolved to EMPTY — and
//   `font-family: , ui-sans-serif, ...` is a parse error, so the browser threw
//   the entire declaration away and used its default serif.
//
// Everything looked right from the outside. The fonts downloaded, the CSS
// shipped, the tokens were in the stylesheet, typecheck and lint passed, and
// the pages rendered. app.schoolkit.ng was simply in Times New Roman, and the
// only way to know was to ask the browser what it had actually used.
//
// So this spec asserts the COMPUTED font, not the presence of a class or a
// variable. Asserting the stylesheet would have passed throughout the bug.

const EXPECTED_SANS = /DM Sans/i;
const EXPECTED_SERIF = /DM Serif Display/i;

test.describe("typography actually applies", () => {
  test("the staff app renders in the brand sans, not a browser default", async ({ page }) => {
    await page.goto("/login");
    const body = await page.evaluate(() => getComputedStyle(document.body).fontFamily);

    expect(body).toMatch(EXPECTED_SANS);
    // Named explicitly: Times is the specific failure this guards, and seeing
    // it in a diff should be unmistakable.
    expect(body).not.toMatch(/Times New Roman/i);
  });

  test("a serif heading uses the display face, not the body face", async ({ page }) => {
    await page.goto("/login");
    // The sign-in card's title is the one serif element on a public page.
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible();
    const font = await heading.evaluate((el) => getComputedStyle(el).fontFamily);

    // A page where BOTH resolve to the same family is the other way this
    // breaks: the serif token empty while the sans one works.
    expect(font).toMatch(EXPECTED_SERIF);
  });

  test("the token is readable where the font class lives", async ({ page }) => {
    await page.goto("/login");
    const tokens = await page.evaluate(() => ({
      sans: getComputedStyle(document.body).getPropertyValue("--font-sans").trim(),
      serif: getComputedStyle(document.body).getPropertyValue("--font-serif").trim(),
    }));

    // Empty is the exact state that produced Times New Roman: a declaration
    // that parses to nothing takes its fallbacks down with it.
    expect(tokens.sans).not.toBe("");
    expect(tokens.serif).not.toBe("");
  });
});
