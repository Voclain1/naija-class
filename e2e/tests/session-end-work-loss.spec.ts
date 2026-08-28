import { expect, test, type Browser, type Page } from "@playwright/test";

import {
  createApiContext,
  inviteAndAcceptTeacher,
  loginAsAdmin,
  loginAsTeacher,
  uniqueSuffix,
} from "../fixtures/index.js";

// Forced session end must not offer a "Stay" it cannot honour.
//
// THE BUG THESE TESTS PIN (reproduced 2026-08-28, fixed here):
//
//   dirty form → server 401 → apiFetch clears the token and dispatches
//   AUTH_UNAUTHORIZED_EVENT → the auth provider queues guest state and calls
//   window.location.replace → beforeunload fires INSIDE that call → the
//   browser offers Leave/Stay with the credential already gone.
//
//   Choosing "Stay" cancelled only the navigation. The queued guest state
//   still flushed, RequireAuth still swapped the form for its loading screen
//   (destroying every typed value), and its guest branch then did a
//   CLIENT-side redirect that beforeunload cannot intercept — carrying no
//   reason at all. The user lost the work AND the explanation.
//
// The fix does not preserve the work; nothing at this point can. It removes
// the false choice: a forced sign-out marks itself, every beforeunload guard
// stands down for it, and the eviction happens once with the reason intact.
//
// The load-bearing assertion in most of these tests is therefore a NEGATIVE
// one — `dialogs` stays empty. Playwright auto-dismisses an unhandled dialog,
// which is exactly the "Stay" answer, so before the fix these tests land on a
// bare /login and fail on the missing reason.
//
// SAFETY: every test provisions its own school via a fresh signup with a
// unique slug, against the LOCAL docker Postgres named in .env. No operational
// school data is read or mutated.

const WEB = "http://localhost:3001";

/** Collect any dialog the browser raises, answering it the way "Stay" does. */
function watchDialogs(page: Page): string[] {
  const seen: string[] = [];
  page.on("dialog", (d) => {
    seen.push(d.type());
    void d.dismiss().catch(() => {});
  });
  return seen;
}

/** Revoke a session server-side, exactly as signing out on another device does. */
async function revokeSession(token: string): Promise<void> {
  const api = await createApiContext(token);
  const res = await api.post("auth/logout");
  expect(res.ok(), `logout should succeed: ${res.status()}`).toBe(true);
  await api.dispose();
}

/**
 * Answer the next API call with a 401 carrying `code`, without touching the
 * real session.
 *
 * Used for SESSION_EXPIRED, which is otherwise only reachable by waiting 30
 * days or writing to the sessions table. The exact envelope is the one
 * AuthGuard emits — apps/api's auth.session.spec.ts pins the server side of
 * that contract against a real database, so what is simulated here is the
 * transport, not the behaviour under test.
 */
async function answerWith401(page: Page, code: string, urlGlob: string): Promise<void> {
  await page.route(urlGlob, async (route) => {
    if (route.request().method() === "GET") return route.fallback();
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: { code, message: "Session ended." } }),
    });
  });
}

// ---------------------------------------------------------------------------
// A dirty admin form. Cheapest surface that exercises the whole path, so the
// reason/notice/dialog assertions live here and the gradebook test below
// focuses on the typed data itself.
// ---------------------------------------------------------------------------

async function openDirtySchoolSettings(page: Page): Promise<void> {
  await page.goto(`${WEB}/settings/school`);
  const name = page.getByLabel("School name");
  await name.waitFor({ timeout: 60_000 });
  // Wait for the fetched school to populate the field — filling before the
  // load lands is overwritten by it, and the form never becomes dirty.
  await expect.poll(async () => (await name.inputValue()).length, { timeout: 30_000 }).toBeGreaterThan(0);
  await name.fill("Renamed Mid-Session Academy");
  await expect(page.getByText("Unsaved change.")).toBeVisible();
}

test.describe("forced session end offers no false choice", () => {
  test("a revoked session evicts once, with the reason, and raises no dialog", async ({
    browser,
  }) => {
    const admin = await loginAsAdmin(browser);
    const page = admin.page;
    const dialogs = watchDialogs(page);

    await openDirtySchoolSettings(page);
    await revokeSession(admin.token);
    await page.getByRole("button", { name: /^save$/i }).click();
    await page.waitForURL(/\/login/, { timeout: 30_000 });

    // /settings/school carries no beforeunload guard, so this assertion is a
    // floor rather than the regression proof — the guarded surfaces (the
    // matrix and the gradebook, below) are where a dialog actually fired.
    expect(dialogs).toEqual([]);

    const url = new URL(page.url());
    expect(url.searchParams.get("reason")).toBe("revoked");
    expect(url.searchParams.get("next")).toBe("/settings/school");
    await expect(page.getByText("You were signed out")).toBeVisible();

    // No stale protected content behind the login screen.
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("Renamed Mid-Session Academy");
    expect(body).not.toContain(admin.schoolName);

    await admin.context.close();
    await admin.api.dispose();
  });

  test("a dirty setup form is evicted without a dialog, and keeps its reason", async ({
    browser,
  }) => {
    // The class-subject matrix DOES carry a beforeunload guard, so this is one
    // of the two surfaces where the false choice actually appeared. It is also
    // the configuration-form shape: many toggles, one Save, nothing recoverable.
    const admin = await loginAsAdmin(browser);
    const { setupAcademicStructure } = await import("../fixtures/academic.js");
    await setupAcademicStructure(admin.api);
    const page = admin.page;
    const dialogs = watchDialogs(page);

    await page.goto(`${WEB}/settings/academic/class-subjects`);
    await page.getByRole("heading", { name: "Class-subject matrix" }).waitFor({ timeout: 60_000 });
    const cell = page.getByRole("button", {
      name: /Link subject to level|Unlink subject from level/,
    });
    await expect.poll(() => cell.count(), { timeout: 30_000 }).toBeGreaterThan(0);
    await cell.first().click();

    await revokeSession(admin.token);
    const save = page.getByRole("button", { name: /^save/i });
    await expect(save.first()).toBeEnabled({ timeout: 10_000 });
    await save.first().click();
    await page.waitForURL(/\/login/, { timeout: 30_000 });

    // THE REGRESSION, on a guarded surface. Before the fix a beforeunload
    // dialog fired; the watcher above dismisses it ("Stay"), which cancelled
    // the navigation, let RequireAuth unmount the matrix and redirect on its
    // own, and dropped the reason entirely.
    expect(dialogs, "a forced sign-out must not ask Leave or Stay").toEqual([]);
    expect(new URL(page.url()).searchParams.get("reason")).toBe("revoked");
    await expect(page.getByText("You were signed out")).toBeVisible();

    await admin.context.close();
    await admin.api.dispose();
  });

  test("an expired session says so, and is never described as a revocation", async ({
    browser,
  }) => {
    const admin = await loginAsAdmin(browser);
    const page = admin.page;
    const dialogs = watchDialogs(page);

    await openDirtySchoolSettings(page);
    await answerWith401(page, "SESSION_EXPIRED", "**/api/v1/schools/**");
    await page.getByRole("button", { name: /^save$/i }).click();
    await page.waitForURL(/\/login/, { timeout: 30_000 });

    expect(dialogs).toEqual([]);
    expect(new URL(page.url()).searchParams.get("reason")).toBe("expired");
    await expect(page.getByText("Your session expired")).toBeVisible();
    await expect(page.getByText("You were signed out")).toHaveCount(0);

    await admin.context.close();
    await admin.api.dispose();
  });

  test("a deactivated account is never told that signing in again will help", async ({
    browser,
  }) => {
    // USER_INACTIVE for real, not simulated: deleting a teacher profile flips
    // users.isActive and clears that user's cached session, so the teacher's
    // very next request is a genuine 401 USER_INACTIVE from AuthGuard.
    const admin = await loginAsAdmin(browser);
    const teacher = await inviteAndAcceptTeacher(browser, {
      schoolId: admin.schoolId,
      invitedByUserId: admin.ownerUserId,
    });
    const profile = await admin.api.post("teacher-profiles", {
      data: { userId: teacher.userId, staffNumber: `E2E-${uniqueSuffix()}` },
    });
    expect(profile.ok(), `create teacher profile: ${await profile.text()}`).toBe(true);
    const { id: profileId } = (await profile.json()) as { id: string };

    const session = await loginAsTeacher(browser, teacher.email, teacher.password);
    const page = session.page;
    const dialogs = watchDialogs(page);

    await page.goto(`${WEB}/teacher/dashboard`);
    await page.waitForURL(/\/teacher\/dashboard/, { timeout: 60_000 });

    const removed = await admin.api.delete(`teacher-profiles/${profileId}`);
    expect(removed.ok(), `delete teacher profile: ${await removed.text()}`).toBe(true);

    // Any authenticated call now returns USER_INACTIVE.
    await page.goto(`${WEB}/teacher/lesson-plans`);
    await page.waitForURL(/\/login/, { timeout: 60_000 });

    expect(dialogs).toEqual([]);
    expect(new URL(page.url()).searchParams.get("reason")).toBe("deactivated");
    await expect(page.getByText("Your account is no longer active")).toBeVisible();
    // The one reason that must NOT promise a retry — the server refuses this
    // account at login too, so "sign in again" would be a false promise.
    await expect(page.getByText("Sign in again to continue")).toHaveCount(0);

    await session.context.close();
    await teacher.context.close();
    await admin.context.close();
    await admin.api.dispose();
  });
});

// ---------------------------------------------------------------------------
// Bulk student add — the partial-write defect.
// ---------------------------------------------------------------------------

test.describe("bulk student add stops when the session is gone", () => {
  test("no doomed requests after a 401, and the rows that landed are named", async ({
    browser,
  }) => {
    const admin = await loginAsAdmin(browser);
    const page = admin.page;
    const suffix = uniqueSuffix();

    // Let row 1 through; answer every later create exactly as a revoked
    // session would. This is the real shape of "the session died between
    // row 1 and row 2" and is the only way to place the failure precisely.
    let attempts = 0;
    await page.route("**/api/v1/students", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      attempts += 1;
      if (attempts === 1) return route.fallback();
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "INVALID_SESSION", message: "Session is invalid or has been revoked." },
        }),
      });
    });

    await page.goto(`${WEB}/students/new/bulk`);
    await page.getByRole("heading", { name: "Add multiple students" }).waitFor({ timeout: 60_000 });
    await expect.poll(() => page.locator("tbody tr").count(), { timeout: 30_000 }).toBeGreaterThan(0);

    const rows = [
      ["A", "Amaka"],
      ["B", "Bode"],
      ["C", "Chidi"],
    ];
    for (const [i, [letter, first]] of rows.entries()) {
      const row = page.locator("tbody tr").nth(i);
      await row.locator(`[data-cell="${i}:0"]`).fill(`E2E-${suffix}-${letter}`);
      await row.locator(`[data-cell="${i}:1"]`).fill(first);
      await row.locator(`[data-cell="${i}:3"]`).fill("Bulk");
      await row.locator(`[data-cell="${i}:4"]`).fill("2012-05-04");
      await row.locator(`[data-cell="${i}:5"]`).selectOption("FEMALE");
    }

    await page.getByRole("button", { name: /create students/i }).click();
    await page.waitForURL(/\/login/, { timeout: 30_000 });

    // THE REGRESSION. Before the fix the loop swallowed the 401 into that
    // row's status cell and carried on, so row 3 was also attempted: three
    // requests where two is correct (row 1 succeeded, row 2 failed, stop).
    expect(attempts, "the loop must stop at the first terminal auth failure").toBe(2);

    // The DB holds exactly the row that succeeded. admin.api's own session was
    // never revoked — only the browser's calls were intercepted — so this is a
    // clean read.
    const roster = await admin.api.get("students");
    const body = (await roster.json()) as { data?: { admissionNumber: string }[] };
    const mine = (body.data ?? [])
      .map((s) => s.admissionNumber)
      .filter((a) => a.includes(suffix))
      .sort();
    expect(mine).toEqual([`E2E-${suffix}-A`]);

    await admin.context.close();
    await admin.api.dispose();
  });

  // NO test asserts the in-page "signed out after 1 of 2 …" banner is visible,
  // deliberately. It is written (see partialSaveNotice, unit-tested for its
  // wording) but the eviction navigation is already in flight by the time the
  // rejection reaches the component's catch — apiFetch calls
  // window.location.replace synchronously while handling the 401, before the
  // promise rejects. A first attempt at such a test waited 15s and never saw
  // it. Carrying the count across the redirect would need browser storage,
  // which is rejected for this data. So the banner is best-effort, and the
  // durable guidance is the standing page note asserted below.

  test("returning to the flow explains that re-entering a saved student is safe", async ({
    browser,
  }) => {
    // Standing guidance, not remembered state: browser-storage drafts were
    // considered and rejected, so what makes recovery safe is the server's
    // per-school uniqueness on admission number, and the page says so.
    const admin = await loginAsAdmin(browser);
    await admin.page.goto(`${WEB}/students/new/bulk`);
    await expect(admin.page.getByText("Interrupted partway through?")).toBeVisible({
      timeout: 60_000,
    });
    await expect(admin.page.getByText(/already saved/i)).toBeVisible();

    await admin.context.close();
    await admin.api.dispose();
  });
});

// ---------------------------------------------------------------------------
// The gradebook — the highest-value unsaved work in the app.
// ---------------------------------------------------------------------------

async function seedGradebookColumn(
  browser: Browser,
): Promise<{
  admin: Awaited<ReturnType<typeof loginAsAdmin>>;
  teacher: Awaited<ReturnType<typeof inviteAndAcceptTeacher>>;
  url: string;
}> {
  const { setupAcademicStructure, armId } = await import("../fixtures/academic.js");
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api);
  const arm = armId(structure, "JSS 2 A");

  const scheme = await admin.api.put("grading-scheme/components", {
    data: {
      components: [
        { key: "ca1", label: "CA1", weight: 40, orderIndex: 0 },
        { key: "exam", label: "Exam", weight: 60, orderIndex: 1 },
      ],
    },
  });
  expect(scheme.ok(), `grading components: ${await scheme.text()}`).toBe(true);

  const suffix = uniqueSuffix();
  for (const [i, name] of ["Adaeze", "Bola"].entries()) {
    const created = await admin.api.post("students", {
      data: {
        admissionNumber: `E2E-${suffix}-${i}`,
        firstName: name,
        lastName: "Learner",
        dateOfBirth: "2012-05-04",
        gender: i === 0 ? "FEMALE" : "MALE",
      },
    });
    expect(created.ok(), `create student: ${await created.text()}`).toBe(true);
    const { id } = (await created.json()) as { id: string };
    const enrolled = await admin.api.post("enrollments", {
      data: { studentId: id, classArmId: arm, termId: structure.termId },
    });
    expect(enrolled.ok(), `enrol student: ${await enrolled.text()}`).toBe(true);
  }

  const teacher = await inviteAndAcceptTeacher(browser, {
    schoolId: admin.schoolId,
    invitedByUserId: admin.ownerUserId,
  });
  const assigned = await admin.api.post("teacher-assignments", {
    data: {
      teacherId: teacher.userId,
      classArmId: arm,
      subjectId: structure.subjectId,
      academicYearId: structure.academicYearId,
    },
  });
  expect(assigned.ok(), `assign teacher: ${await assigned.text()}`).toBe(true);

  return { admin, teacher, url: `/teacher/gradebook/${arm}/${structure.subjectId}` };
}

test.describe("gradebook", () => {
  test("a revoked session takes the teacher away once, saying why, with no dialog", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const { admin, teacher, url } = await seedGradebookColumn(browser);
    const session = await loginAsTeacher(browser, teacher.email, teacher.password);
    const page = session.page;
    const dialogs = watchDialogs(page);

    await page.goto(`${WEB}${url}`);
    await page.getByRole("link", { name: "All classes" }).waitFor({ timeout: 60_000 });
    const cells = page.locator("tbody td input");
    await expect.poll(() => cells.count(), { timeout: 60_000 }).toBeGreaterThan(0);

    await cells.nth(0).fill("17");
    await expect(cells.nth(0)).toHaveValue("17");

    await revokeSession(session.token);
    const save = page.getByRole("button", { name: /^save$/i });
    await expect(save).toBeEnabled({ timeout: 10_000 });
    await save.click();
    await page.waitForURL(/\/login/, { timeout: 30_000 });

    // THE REGRESSION, on the surface that matters most. Before the fix this
    // raised a beforeunload dialog whose "Stay" lost the column anyway and
    // stripped the reason on the way out.
    expect(dialogs, "a forced sign-out must not ask Leave or Stay").toEqual([]);

    const parsed = new URL(page.url());
    expect(parsed.searchParams.get("reason")).toBe("revoked");
    expect(parsed.searchParams.get("next")).toBe(url);
    await expect(page.getByText("You were signed out")).toBeVisible();

    // No student names left behind the login screen.
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("Adaeze");
    expect(body).not.toContain("Learner");

    // Signing back in returns them to the exact column. The unsaved score is
    // NOT restored — this slice removes the false promise, it does not keep
    // the work. Asserted so the limitation is recorded, not assumed.
    await page.getByLabel("Email").fill(teacher.email);
    await page.getByLabel("Password", { exact: true }).fill(teacher.password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await page.waitForURL(new RegExp(url.replace(/\//g, "\\/")), { timeout: 60_000 });
    const after = page.locator("tbody td input");
    await expect.poll(() => after.count(), { timeout: 60_000 }).toBeGreaterThan(0);
    await expect(after.nth(0)).toHaveValue("");

    await session.context.close();
    await teacher.context.close();
    await admin.context.close();
    await admin.api.dispose();
  });
});
