import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin, uniqueSuffix } from "../fixtures/index.js";
import {
  PORTAL_BASE_URL,
  createPortalGuardian,
  liveResetTokenCount,
  mintResetToken,
  sessionCount,
  type PortalGuardian,
} from "../fixtures/guardian.js";

// Guardian authentication and recovery, end to end in a real browser.
//
// The guardian portal had NO browser coverage before this file — this
// harness only ever booted api + web. That is part of why a login screen
// carried a dead "You're signed in / Continue" interstitial through two
// slices (F-13) and why the portal shipped with no way to sign out and no
// password recovery at all (F-06).
//
// SAFETY: every test provisions its own school via loginAsAdmin (fresh
// signup, unique slug) against the LOCAL docker Postgres. No real guardian
// account is touched.
//
// Portal URLs are absolute — playwright.config.ts's baseURL is the STAFF app
// on :3001, and keeping portal navigation explicit means the two apps can
// never be confused for one another in a test.

async function scaffold(browser: Parameters<typeof loginAsAdmin>[0]) {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const guardian = await createPortalGuardian(admin.api, {
    suffix,
    schoolId: admin.schoolId,
  });
  // A clean browser context: no staff cookie, nothing pre-authenticated.
  const context = await browser.newContext();
  const page = await context.newPage();
  return { admin, guardian, context, page };
}

async function signIn(page: Page, guardian: PortalGuardian): Promise<void> {
  await page.goto(`${PORTAL_BASE_URL}/login`);
  await page.getByLabel("Email").fill(guardian.email);
  await page.getByLabel("Password", { exact: true }).fill(guardian.password);
  await page.getByRole("button", { name: "Log in" }).click();
  // WAIT for the landing before returning. Login finishes with a full
  // document replace, so a caller that navigates immediately would race the
  // cookie being set and get bounced to /login by middleware.
  await expect(page.getByRole("heading", { name: "Your children" })).toBeVisible();
  // ...and wait for the CHILD to render, not just the heading. The heading is
  // in the static shell and appears before React has hydrated; the list only
  // renders after the client fetch resolves, which cannot happen until the
  // component is live. Without this barrier a subsequent .click() can land on
  // a button whose onClick is not attached yet — the click "succeeds",
  // nothing happens, and the failure looks like a broken feature rather than
  // a race. That is exactly how the sign-out specs failed in CI: the runs
  // that failed show NO POST /api/portal/logout at all.
  await expect(page.getByText(guardian.studentFirstName).first()).toBeVisible();
}

/**
 * Click Sign out and wait for the return to the login screen.
 *
 * Waits for the page to settle first, for the hydration reason described in
 * signIn — every caller of this helper reaches it straight after a
 * navigation.
 */
async function signOut(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: "Sign out" });
  await expect(button).toBeEnabled();
  await page.waitForLoadState("networkidle");
  await Promise.all([
    page.waitForURL(new RegExp("/login"), { timeout: 30_000 }),
    button.click(),
  ]);
}

// Alerts inside the page content only.
//
// getByRole("alert") on its own is a strict-mode violation in a Next.js app:
// the App Router injects <div role="alert" id="__next-route-announcer__">
// into every page for screen-reader route announcements, so the role always
// matches at least two elements. Scoping to <main> excludes it.
function pageAlert(page: Page) {
  return page.locator("main").getByRole("alert");
}

test.describe("guardian login (F-13)", () => {
  test("a successful login lands DIRECTLY on the children list — no interstitial", async ({
    browser,
  }) => {
    const { admin, guardian, context, page } = await scaffold(browser);

    await signIn(page, guardian);

    // Straight to the destination. The old build stopped here on a
    // "You're signed in" screen with a "Continue" link.
    await expect(page.getByRole("heading", { name: "Your children" })).toBeVisible();
    await expect(page).toHaveURL(`${PORTAL_BASE_URL}/`);
    await expect(page.getByText("You're signed in")).toBeHidden();
    await expect(page.getByRole("link", { name: "Continue" })).toBeHidden();

    // And the child is actually there.
    await expect(page.getByText(guardian.studentFirstName).first()).toBeVisible();

    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });

  test("a failed login stays on the form with a clear message and no session", async ({
    browser,
  }) => {
    const { admin, guardian, context, page } = await scaffold(browser);

    await page.goto(`${PORTAL_BASE_URL}/login`);
    await page.getByLabel("Email").fill(guardian.email);
    await page.getByLabel("Password", { exact: true }).fill("Wrong-Password-1!");
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(pageAlert(page)).toContainText(/Invalid email or password/i);
    await expect(page).toHaveURL(new RegExp("/login"));
    await expect(page.getByRole("heading", { name: "Your children" })).toBeHidden();
    expect(await sessionCount(guardian.schoolId, guardian.guardianId)).toBe(0);

    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });

  test("the password can be revealed and re-hidden, by keyboard", async ({ browser }) => {
    const { admin, guardian, context, page } = await scaffold(browser);
    await page.goto(`${PORTAL_BASE_URL}/login`);

    const password = page.getByLabel("Password", { exact: true });
    await password.fill(guardian.password);
    await expect(password).toHaveAttribute("type", "password");

    // Reached and activated by keyboard alone — it is a real <button>.
    const toggle = page.getByRole("button", { name: "Show" });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(password).toHaveAttribute("type", "text");
    await expect(page.getByRole("button", { name: "Hide" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.getByRole("button", { name: "Hide" }).click();
    await expect(password).toHaveAttribute("type", "password");

    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });

  test("a protected page deep-link returns the guardian there after signing in", async ({
    browser,
  }) => {
    const { admin, guardian, context, page } = await scaffold(browser);

    // Straight to a child's page while signed out.
    const target = `/students/${guardian.studentId}`;
    await page.goto(`${PORTAL_BASE_URL}${target}`);

    // Middleware bounces to login and remembers where they were going.
    await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(target)}`));

    await page.getByLabel("Email").fill(guardian.email);
    await page.getByLabel("Password", { exact: true }).fill(guardian.password);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page).toHaveURL(`${PORTAL_BASE_URL}${target}`);

    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });

  test("an off-site next= parameter is refused (open-redirect guard)", async ({ browser }) => {
    const { admin, guardian, context, page } = await scaffold(browser);

    await page.goto(`${PORTAL_BASE_URL}/login?next=https://evil.example/phish`);
    await page.getByLabel("Email").fill(guardian.email);
    await page.getByLabel("Password", { exact: true }).fill(guardian.password);
    await page.getByRole("button", { name: "Log in" }).click();

    // Lands on the portal home, never on the attacker's origin.
    await expect(page).toHaveURL(`${PORTAL_BASE_URL}/`);
    expect(page.url()).not.toContain("evil.example");

    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });

  test("the login form is usable at a narrow phone width", async ({ browser }) => {
    const { admin, guardian, context, page } = await scaffold(browser);
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(`${PORTAL_BASE_URL}/login`);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "no horizontal page overflow at 360px").toBeLessThanOrEqual(1);

    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Forgot password?" })).toBeVisible();

    await signIn(page, guardian);
    await expect(page.getByRole("heading", { name: "Your children" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });
});

test.describe("guardian logout (F-06)", () => {
  test("Sign out is reachable from the home page AND a child's page", async ({ browser }) => {
    const { admin, guardian, context, page } = await scaffold(browser);
    await signIn(page, guardian);

    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    await page.goto(`${PORTAL_BASE_URL}/students/${guardian.studentId}`);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });

  test("signing out destroys the session, returns to login, and blocks protected routes", async ({
    browser,
  }) => {
    const { admin, guardian, context, page } = await scaffold(browser);
    await signIn(page, guardian);
    // Exactly one: the fixture clears the session that accepting the
    // invitation created, so this is the session THIS test just made.
    expect(await sessionCount(guardian.schoolId, guardian.guardianId)).toBe(1);

    await signOut(page);
    await expect(page).toHaveURL(new RegExp("/login"));
    // Destroyed server-side, not merely forgotten by the browser.
    expect(await sessionCount(guardian.schoolId, guardian.guardianId)).toBe(0);

    // The cookie is gone too.
    const cookies = await context.cookies(PORTAL_BASE_URL);
    const session = cookies.find((c) => c.name === "sk_portal_session");
    expect(session?.value ?? "").toBe("");

    // A protected route is now refused rather than rendered.
    await page.goto(`${PORTAL_BASE_URL}/students/${guardian.studentId}`);
    await expect(page).toHaveURL(new RegExp("/login"));
    await expect(page.getByText(guardian.studentFirstName)).toBeHidden();

    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });

  test("Back after signing out does NOT expose the authenticated page", async ({
    browser,
  }) => {
    // The shared-device case: a parent signs out on a school computer and the
    // next person presses Back.
    const { admin, guardian, context, page } = await scaffold(browser);
    await signIn(page, guardian);
    await page.goto(`${PORTAL_BASE_URL}/students/${guardian.studentId}`);
    await expect(page.getByText(guardian.studentFirstName).first()).toBeVisible();

    await signOut(page);

    await page.goBack();
    await page.waitForLoadState("networkidle");

    // Whatever the browser restores, the child's data must not be on screen.
    await expect(page.getByText(guardian.studentFirstName)).toBeHidden();
    await expect(page).toHaveURL(new RegExp("/login"));

    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });

  test("signing out on one device leaves another device signed in", async ({ browser }) => {
    const { admin, guardian, context, page } = await scaffold(browser);
    await signIn(page, guardian);

    // A second, independent context = a second device.
    const phone = await browser.newContext();
    const phonePage = await phone.newPage();
    await signIn(phonePage, guardian);
    await expect(phonePage.getByRole("heading", { name: "Your children" })).toBeVisible();
    expect(await sessionCount(guardian.schoolId, guardian.guardianId)).toBe(2);

    await signOut(page);
    await expect(page).toHaveURL(new RegExp("/login"));

    // The phone is untouched — signing out of a shared computer must not
    // sign a parent out of their own phone.
    expect(await sessionCount(guardian.schoolId, guardian.guardianId)).toBe(1);
    await phonePage.reload();
    await expect(phonePage.getByRole("heading", { name: "Your children" })).toBeVisible();

    await phone.close();
    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });
});

test.describe("guardian password recovery (F-06)", () => {
  test("Forgot password is reachable from login and acknowledges without leaking existence", async ({
    browser,
  }) => {
    const { admin, guardian, context, page } = await scaffold(browser);

    await page.goto(`${PORTAL_BASE_URL}/login`);
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(`${PORTAL_BASE_URL}/forgot-password`);

    // A REAL address.
    await page.getByLabel("Email").fill(guardian.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    const realCopy = await page.locator("main").textContent();

    // A token really was issued — the browser flow reached the endpoint.
    expect(await liveResetTokenCount(guardian.schoolId, guardian.guardianId)).toBe(1);

    // An address with NO account at all.
    await page.goto(`${PORTAL_BASE_URL}/forgot-password`);
    await page.getByLabel("Email").fill(`nobody-${uniqueSuffix()}@school-kit.test`);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    const unknownCopy = await page.locator("main").textContent();

    // Identical screens. This is the enumeration guard, in the UI.
    expect(unknownCopy).toBe(realCopy);
    expect(realCopy).toContain("If an account exists");

    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });

  test("a valid link sets a new password, which then works for signing in", async ({
    browser,
  }) => {
    const { admin, guardian, context, page } = await scaffold(browser);
    const rawToken = await mintResetToken(guardian.schoolId, guardian.guardianId);
    const newPassword = "Brand-New-Pass-1!";

    await page.goto(`${PORTAL_BASE_URL}/reset-password/${rawToken}`);
    await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
    // The page must not name whose account this is — the token is public
    // input and echoing an identity would disclose it.
    await expect(page.getByText(guardian.firstName)).toBeHidden();

    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Confirm new password").fill(newPassword);
    await page.getByRole("button", { name: "Set new password" }).click();

    await expect(page.getByRole("heading", { name: "Password updated" })).toBeVisible();

    // No auto-login — the convention staff reset established.
    expect(await sessionCount(guardian.schoolId, guardian.guardianId)).toBe(0);

    await page.getByRole("link", { name: "Go to sign in" }).click();
    await page.getByLabel("Email").fill(guardian.email);
    await page.getByLabel("Password", { exact: true }).fill(newPassword);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("heading", { name: "Your children" })).toBeVisible();

    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });

  test("mismatched confirmation is caught before anything is submitted", async ({
    browser,
  }) => {
    const { admin, guardian, context, page } = await scaffold(browser);
    const rawToken = await mintResetToken(guardian.schoolId, guardian.guardianId);

    await page.goto(`${PORTAL_BASE_URL}/reset-password/${rawToken}`);
    await page.getByLabel("New password", { exact: true }).fill("Brand-New-Pass-1!");
    await page.getByLabel("Confirm new password").fill("Different-Pass-2!");
    await page.getByRole("button", { name: "Set new password" }).click();

    await expect(page.getByText("Passwords do not match")).toBeVisible();
    // Still live — nothing was consumed.
    expect(await liveResetTokenCount(guardian.schoolId, guardian.guardianId)).toBe(1);

    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });

  test("a weak password is refused with the rule stated", async ({ browser }) => {
    const { admin, guardian, context, page } = await scaffold(browser);
    const rawToken = await mintResetToken(guardian.schoolId, guardian.guardianId);

    await page.goto(`${PORTAL_BASE_URL}/reset-password/${rawToken}`);
    // The rules are on screen BEFORE anything is typed.
    await expect(page.getByText(/At least 8 characters/)).toBeVisible();

    await page.getByLabel("New password", { exact: true }).fill("short");
    await page.getByLabel("Confirm new password").fill("short");
    await page.getByRole("button", { name: "Set new password" }).click();

    await expect(page.getByText(/at least 8 characters/i).first()).toBeVisible();
    expect(await liveResetTokenCount(guardian.schoolId, guardian.guardianId)).toBe(1);

    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });

  test("a used link cannot be used again, and offers a way to request a new one", async ({
    browser,
  }) => {
    const { admin, guardian, context, page } = await scaffold(browser);
    const rawToken = await mintResetToken(guardian.schoolId, guardian.guardianId);

    await page.goto(`${PORTAL_BASE_URL}/reset-password/${rawToken}`);
    await page.getByLabel("New password", { exact: true }).fill("Brand-New-Pass-1!");
    await page.getByLabel("Confirm new password").fill("Brand-New-Pass-1!");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByRole("heading", { name: "Password updated" })).toBeVisible();

    // Same link again — e.g. the parent taps it twice in their inbox.
    await page.goto(`${PORTAL_BASE_URL}/reset-password/${rawToken}`);
    await page.getByLabel("New password", { exact: true }).fill("Attacker-Pass-3!");
    await page.getByLabel("Confirm new password").fill("Attacker-Pass-3!");
    await page.getByRole("button", { name: "Set new password" }).click();

    await expect(pageAlert(page)).toContainText(/already been used/i);
    await expect(page.getByRole("link", { name: "Request a new reset link" })).toBeVisible();

    // And the second password never took effect.
    await page.goto(`${PORTAL_BASE_URL}/login`);
    await page.getByLabel("Email").fill(guardian.email);
    await page.getByLabel("Password", { exact: true }).fill("Attacker-Pass-3!");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(pageAlert(page)).toContainText(/Invalid email or password/i);

    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });

  test("an expired link fails clearly and distinctly from an invalid one", async ({
    browser,
  }) => {
    const { admin, guardian, context, page } = await scaffold(browser);
    const expired = await mintResetToken(guardian.schoolId, guardian.guardianId, -1000);

    await page.goto(`${PORTAL_BASE_URL}/reset-password/${expired}`);
    await page.getByLabel("New password", { exact: true }).fill("Brand-New-Pass-1!");
    await page.getByLabel("Confirm new password").fill("Brand-New-Pass-1!");
    await page.getByRole("button", { name: "Set new password" }).click();

    await expect(pageAlert(page)).toContainText(/expired/i);

    // A garbage token says something DIFFERENT — the two failures are not
    // collapsed into one unhelpful "invalid".
    await page.goto(`${PORTAL_BASE_URL}/reset-password/not-a-real-token`);
    await page.getByLabel("New password", { exact: true }).fill("Brand-New-Pass-1!");
    await page.getByLabel("Confirm new password").fill("Brand-New-Pass-1!");
    await page.getByRole("button", { name: "Set new password" }).click();

    const alert = pageAlert(page);
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText(/expired/i);

    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });

  test("a completed reset signs the guardian out everywhere", async ({ browser }) => {
    const { admin, guardian, context, page } = await scaffold(browser);
    await signIn(page, guardian);
    await expect(page.getByRole("heading", { name: "Your children" })).toBeVisible();
    expect(await sessionCount(guardian.schoolId, guardian.guardianId)).toBe(1);

    // Reset from a different browser context, as if from a phone.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    const rawToken = await mintResetToken(guardian.schoolId, guardian.guardianId);
    await otherPage.goto(`${PORTAL_BASE_URL}/reset-password/${rawToken}`);
    await otherPage.getByLabel("New password", { exact: true }).fill("Brand-New-Pass-1!");
    await otherPage.getByLabel("Confirm new password").fill("Brand-New-Pass-1!");
    await otherPage.getByRole("button", { name: "Set new password" }).click();
    await expect(otherPage.getByRole("heading", { name: "Password updated" })).toBeVisible();

    // The original session is gone — this is what a parent does when they
    // think someone else is in their account.
    expect(await sessionCount(guardian.schoolId, guardian.guardianId)).toBe(0);
    await page.goto(`${PORTAL_BASE_URL}/`);
    await expect(page).toHaveURL(new RegExp("/login"));

    await other.close();
    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });
});
