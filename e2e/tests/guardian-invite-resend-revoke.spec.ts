import { expect, test } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { apiCreateStudent } from "../fixtures/finance.js";
import { createApiContext, loginAsAdmin, uniqueSuffix } from "../fixtures/index.js";

// Guardian portal invitations: resend and cancel (2026-09-16).
//
// The friction: an invitation could be issued once and then only waited out.
// The accept link is shown once in the browser and never stored, delivery is
// best-effort, and the TTL is 7 days — so "the parent never got the email"
// or "we typed the wrong address" left a school stuck for a week. Measured in
// production the same day: 5 of 17 real invitations had expired unaccepted.
//
// This drives the real admin UI and then checks the database and the public
// accept page, because the load-bearing claim is not "a button exists" — it is
// that the link a parent already holds STOPS WORKING when it is replaced or
// cancelled.

const SHOTS = "test-results/guardian-invite";
const PORTAL = process.env.E2E_PORTAL_URL ?? "http://localhost:3002";

test("an admin resends and cancels a portal invitation; superseded and cancelled links stop working", async ({
  browser,
}) => {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const page = admin.page;
  const email = `parent-${suffix}@school-kit.test`;

  const student = await apiCreateStudent(admin.api, {
    admissionNumber: `GI/${suffix}`,
    firstName: "Chidera",
    lastName: "Nwosu",
    dateOfBirth: "2013-04-02T00:00:00.000Z",
    gender: "FEMALE",
  });

  const liveTokens = () =>
    withTenant(admin.schoolId, (db) =>
      db.guardianInvitation.findMany({
        where: { revokedAt: null, acceptedAt: null },
        select: { id: true },
      }),
    );

  try {
    // ---- A guardian with an email, linked to the student --------------------
    // Seeded over the API: adding a guardian is not what this test is about,
    // and the invite, resend and cancel below all go through the real UI.
    const linked = await admin.api.post(`students/${student.id}/guardians/new`, {
      data: {
        firstName: "Ngozi",
        lastName: "Nwosu",
        relationship: "MOTHER",
        phone: `+23480${suffix.replace(/\D/g, "").padEnd(8, "7").slice(0, 8)}`,
        email,
        isPrimary: true,
      },
    });
    expect(linked.ok(), await linked.text()).toBe(true);

    await page.goto(`/students/${student.id}`);
    await page.getByRole("tab", { name: "Guardians" }).click();
    await expect(page.getByText("Ngozi Nwosu")).toBeVisible();

    // ---- First invite ------------------------------------------------------
    await page.getByRole("button", { name: "Invite to portal" }).click();
    await expect(page.getByRole("button", { name: "Invitation sent" })).toBeVisible();
    const firstUrl = await page.getByRole("textbox", { name: /Portal invite link/ }).inputValue();
    expect(firstUrl).toContain("/invitations/");
    expect(await liveTokens()).toHaveLength(1);
    await page.screenshot({ path: `${SHOTS}/1-invited.png`, fullPage: true });

    // The first link genuinely works before it is replaced — otherwise the
    // "stops working" assertions below would pass for the wrong reason.
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(`${PORTAL}/invitations/${firstUrl.split("/invitations/")[1]}`);
    await expect(anonPage.getByLabel("Choose a password")).toBeVisible({ timeout: 60_000 });

    // ---- Resend: a new link, and the first one dies ------------------------
    await page.getByRole("button", { name: "Resend invite" }).click();
    await expect(page.getByText(/previous link no longer works/i)).toBeVisible();
    const secondUrl = await page.getByRole("textbox", { name: /Portal invite link/ }).inputValue();
    expect(secondUrl).not.toBe(firstUrl);
    // Exactly one live token, never two.
    expect(await liveTokens()).toHaveLength(1);
    await page.screenshot({ path: `${SHOTS}/2-resent.png`, fullPage: true });

    await anonPage.goto(`${PORTAL}/invitations/${firstUrl.split("/invitations/")[1]}`);
    await expect(anonPage.getByRole("heading", { name: "Invitation not available" })).toBeVisible({ timeout: 60_000 });
    await expect(anonPage.getByLabel("Choose a password")).toHaveCount(0);
    await anonPage.screenshot({ path: `${SHOTS}/3-old-link-dead.png`, fullPage: true });

    // The new one does work.
    await anonPage.goto(`${PORTAL}/invitations/${secondUrl.split("/invitations/")[1]}`);
    await expect(anonPage.getByLabel("Choose a password")).toBeVisible({ timeout: 60_000 });

    // ---- Cancel: nothing live is left --------------------------------------
    await page.getByRole("button", { name: "Cancel invite" }).click();
    await expect(page.getByText(/Invitation cancelled/i)).toBeVisible();
    expect(await liveTokens()).toHaveLength(0);

    await anonPage.goto(`${PORTAL}/invitations/${secondUrl.split("/invitations/")[1]}`);
    await expect(anonPage.getByRole("heading", { name: "Invitation not available" })).toBeVisible({ timeout: 60_000 });
    await expect(anonPage.getByLabel("Choose a password")).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/4-cancelled.png`, fullPage: true });
    await anon.close();

    // ---- After cancelling, a plain invite works again -----------------------
    await page.reload();
    await page.getByRole("tab", { name: "Guardians" }).click();
    await page.getByRole("button", { name: "Invite to portal" }).click();
    await expect(page.getByRole("button", { name: "Invitation sent" })).toBeVisible();
    expect(await liveTokens()).toHaveLength(1);

    // ---- Audit: every action is recorded, with the email redacted ----------
    const audit = await withTenant(admin.schoolId, (db) =>
      db.auditLog.findMany({
        where: { action: { in: ["guardian.invite", "guardian.invite-resend", "guardian.invite-revoke"] } },
        select: { action: true, metadata: true },
      }),
    );
    const actions = audit.map((r) => r.action).sort();
    expect(actions).toEqual(["guardian.invite", "guardian.invite", "guardian.invite-resend", "guardian.invite-revoke"]);
    expect(JSON.stringify(audit)).not.toContain(email);

    // ---- A bursar-less check: the API refuses an unauthenticated call ------
    const anonApi = await createApiContext();
    const guardianId = (
      await withTenant(admin.schoolId, (db) => db.guardian.findFirstOrThrow({ select: { id: true } }))
    ).id;
    for (const path of [`guardians/${guardianId}/invite/resend`, `guardians/${guardianId}/invite/revoke`]) {
      expect((await anonApi.post(path)).status()).toBe(401);
    }
    await anonApi.dispose();
    expect(await liveTokens()).toHaveLength(1);
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});
