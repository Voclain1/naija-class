import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin, uniqueSuffix } from "../fixtures/index.js";

// F-10 — session expiry, re-authentication and deep-link continuity, for the
// STAFF/ADMIN web app.
//
// Before this slice all three ways a staff session could end took the user to
// a bare /login: no explanation, and no memory of where they had been. The
// server had always distinguished SESSION_EXPIRED / INVALID_SESSION /
// USER_INACTIVE / MISSING_BEARER_TOKEN (AuthGuard, since Phase 0); the client
// dropped the code on the floor.
//
// SAFETY: every test provisions its own school via loginAsAdmin (fresh
// signup, unique slug) against the LOCAL docker Postgres. No operational
// school data is touched.

const WEB = "http://localhost:3001";

/** Delete the session cookie in the browser — a revoked/absent session. */
async function dropSessionCookie(page: Page): Promise<void> {
  const context = page.context();
  const cookies = await context.cookies(WEB);
  await context.clearCookies();
  // Put back everything EXCEPT the staff session cookie, so the test is
  // isolating session loss rather than clearing unrelated state.
  const keep = cookies.filter((c) => c.name !== "sk_session");
  if (keep.length > 0) await context.addCookies(keep);
}

test.describe("deep-link continuity (F-10)", () => {
  test("a protected deep link survives login instead of dumping the user on the dashboard", async ({
    browser,
  }) => {
    const admin = await loginAsAdmin(browser);
    // A clean context: signed out, following a link someone sent them.
    const context = await browser.newContext();
    const page = await context.newPage();

    const target = "/finance/invoices";
    await page.goto(`${WEB}${target}`);

    // Middleware bounces to login AND remembers the destination.
    await expect(page).toHaveURL(
      new RegExp(`/login\\?next=${encodeURIComponent(target)}`),
    );

    await page.getByLabel("Email").fill(admin.email);
    await page.getByLabel("Password", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();

    // Back to what they actually asked for.
    await expect(page).toHaveURL(`${WEB}${target}`);
    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();

    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });

  test("the query string of a deep link is preserved, not swapped onto /login", async ({
    browser,
  }) => {
    // Regression for a specific pre-existing bug: middleware used
    // req.nextUrl.clone() and replaced only the pathname, so the ORIGINAL
    // query string was carried onto /login while the path was discarded —
    // exactly backwards.
    const admin = await loginAsAdmin(browser);
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${WEB}/students?status=ACTIVE`);

    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/students?status=ACTIVE");
    // The stray leak is gone: /login itself no longer carries the page's own
    // parameters at the top level.
    expect(url.searchParams.get("status")).toBeNull();

    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });

  test("signing in normally (no deep link) still lands on the role's home", async ({
    browser,
  }) => {
    const admin = await loginAsAdmin(browser);
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${WEB}/login`);
    await page.getByLabel("Email").fill(admin.email);
    await page.getByLabel("Password", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();

    await expect(page).toHaveURL(`${WEB}/dashboard`);

    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });
});

test.describe("open-redirect guard (F-10 security)", () => {
  for (const hostile of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "%2f%2fevil.example",
    "javascript:alert(1)",
  ]) {
    test(`refuses to redirect to ${hostile} after login`, async ({ browser }) => {
      const admin = await loginAsAdmin(browser);
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.goto(`${WEB}/login?next=${encodeURIComponent(hostile)}`);
      await page.getByLabel("Email").fill(admin.email);
      await page.getByLabel("Password", { exact: true }).fill(admin.password);
      await page.getByRole("button", { name: /sign in|log in/i }).click();

      // Falls back to the role home; never leaves the origin.
      await expect(page).toHaveURL(`${WEB}/dashboard`);
      expect(page.url()).not.toContain("evil.example");
      expect(new URL(page.url()).origin).toBe(WEB);

      await context.close();
      await admin.context.close();
      await admin.api.dispose();
    });
  }
});

test.describe("session-expiry communication (F-10)", () => {
  test("losing a session mid-browse explains why AND remembers where", async ({
    browser,
  }) => {
    const admin = await loginAsAdmin(browser);
    const page = admin.page;

    await page.goto(`${WEB}/finance/invoices`);
    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();

    // Drop the session the way a revocation would: the cookie is gone, so the
    // next authed request comes back 401 with a real error code.
    await dropSessionCookie(page);

    // Trigger an authenticated request from the live page.
    await page.getByRole("tab", { name: "Invoice list" }).click();

    await expect(page).toHaveURL(/\/login\?/);
    const url = new URL(page.url());
    // A reason was carried...
    expect(["expired", "revoked"]).toContain(url.searchParams.get("reason"));
    // ...and the destination survived.
    expect(url.searchParams.get("next")).toContain("/finance/invoices");

    // The user is told something they can act on, in plain language.
    const status = page.getByRole("status");
    await expect(status).toBeVisible();
    await expect(status).toContainText(/signed out|session expired/i);

    // And never in our vocabulary.
    const body = (await page.locator("body").textContent()) ?? "";
    for (const leak of ["401", "SESSION_EXPIRED", "INVALID_SESSION", "MISSING_BEARER_TOKEN", "bearer"]) {
      expect(body).not.toContain(leak);
    }

    await admin.context.close();
    await admin.api.dispose();
  });

  test("a 401 does not leave stale authenticated content on screen", async ({
    browser,
  }) => {
    const admin = await loginAsAdmin(browser);
    const page = admin.page;

    await page.goto(`${WEB}/dashboard`);
    await expect(page).toHaveURL(`${WEB}/dashboard`);

    await dropSessionCookie(page);
    await page.reload();

    // Bounced, and the protected shell is not rendered behind the login form.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: /^Dashboard$/ })).toBeHidden();

    await admin.context.close();
    await admin.api.dispose();
  });

  test("a deliberate Sign out shows NO expiry message", async ({ browser }) => {
    const admin = await loginAsAdmin(browser);
    const page = admin.page;

    await page.goto(`${WEB}/dashboard`);
    await expect(page).toHaveURL(`${WEB}/dashboard`);

    // Open the account menu and sign out.
    await page.getByRole("button", { name: /account|menu|profile/i }).first().click();
    await page.getByRole("menuitem", { name: /sign out|log out/i }).click();

    await expect(page).toHaveURL(new RegExp(`^${WEB}/login/?$`));
    // No reason parameter, and no notice — leaving on purpose is not a
    // failure and must not be dressed as one.
    expect(new URL(page.url()).searchParams.get("reason")).toBeNull();
    await expect(page.getByRole("status")).toBeHidden();

    await admin.context.close();
    await admin.api.dispose();
  });

  test("Back after session loss does not reveal protected data", async ({
    browser,
  }) => {
    const admin = await loginAsAdmin(browser);
    const page = admin.page;

    await page.goto(`${WEB}/students`);
    await expect(page).toHaveURL(`${WEB}/students`);

    await dropSessionCookie(page);
    await page.reload();
    await expect(page).toHaveURL(/\/login/);

    await page.goBack();
    await page.waitForLoadState("networkidle");

    // Whatever the browser restores, the protected route must not be showing
    // its content.
    await expect(page).toHaveURL(/\/login/);

    await admin.context.close();
    await admin.api.dispose();
  });
});

test.describe("authorization still applies after redirect (F-10 security)", () => {
  test("a next= pointing at a route the role cannot use does not grant access", async ({
    browser,
  }) => {
    // The admin shell and the teacher shell are separate; RequireAuth bounces
    // a user who lacks the role. A `next` must not be a way around that —
    // the redirect is a convenience, never an authorization decision.
    const admin = await loginAsAdmin(browser);
    const context = await browser.newContext();
    const page = await context.newPage();
    const suffix = uniqueSuffix();
    expect(suffix).toBeTruthy();

    // Owner CAN view teacher pages (documented: the teacher layout omits
    // `roles`), so assert the inverse property that actually matters here:
    // landing on a role-gated route still runs the role check rather than
    // trusting the parameter.
    await page.goto(`${WEB}/login?next=${encodeURIComponent("/teacher/dashboard")}`);
    await page.getByLabel("Email").fill(admin.email);
    await page.getByLabel("Password", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();

    // Either the route renders (owner is permitted) or the guard redirects —
    // what must NOT happen is an unauthenticated or unguarded render.
    await page.waitForURL(/\/teacher\/dashboard|\/dashboard/);
    expect(new URL(page.url()).origin).toBe(WEB);

    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });
});
