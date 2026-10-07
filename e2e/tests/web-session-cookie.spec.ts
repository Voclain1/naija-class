import { expect, test } from "@playwright/test";

import { API_BASE_URL, loginAsAdmin } from "../fixtures/index.js";

// The staff web session never enters page JavaScript (docs/deferred.md item 1).
// Signing in through the real form, then using the app:
//   - no response the page can read carries the session token;
//   - no request to the API carries an Authorization header: the browser
//     sends the HttpOnly sk_session cookie and the API reads it;
//   - document.cookie cannot see it.

const WEB = process.env.E2E_WEB_URL ?? "http://localhost:3001";

test("signing in and working leaves the session token out of reach of page scripts", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  const context = await browser.newContext();
  const page = await context.newPage();

  const apiOrigin = new URL(API_BASE_URL).origin;
  const bodies: string[] = [];
  const authHeaders: string[] = [];
  page.on("request", (req) => {
    if (req.url().startsWith(apiOrigin) && req.headers().authorization) authHeaders.push(req.url());
  });
  page.on("response", async (res) => {
    const type = res.headers()["content-type"] ?? "";
    if (type.includes("application/json")) bodies.push(await res.text().catch(() => ""));
  });

  try {
    await page.goto(`${WEB}/login`);
    await page.getByLabel("Email").fill(admin.email);
    await page.getByLabel("Password", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await page.waitForURL(/\/dashboard/);

    // Use the app: a hard reload (cold-boot hydration) and a second page.
    await page.reload();
    await page.goto(`${WEB}/students`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });

    const cookie = (await context.cookies()).find((c) => c.name === "sk_session");
    expect(cookie?.httpOnly).toBe(true);
    const token = cookie!.value;

    expect(bodies.length).toBeGreaterThan(3);
    for (const body of bodies) expect(body).not.toContain(token);
    expect(bodies.some((b) => b.includes('"authenticated":true'))).toBe(true);
    expect(authHeaders).toEqual([]);
    expect(await page.evaluate(() => document.cookie)).not.toContain("sk_session");
  } finally {
    await context.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
