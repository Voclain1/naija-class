import { expect, test } from "@playwright/test";

import { TINY_PNG_BUFFER } from "../fixtures/image.js";

// Phase 0 happy path:
//   owner signs up → completes the 5-step onboarding wizard → invites
//   an admin from /settings/users → admin accepts the invitation in a
//   separate browser context → admin logs out and logs back in via
//   /login and lands on /dashboard.
//
// One test, deliberately end-to-end. Per CLAUDE.md → Tests, a passing
// happy-path is worth more than 50 narrowly-scoped UI assertions; we
// rely on the controller + service specs for the unhappy paths.
//
// Test data uses a per-run id so re-runs do not collide with leftover
// rows in the dev DB. Owner phone must be globally unique on `users`
// (Phase 0 schema constraint, tracked for revisit in Phase 4); the rest
// only need to be unique per school. We do NOT clean up after the
// test — leftover rows are cheap; CI runs on fresh service containers
// anyway.

const runId = Math.random().toString(36).slice(2, 8); // 6 chars base36
const phoneRunId = Date.now().toString().slice(-9); // 9 numeric digits

const owner = {
  schoolName: `E2E School ${runId}`,
  firstName: "Eve",
  lastName: "Owner",
  email: `e2e-owner-${runId}@school-kit.test`,
  phone: `+234${phoneRunId}`,
  password: "Password1!",
};

// School-level contact captured in onboarding step 1 — distinct from
// the owner's personal email/phone (the schema decouples them: User.phone
// is globally unique, School.phone has no constraint).
const school = {
  phone: "+2348012345678",
  email: `e2e-school-${runId}@school-kit.test`,
};

const admin = {
  email: `e2e-admin-${runId}@school-kit.test`,
  firstName: "Adam",
  lastName: "Admin",
  password: "Password4@",
};

test("Phase 0 happy path: signup -> onboarding -> invite -> accept -> login", async ({
  browser,
}) => {
  // -----------------------------------------------------------------
  // Owner context — signup through inviting the admin
  // -----------------------------------------------------------------
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();

  // 1. /signup
  //
  // Note on selectors: shadcn/ui's CardTitle renders as a <div>, not an
  // <h*> element, so getByRole("heading", ...) does NOT match card titles.
  // We use getByText for CardTitle-based titles and reserve getByRole
  // ("heading", ...) for genuine <h1>/<h2> elements (the dashboard h1,
  // the settings/users h1, and the invite dialog h2).
  await ownerPage.goto("/signup");
  await expect(ownerPage.getByText("Create your school")).toBeVisible();

  await ownerPage.getByLabel("School name").fill(owner.schoolName);
  // No slug field any more (2026-08-12) — the API derives the slug from the
  // school name. `owner.schoolName` embeds runId, so the derived slug is
  // unique per run without this test having to pick one.
  await ownerPage.getByLabel("First name").fill(owner.firstName);
  await ownerPage.getByLabel("Last name").fill(owner.lastName);
  await ownerPage.getByLabel("Email").fill(owner.email);
  await ownerPage.getByLabel("Phone").fill(owner.phone);
  await ownerPage.getByLabel("Password").fill(owner.password);
  await ownerPage
    .getByRole("checkbox", { name: /accept the data handling/i })
    .check();
  await ownerPage.getByRole("button", { name: "Create school" }).click();

  await ownerPage.waitForURL(/\/onboarding\/1$/);

  // 2. Onboarding step 1 — school basics (school name pre-filled from
  //    signup; phone + email are SCHOOL contact, not the owner's).
  await expect(ownerPage.getByText("School basics")).toBeVisible();
  await ownerPage.getByLabel("Phone").fill(school.phone);
  await ownerPage.getByLabel("Email").fill(school.email);
  await ownerPage.getByRole("button", { name: "Continue" }).click();
  await ownerPage.waitForURL(/\/onboarding\/2$/);

  // 3. Onboarding step 2 — logo.
  //
  // Logo is a real upload (resolved 2026-07-26 — see step2-branding.dto.ts's
  // header comment for the full history), not a URL text field, so this
  // exercises the real multipart upload path through the browser rather than
  // just filling a string. It uploads immediately on file selection
  // (LogoUpload), independent of this step's own Continue submit — we wait
  // for the upload's own success toast before continuing, so a slow upload
  // can't race the click.
  //
  // The primary-colour hex field was removed from this step on 2026-08-12
  // (it lives on Settings > School now), which also retires the pre-existing
  // ""-rejected-by-.regex() bug this block used to work around.
  await expect(ownerPage.getByText("Your school logo")).toBeVisible();
  await ownerPage
    .locator('input[type="file"]')
    .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: TINY_PNG_BUFFER });
  await expect(ownerPage.getByText("Logo uploaded.")).toBeVisible();
  await ownerPage.getByRole("button", { name: "Continue" }).click();
  await ownerPage.waitForURL(/\/onboarding\/3$/);

  // 4. Onboarding step 3 — invites. Skip; we invite via Settings instead
  //    so we exercise the post-onboarding invite path (the real workflow
  //    a school owner would use after first launch).
  await expect(ownerPage.getByText("Invite admins")).toBeVisible();
  await ownerPage.getByRole("button", { name: "Skip for now" }).click();
  await ownerPage.waitForURL(/\/onboarding\/4$/);

  // 5. Onboarding step 4 — NDPR confirmation.
  await expect(
    ownerPage.getByText("Data protection consent"),
  ).toBeVisible();
  await ownerPage
    .getByRole("checkbox", { name: /I have read and accept/i })
    .check();
  await ownerPage
    .getByRole("button", { name: "Confirm and continue" })
    .click();
  await ownerPage.waitForURL(/\/onboarding\/5$/);

  // 6. Onboarding step 5 — finalise (flips status to ACTIVE).
  await expect(ownerPage.getByText("You're all set")).toBeVisible();
  await ownerPage.getByRole("button", { name: "Go to dashboard" }).click();
  await ownerPage.waitForURL(/\/dashboard$/);
  await expect(
    ownerPage.getByRole("heading", { name: "Dashboard", level: 1 }),
  ).toBeVisible();

  // 6b. First-login product tour auto-shows here — a real owner landing on
  //     /dashboard for the first time sees it too, and its backdrop blocks
  //     interaction with the page underneath until dismissed. Skip it so
  //     the rest of this test (a different flow entirely) can proceed —
  //     the tour's own behaviour has its own dedicated verification pass.
  await expect(
    ownerPage.getByRole("heading", { name: "Welcome to schoolkit" }),
  ).toBeVisible();
  await ownerPage.getByRole("button", { name: "Skip tour", exact: true }).click();
  await expect(
    ownerPage.getByRole("heading", { name: "Welcome to schoolkit" }),
  ).toHaveCount(0);

  // 7. Invite the admin from /settings/users. We intercept the API
  //    response to extract acceptUrl — the UI only exposes it via a
  //    transient "Copy link" affordance (apps/web/src/components/
  //    settings/invitations-table.tsx) and the API response is the
  //    source of truth (apps/api/src/modules/users/users.service.ts
  //    builds it).
  await ownerPage.goto("/settings/users");
  await expect(
    ownerPage.getByRole("heading", { name: "Users", level: 1 }),
  ).toBeVisible();
  await ownerPage.getByRole("button", { name: "Invite admin" }).click();

  const dialog = ownerPage.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Invite an admin" }),
  ).toBeVisible();
  await dialog.getByLabel("Email").fill(admin.email);
  // First/last name are nominally optional (inviteAdminSchema), but the
  // schema's `.min(1).optional()` pattern means an empty string fails
  // validation before .optional() saves it (same shape as the step 2
  // branding bug). Provide non-empty values so the form actually submits.
  await dialog.getByLabel("First name (optional)").fill(admin.firstName);
  await dialog.getByLabel("Last name (optional)").fill(admin.lastName);

  const [inviteResponse] = await Promise.all([
    ownerPage.waitForResponse(
      (r) => r.url().includes("/users/invite") && r.request().method() === "POST",
    ),
    dialog.getByRole("button", { name: "Send invitation" }).click(),
  ]);
  expect(inviteResponse.ok()).toBe(true);
  const invitePayload = (await inviteResponse.json()) as { acceptUrl: string };
  expect(invitePayload.acceptUrl).toContain("/invitations/");

  // -----------------------------------------------------------------
  // Admin context — accept the invitation, log out, log back in
  // -----------------------------------------------------------------
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();

  // 8. Accept the invitation in the admin's "browser".
  await adminPage.goto(invitePayload.acceptUrl);
  await expect(
    adminPage.getByText(`Join ${owner.schoolName} as admin`),
  ).toBeVisible();
  await adminPage.getByLabel("First name").fill(admin.firstName);
  await adminPage.getByLabel("Last name").fill(admin.lastName);
  await adminPage.getByLabel("Password", { exact: true }).fill(admin.password);
  await adminPage.getByLabel("Confirm password").fill(admin.password);
  await adminPage
    .getByRole("checkbox", { name: /accept the data handling/i })
    .check();
  await adminPage
    .getByRole("button", { name: "Accept invitation" })
    .click();

  // AcceptInvitationForm hard-navigates (window.location.href = "/dashboard")
  // rather than router.replace — verified in
  // apps/web/src/components/invitations/accept-invitation-form.tsx.
  await adminPage.waitForURL(/\/dashboard$/);
  await expect(
    adminPage.getByRole("heading", { name: "Dashboard", level: 1 }),
  ).toBeVisible();

  // 8b. This invited admin is also a first-time /dashboard visitor — their
  //     own account independently gets the first-login tour (it's per-User,
  //     not per-School). Dismiss it, same as the owner above.
  await expect(
    adminPage.getByRole("heading", { name: "Welcome to schoolkit" }),
  ).toBeVisible();
  await adminPage.getByRole("button", { name: "Skip tour", exact: true }).click();
  await expect(
    adminPage.getByRole("heading", { name: "Welcome to schoolkit" }),
  ).toHaveCount(0);

  // 9. Log out via the topbar dropdown, then log back in via /login.
  //    Per the spec criterion, "admin logs in" is a distinct step from
  //    "accepts the invitation" — accepting auto-creates a session, so
  //    we explicitly log out and re-authenticate to prove the
  //    credentials work standalone.
  //
  //    The topbar trigger button's accessible name is the admin's
  //    "{firstName} {lastName}" (apps/web/src/components/admin/topbar.tsx).
  //    Scoping the menuitem by name avoids the Radix portal hosting
  //    multiple "Log out" elements during the open/close transition.
  await adminPage
    .getByRole("button", { name: new RegExp(`${admin.firstName} ${admin.lastName}`) })
    .click();
  await adminPage.getByRole("menuitem", { name: /log out/i }).click();
  await adminPage.waitForURL(/\/login$/);

  // /login has both a CardTitle "Sign in" div AND a "Sign in" submit
  // button. Match the CardTitle (first DOM occurrence).
  await expect(adminPage.getByText("Sign in", { exact: true }).first()).toBeVisible();
  await adminPage.getByLabel("Email").fill(admin.email);
  await adminPage.getByLabel("Password").fill(admin.password);
  await adminPage.getByRole("button", { name: "Sign in" }).click();

  await adminPage.waitForURL(/\/dashboard$/);
  await expect(
    adminPage.getByRole("heading", { name: "Dashboard", level: 1 }),
  ).toBeVisible();

  await ownerContext.close();
  await adminContext.close();
});
