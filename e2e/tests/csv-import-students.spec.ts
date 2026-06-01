import { expect, test, type BrowserContext } from "@playwright/test";

import { loginAsAdmin } from "../fixtures/index.js";
import { buildStudentsImportCsv } from "../fixtures/csv.js";
import { uniqueSuffix } from "../fixtures/unique.js";

// Slice 13 — acceptance #6 / #12: the CSV student-import wizard, end to end
// through the real UI, using a fixture CSV. Drives all four steps (upload →
// map → validate/preview → commit/done) and asserts the acceptance numbers:
// 250 rows, 242 imported, 8 in the error report.
//
// Discipline (see fixtures/): one fresh ACTIVE school per test (loginAsAdmin),
// UI-driven for the wizard under test, specific DOM/URL waits (never sleeps).
// The validate + commit steps run on BullMQ workers, so the preview/done pages
// poll — we wait on the resulting on-screen counts with a generous timeout.

test("acceptance #6 — student CSV import wizard: upload → map → preview → commit", async ({
  browser,
}) => {
  const fixture = buildStudentsImportCsv(uniqueSuffix());
  const toClose: BrowserContext[] = [];
  const admin = await loginAsAdmin(browser);
  toClose.push(admin.context);
  const page = admin.page;

  try {
    // --- Step 1: upload --------------------------------------------------
    await page.goto("/students/import");
    await expect(
      page.getByRole("heading", { name: /import students from csv/i }),
    ).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles({
      name: "students.csv",
      mimeType: "text/csv",
      buffer: fixture.buffer,
    });

    // Upload accepted → mapping step.
    await page.waitForURL(/\/students\/import\/[^/]+\/mapping$/);
    const jobId = page.url().match(/\/import\/([^/]+)\/mapping$/)?.[1];
    expect(jobId, "jobId in mapping URL").toBeTruthy();

    // --- Step 2: map (synonym guesser pre-maps all required fields) ------
    await expect(
      page.getByRole("heading", { name: /map your columns/i }),
    ).toBeVisible();
    // The file's totalRows is surfaced; confirms the upload parsed.
    await expect(page.getByText(`${fixture.total}`, { exact: false })).toBeVisible();

    // All required fields auto-map → Validate is enabled.
    const validateButton = page.getByRole("button", { name: /^validate$/i });
    await expect(validateButton).toBeEnabled();
    await validateButton.click();

    // --- Step 3: validate + preview (worker; page polls) ----------------
    await page.waitForURL(/\/students\/import\/[^/]+\/preview$/);
    // Wait out VALIDATING → READY, then assert the good/bad split.
    await expect(
      page.getByText(`Ready to import (${fixture.good})`),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText(`Needs fixing (${fixture.bad})`),
    ).toBeVisible();

    // --- Step 4: commit + done (worker; page polls) ---------------------
    await page.getByRole("button", { name: new RegExp(`commit ${fixture.good} students`, "i") }).click();
    await page.waitForURL(/\/students\/import\/[^/]+\/done$/);
    await expect(
      page.getByText(`Imported ${fixture.good} students.`),
    ).toBeVisible({ timeout: 60_000 });
    // The error report (the 8 bad rows) is offered.
    await expect(page.getByText(/error report ready/i)).toBeVisible();

    // --- Verify the error report contains exactly the 8 bad rows ---------
    // Fetched over the bearer-authed API context (avoids browser-download
    // flakiness); the endpoint streams the CSV with an `_errors` column.
    const res = await admin.api.get(`imports/${jobId}/error-report.csv`);
    expect(res.ok(), `error-report status ${res.status()}`).toBeTruthy();
    const csv = await res.text();
    const rows = csv
      .replace(/^﻿/, "")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    // header + 8 bad data rows.
    expect(rows.length).toBe(fixture.bad + 1);
    expect(rows[0].toLowerCase()).toContain("_errors");

    // --- The roster reflects the committed students ---------------------
    const list = await admin.api.get(`students?limit=1`);
    expect(list.ok()).toBeTruthy();
    const body = (await list.json()) as { meta?: { total?: number } };
    if (typeof body.meta?.total === "number") {
      expect(body.meta.total).toBe(fixture.good);
    }
  } finally {
    for (const ctx of toClose) await ctx.close();
    await admin.api.dispose();
  }
});
