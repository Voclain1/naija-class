import { type Browser, type BrowserContext, type Page } from "@playwright/test";

import { apiMe, createApiContext } from "./api.js";
import { seedTeacherInvitation } from "./db.js";
import { uniqueSuffix } from "./unique.js";

const SESSION_COOKIE_NAME = "sk_session";

export interface InvitedTeacher {
  userId: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  context: BrowserContext;
  page: Page;
}

// inviteAndAcceptTeacher — produce a real, logged-in teacher.
//
// Two halves:
//   1. SEED the invitation row (e2e/fixtures/db.ts) — the one synthetic step,
//      because no API mints a teacher invitation yet (see db.ts for the full
//      rationale). This is the documented cp4 divergence from the brief's
//      "POST /users/invite with roleKey='teacher'".
//   2. ACCEPT it through the REAL public UI in a fresh browser context: load
//      /invitations/<token>, fill the accept form, submit. The accept endpoint
//      creates the user, grants the `teacher` role (the invitation's role_key),
//      sets the password, and mints a session — exactly as a real teacher's
//      first login would. The app stores the session token and hard-navigates
//      to /dashboard.
//
// The new user's id (needed as teacherId for assignments) is read race-free via
// GET /auth/me against the token the accept minted — NOT the accept response
// body, which the form's hard-navigation discards. That token now lives in the
// sk_session HttpOnly cookie (set by the /api/invitations/:token/accept proxy
// route), not localStorage — httpOnly cookies aren't readable via
// page.evaluate/document.cookie by design, so we read it back through
// Playwright's own context.cookies() (browser-automation level, not page JS).
// The returned context is authenticated and ready to browse the teacher
// portal; the returned email + password also feed loginAsTeacher() for a
// fresh context.
export async function inviteAndAcceptTeacher(
  browser: Browser,
  opts: {
    schoolId: string;
    invitedByUserId: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    password?: string;
  },
): Promise<InvitedTeacher> {
  const suffix = uniqueSuffix();
  const email = opts.email ?? `e2e-teacher-${suffix}@school-kit.test`;
  const firstName = opts.firstName ?? "Tunde";
  const lastName = opts.lastName ?? "Teacher";
  const password = opts.password ?? "Password1!";

  const { acceptPath } = await seedTeacherInvitation({
    schoolId: opts.schoolId,
    invitedByUserId: opts.invitedByUserId,
    email,
    firstName,
    lastName,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(acceptPath);

  // The accept form (apps/web/src/components/invitations/accept-invitation-form
  // .tsx) — same fields the Phase 0 happy path drives for an admin accept.
  // Wait on the password field so we don't fill before the invitation resolves.
  await page.getByLabel("Password", { exact: true }).waitFor();
  await page.getByLabel("First name").fill(firstName);
  await page.getByLabel("Last name").fill(lastName);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page
    .getByRole("checkbox", { name: /accept the data handling/i })
    .check();

  // On success the form hard-navigates (window.location.href = "/dashboard").
  // Reaching /dashboard is our success signal — race-free, unlike reading the
  // accept response body, which the navigation discards. (An accept failure
  // would keep us on the accept page; this wait would then time out with a
  // screenshot showing the form error.)
  await Promise.all([
    page.waitForURL(/\/dashboard$/),
    page.getByRole("button", { name: "Accept invitation" }).click(),
  ]);

  // The created teacher's id is needed as teacherId for assignments. Read the
  // freshly-minted sk_session cookie and resolve it via GET /auth/me — this
  // also proves the session the accept minted is valid.
  const cookies = await context.cookies();
  const token = cookies.find((c) => c.name === SESSION_COOKIE_NAME)?.value;
  if (!token) {
    throw new Error("inviteAndAcceptTeacher: no session token after accept");
  }
  const api = await createApiContext(token);
  const me = await apiMe(api);
  await api.dispose();
  const userId = me.user.id;

  return {
    userId,
    email,
    password,
    firstName,
    lastName,
    context,
    page,
  };
}
