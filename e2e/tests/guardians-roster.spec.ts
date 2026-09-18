import { expect, test, type Page } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { seedTeacherInvitation } from "../fixtures/db.js";
import { apiCreateStudent } from "../fixtures/finance.js";
import { createApiContext, loginAsAdmin, loginAsTeacher, uniqueSuffix } from "../fixtures/index.js";

// /guardians — the guardian roster (2026-09-16).
//
// The parent-facing product had no front door: a parent could only be reached
// one student at a time, through that student's Guardians tab. Production that
// day had 14 guardians across 91 schools. This drives the real roster as a
// school owner, with a guardian seeded in each portal state, and checks what
// matters to a school trying to get parents in:
//   1. Guardians is in the sidebar; the roster lists every guardian with their
//      children and a correct portal status.
//   2. The "Not invited" filter finds exactly the right people, survives a
//      reload, and is applied by the server.
//   3. Invite, Resend and Cancel work from the roster — and a replaced link
//      really stops working on the portal.
//   4. An active parent and a parent with no email are offered NO actions.
//   5. An expired invitation can be sent again.
//   6. A bursar does not see Guardians, and the API refuses them.

const SHOTS = "test-results/guardians-roster";
const PORTAL = process.env.E2E_PORTAL_URL ?? "http://localhost:3002";
const DAY = 24 * 3600 * 1000;

const rowOf = (page: Page, name: string) => page.getByRole("row", { name: new RegExp(name) });

test("the guardian roster shows every parent's portal access and lets an owner act on it", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const page = admin.page;

  const child = await apiCreateStudent(admin.api, {
    admissionNumber: `GR/${suffix}`,
    firstName: "Tobenna",
    lastName: "Eze",
    dateOfBirth: "2012-01-10T00:00:00.000Z",
    gender: "MALE",
  });

  // One guardian in each state. Written directly: the states (an expired
  // invitation, an active account) are what the roster must REPORT, and
  // producing them through the UI would mean waiting seven days.
  const ids = await withTenant(admin.schoolId, async (db) => {
    const make = async (firstName: string, email: string | null, passwordHash: string | null) =>
      (
        await db.guardian.create({
          data: {
            schoolId: admin.schoolId,
            firstName,
            lastName: "Eze",
            relationship: "MOTHER",
            phone: `+2348${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
            email,
            passwordHash,
            emailVerified: passwordHash !== null,
          },
          select: { id: true },
        })
      ).id;
    const never = await make("Nneka", `nneka-${suffix}@school-kit.test`, null);
    const expired = await make("Obiageli", `obi-${suffix}@school-kit.test`, null);
    const active = await make("Adaeze", `ada-${suffix}@school-kit.test`, "argon2-not-a-real-hash");
    const noEmail = await make("Chioma", null, null);
    await db.studentGuardian.create({
      data: { schoolId: admin.schoolId, studentId: child.id, guardianId: never, isPrimary: true, canPickup: true },
    });
    await db.guardianInvitation.create({
      data: {
        schoolId: admin.schoolId,
        guardianId: expired,
        invitedBy: admin.ownerUserId,
        tokenHash: `expired-${suffix}`,
        expiresAt: new Date(Date.now() - DAY),
      },
    });
    return { never, expired, active, noEmail };
  });

  try {
    // ---- 1. Sidebar → roster, every state reported --------------------------
    // Start from /students, not /dashboard: the dashboard rewrites its own URL
    // after loading, which can swallow a sidebar click made before it settles.
    await page.goto("/students");
    await expect(page.getByRole("heading", { name: "Students", level: 1 })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("link", { name: "Guardians" }).first().click();
    await expect(page).toHaveURL(/\/guardians$/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Guardians", level: 1 })).toBeVisible({ timeout: 60_000 });

    const table = page.getByRole("table", { name: "Guardians" });
    await expect(table.getByRole("row")).toHaveCount(5); // header + 4
    await expect(rowOf(page, "Nneka")).toContainText("Not invited");
    await expect(rowOf(page, "Nneka").getByRole("link", { name: "Tobenna Eze" })).toHaveAttribute(
      "href",
      `/students/${child.id}`,
    );
    await expect(rowOf(page, "Obiageli")).toContainText("Invitation expired");
    await expect(rowOf(page, "Obiageli")).toContainText("Not linked to a student");
    await expect(rowOf(page, "Adaeze")).toContainText("Portal active");
    await expect(rowOf(page, "Chioma")).toContainText("No email");

    // ---- 4. No actions for an active parent or a parent without email -------
    await expect(rowOf(page, "Adaeze").getByRole("button")).toHaveCount(0);
    await expect(rowOf(page, "Chioma").getByRole("button")).toHaveCount(0);
    await expect(rowOf(page, "Chioma")).toContainText("Add an email from their child's page");
    await page.screenshot({ path: `${SHOTS}/1-roster.png`, fullPage: true });

    // ---- 2. Server-side filter, kept in the URL -----------------------------
    const listRequests: string[] = [];
    page.on("request", (r) => {
      if (/\/guardians\?/.test(r.url())) listRequests.push(r.url());
    });
    await page.getByLabel("Portal access").selectOption("NOT_INVITED");
    await expect(page).toHaveURL(/status=NOT_INVITED/);
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(rowOf(page, "Nneka")).toBeVisible();
    expect(listRequests.some((u) => u.includes("portalStatus=NOT_INVITED"))).toBe(true);
    await page.reload();
    await expect(page.getByLabel("Portal access")).toHaveValue("NOT_INVITED", { timeout: 60_000 });
    await expect(page.getByRole("table", { name: "Guardians" }).getByRole("row")).toHaveCount(2);
    await page.screenshot({ path: `${SHOTS}/2-filter-not-invited.png`, fullPage: true });

    // ---- 3. Invite, Resend, Cancel from the roster ---------------------------
    await page.getByLabel("Portal access").selectOption("ALL");
    await expect(page).toHaveURL(/\/guardians$/);
    await rowOf(page, "Nneka").getByRole("button", { name: "Invite" }).click();
    await expect(rowOf(page, "Nneka")).toContainText("Invitation pending");
    await expect(rowOf(page, "Nneka")).toContainText(/Expires /);
    const firstUrl = await page.getByLabel(/Portal invite link for Nneka Eze/).inputValue();

    await rowOf(page, "Nneka").getByRole("button", { name: "Resend" }).click();
    await expect(page.getByText(/previous link no longer works/i)).toBeVisible();
    const secondUrl = await page.getByLabel(/Portal invite link for Nneka Eze/).inputValue();
    expect(secondUrl).not.toBe(firstUrl);
    await page.screenshot({ path: `${SHOTS}/3-resent.png`, fullPage: true });

    const anon = await browser.newContext();
    const portal = await anon.newPage();
    await portal.goto(`${PORTAL}/invitations/${firstUrl.split("/invitations/")[1]}`);
    await expect(portal.getByRole("heading", { name: "Invitation not available" })).toBeVisible({ timeout: 60_000 });
    await portal.goto(`${PORTAL}/invitations/${secondUrl.split("/invitations/")[1]}`);
    await expect(portal.getByLabel("Choose a password")).toBeVisible({ timeout: 60_000 });

    await rowOf(page, "Nneka").getByRole("button", { name: "Cancel invite" }).click();
    await expect(rowOf(page, "Nneka")).toContainText("Not invited");
    await portal.goto(`${PORTAL}/invitations/${secondUrl.split("/invitations/")[1]}`);
    await expect(portal.getByRole("heading", { name: "Invitation not available" })).toBeVisible({ timeout: 60_000 });
    await anon.close();

    // ---- 5. An expired invitation can be sent again -------------------------
    await rowOf(page, "Obiageli").getByRole("button", { name: "Invite again" }).click();
    await expect(rowOf(page, "Obiageli")).toContainText("Invitation pending");

    // ---- Search -------------------------------------------------------------
    await page.getByPlaceholder("Name or phone").fill("Adaeze");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/q=Adaeze/);
    await expect(page.getByRole("table", { name: "Guardians" }).getByRole("row")).toHaveCount(2);
    await page.screenshot({ path: `${SHOTS}/4-search.png`, fullPage: true });

    // Nothing touched the parent who already had an account.
    const activeNow = await withTenant(admin.schoolId, async (db) => ({
      hash: (await db.guardian.findUniqueOrThrow({ where: { id: ids.active }, select: { passwordHash: true } })).passwordHash,
      invitations: await db.guardianInvitation.count({ where: { guardianId: ids.active } }),
    }));
    expect(activeNow).toEqual({ hash: "argon2-not-a-real-hash", invitations: 0 });

    // ---- 6. A bursar is refused ---------------------------------------------
    const bursarEmail = `e2e-bursar-${suffix}@school-kit.test`;
    const { rawToken } = await seedTeacherInvitation({
      schoolId: admin.schoolId,
      invitedByUserId: admin.ownerUserId,
      email: bursarEmail,
      firstName: "Bola",
      lastName: "Bursar",
      roleKey: "bursar",
    });
    const anonApi = await createApiContext();
    expect(
      (await anonApi.post(`invitations/${rawToken}/accept`, {
        data: { firstName: "Bola", lastName: "Bursar", password: "Password1!", ndprConsent: true },
      })).ok(),
    ).toBe(true);
    await anonApi.dispose();
    const bursar = await loginAsTeacher(browser, bursarEmail, "Password1!");
    const bursarApi = await createApiContext(bursar.token);
    try {
      await bursar.page.goto("/finance/dashboard");
      await expect(bursar.page.getByRole("link", { name: "Finance" }).first()).toBeVisible({ timeout: 60_000 });
      await expect(bursar.page.getByRole("link", { name: "Guardians" })).toHaveCount(0);
      expect((await bursarApi.get("guardians")).status()).toBe(403);
      expect((await bursarApi.post(`guardians/${ids.never}/invite`)).status()).toBe(403);
    } finally {
      await bursarApi.dispose();
      await bursar.context.close();
    }
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});
