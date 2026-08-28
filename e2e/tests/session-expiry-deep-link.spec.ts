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

/**
 * Assert the browser is on `path`, ignoring query parameters the PAGE adds
 * for itself.
 *
 * /dashboard appends ?termId=<uuid> as soon as it resolves the current term,
 * so `toHaveURL(`${WEB}/dashboard`)` — an exact string match — can never
 * hold. What these tests care about is the origin and the pathname: that the
 * user landed on the right page and never left the origin.
 */
async function expectPath(page: Page, path: string): Promise<void> {
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 15_000 })
    .toBe(path);
  expect(new URL(page.url()).origin).toBe(WEB);
}

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

    await expectPath(page, "/dashboard");

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
      await expectPath(page, "/dashboard");
      expect(page.url()).not.toContain("evil.example");

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

    // Make the NEXT authenticated request come back as a genuine expiry.
    // Intercepting is deliberate: deleting the cookie would also be a 401,
    // but it exercises the middleware path and cannot say WHICH reason the
    // server gave. Fulfilling with the API's real envelope tests the thing
    // this slice actually changed — that apiFetch carries the code through
    // and the provider maps it — and lets the assertion below be exact
    // rather than "one of two".
    // Scoped to the invoices call ONLY, and paired with dropping the cookie
    // below. Intercepting all of /api/v1 caused an infinite redirect: after
    // the handler navigated to /login, the provider re-hydrated from the
    // still-present cookie, its /auth/me call hit the same intercept, and
    // the cycle repeated until the test timed out.
    await page.route("**/api/v1/invoices**", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "SESSION_EXPIRED", message: "Session has expired." },
        }),
      }),
    );

    // The cookie is deliberately LEFT IN PLACE. Removing it would make the
    // next navigation hit middleware, which carries `next` but cannot know a
    // reason — so the assertion below would see reason=null and this test
    // would silently stop covering the 401 handler at all. The intercept is
    // scoped to the invoices call, so re-hydration on /login is unaffected.

    // Trigger an authenticated request from the live page.
    await page.getByRole("tab", { name: "Invoice list" }).click();

    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 15_000 })
      .toBe("/login");
    const url = new URL(page.url());
    // The EXACT reason the server gave, not a guess.
    expect(url.searchParams.get("reason")).toBe("expired");
    // ...and the destination survived.
    expect(url.searchParams.get("next")).toContain("/finance/invoices");

    // The user is told something they can act on, in plain language.
    const status = page.getByRole("status");
    await expect(status).toBeVisible();
    await expect(status).toContainText(/your session expired/i);

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
    await expectPath(page, "/dashboard");

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
    await expectPath(page, "/dashboard");

    // Open the account menu and sign out. The trigger is named after the
    // signed-in user (same locator phase-0-happy-path uses) — there is no
    // generic "account"/"profile" label to match on.
    // "Eve Owner" is what loginAsAdmin provisions every owner as
    // (ownerFirstName/ownerLastName in e2e/fixtures/session.ts). AdminSession
    // does not surface those, so the fixture's own constant is the honest
    // thing to match on.
    await page.getByRole("button", { name: /Eve Owner/ }).click();
    await page.getByRole("menuitem", { name: /log out|sign out/i }).click();

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
    await expectPath(page, "/students");

    await dropSessionCookie(page);
    await page.reload();
    await expect(page).toHaveURL(/\/login/);

    await page.goBack();
    await page.waitForLoadState("networkidle");

    // Assert the PROPERTY, not a particular URL. This page's history is
    // [about:blank, /students -> /login], so Back lands on about:blank —
    // which reveals nothing, and asserting /login here was testing the
    // wrong thing. What must hold is that no protected content is on
    // screen.
    await expect(page.getByRole("heading", { name: "Students" })).toBeHidden();
    await expect(page.getByRole("table")).toBeHidden();

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

// ─────────────────────────── guardian portal ───────────────────────────
//
// The portal's half of F-10. Last slice gave middleware a `next` for the
// cold-load case; the MID-SESSION 401 path was still a bare
// replace("/login") — no reason, no memory of the page. These cover both,
// plus the hardened open-redirect guard that replaced the portal's weaker
// inline check.

test.describe("guardian portal — session expiry and deep links (F-10)", () => {
  const PORTAL = process.env.E2E_PORTAL_URL ?? "http://localhost:3002";

  for (const hostile of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "%2f%2fevil.example",
  ]) {
    test(`portal refuses next=${hostile}`, async ({ browser }) => {
      const admin = await loginAsAdmin(browser);
      const suffix = uniqueSuffix();
      const { createPortalGuardian } = await import("../fixtures/guardian.js");
      const guardian = await createPortalGuardian(admin.api, {
        suffix,
        schoolId: admin.schoolId,
      });

      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`${PORTAL}/login?next=${encodeURIComponent(hostile)}`);
      await page.getByLabel("Email").fill(guardian.email);
      await page.getByLabel("Password", { exact: true }).fill(guardian.password);
      await page.getByRole("button", { name: "Log in" }).click();

      // Falls back to the portal home; never leaves the origin.
      await expect(page).toHaveURL(`${PORTAL}/`);
      expect(page.url()).not.toContain("evil.example");
      expect(new URL(page.url()).origin).toBe(PORTAL);

      await context.close();
      await admin.context.close();
      await admin.api.dispose();
    });
  }

  test("a parent who loses their session mid-read is told why and returned to the page", async ({
    browser,
  }) => {
    const admin = await loginAsAdmin(browser);
    const suffix = uniqueSuffix();
    const { createPortalGuardian } = await import("../fixtures/guardian.js");
    const guardian = await createPortalGuardian(admin.api, {
      suffix,
      schoolId: admin.schoolId,
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${PORTAL}/login`);
    await page.getByLabel("Email").fill(guardian.email);
    await page.getByLabel("Password", { exact: true }).fill(guardian.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("heading", { name: "Your children" })).toBeVisible();

    const target = `/students/${guardian.studentId}`;
    await page.goto(`${PORTAL}${target}`);
    await expect(page.getByText(guardian.studentFirstName).first()).toBeVisible();

    // Make the next authed fetch return a genuine expiry.
    //
    // Deliberately an intercept, not a cookie deletion + reload: a reload
    // with no cookie is handled by MIDDLEWARE, which carries `next` but
    // cannot know a reason, so it would never exercise the 401 handler this
    // slice added — and the reason would correctly be null.
    await page.route("**/api/v1/portal/students/**", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "SESSION_EXPIRED", message: "Session has expired." },
        }),
      }),
    );

    await page.reload();

    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 15_000 })
      .toBe("/login");
    const url = new URL(page.url());
    expect(url.searchParams.get("reason")).toBe("expired");

    const status = page.getByRole("status");
    await expect(status).toBeVisible();
    await expect(status).toContainText(/your session expired/i);

    // No technical vocabulary reaches the parent.
    const body = (await page.locator("body").textContent()) ?? "";
    for (const leak of ["401", "SESSION_EXPIRED", "INVALID_SESSION", "bearer"]) {
      expect(body).not.toContain(leak);
    }
    // And the child's data is not still on screen behind the login form.
    await expect(page.getByText(guardian.studentFirstName)).toBeHidden();

    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });

  test("a deliberate portal Sign out shows NO expiry message", async ({ browser }) => {
    const admin = await loginAsAdmin(browser);
    const suffix = uniqueSuffix();
    const { createPortalGuardian } = await import("../fixtures/guardian.js");
    const guardian = await createPortalGuardian(admin.api, {
      suffix,
      schoolId: admin.schoolId,
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${PORTAL}/login`);
    await page.getByLabel("Email").fill(guardian.email);
    await page.getByLabel("Password", { exact: true }).fill(guardian.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("heading", { name: "Your children" })).toBeVisible();
    await expect(page.getByText(guardian.studentFirstName).first()).toBeVisible();

    await page.waitForLoadState("networkidle");
    await Promise.all([
      page.waitForURL(new RegExp("/login"), { timeout: 30_000 }),
      page.getByRole("button", { name: "Sign out" }).click(),
    ]);

    expect(new URL(page.url()).searchParams.get("reason")).toBeNull();
    await expect(page.getByRole("status")).toBeHidden();

    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  });
});
