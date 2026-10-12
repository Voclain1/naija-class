import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin, uniqueSuffix } from "../fixtures/index.js";

// The bulk add grid saves through POST /students/bulk (2026-10-12): one
// all-or-nothing request per 200 rows, where it used to send one request per
// student. A taken admission number fails the request, adds nothing, and
// names its row; fixing it and submitting again adds the lot.
//
// SAFETY: a fresh school per test, via signup with a unique slug, against the
// local Postgres named in .env.

const WEB = "http://localhost:3001";

async function fillRow(page: Page, i: number, admission: string, first: string): Promise<void> {
  const row = page.locator("tbody tr").nth(i);
  await row.locator(`[data-cell="${i}:0"]`).fill(admission);
  await row.locator(`[data-cell="${i}:1"]`).fill(first);
  await row.locator(`[data-cell="${i}:3"]`).fill("Bulk");
  await row.locator(`[data-cell="${i}:4"]`).fill("2012-05-04");
  await row.locator(`[data-cell="${i}:5"]`).selectOption("MALE");
}

test("a taken admission number is named on its row, nothing is half-added, and a resubmit adds the rest", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = await loginAsAdmin(browser);
  const page = admin.page;
  const suffix = uniqueSuffix();
  const taken = `E2E-${suffix}-TAKEN`;

  const existing = await admin.api.post("students", {
    data: { admissionNumber: taken, firstName: "Already", lastName: "Here", dateOfBirth: "2012-01-01", gender: "MALE" },
  });
  expect(existing.ok(), await existing.text()).toBe(true);

  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/api\/v1\/students(\/bulk)?$/.test(r.url())) requests.push(new URL(r.url()).pathname);
  });

  await page.goto(`${WEB}/students/new/bulk`);
  await page.getByRole("heading", { name: "Add multiple students" }).waitFor({ timeout: 60_000 });
  await expect.poll(() => page.locator("tbody tr").count(), { timeout: 30_000 }).toBeGreaterThan(2);

  await fillRow(page, 0, `E2E-${suffix}-A`, "Ayo");
  await fillRow(page, 1, taken, "Bayo");
  await fillRow(page, 2, `E2E-${suffix}-C`, "Chika");

  await page.getByRole("button", { name: /create students/i }).click();
  await expect(page.getByText("Already in use.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/not added\. Fix the highlighted cells/)).toBeVisible();

  const roster = async () => {
    const res = await admin.api.get("students?limit=200");
    const body = (await res.json()) as { data: { admissionNumber: string }[] };
    return body.data.map((s) => s.admissionNumber).filter((a) => a.includes(suffix)).sort();
  };
  expect(await roster(), "nothing from the refused batch was added").toEqual([taken]);

  await page.locator('[data-cell="1:0"]').fill(`E2E-${suffix}-B`);
  await page.getByRole("button", { name: /create students/i }).click();
  await expect(page.getByText("All 3 students created.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "View roster" })).toBeVisible();

  expect(await roster()).toEqual([`E2E-${suffix}-A`, `E2E-${suffix}-B`, `E2E-${suffix}-C`, taken].sort());
  // One request per submit, never one per student.
  expect(requests).toEqual(["/api/v1/students/bulk", "/api/v1/students/bulk"]);

  await admin.context.close();
  await admin.api.dispose();
});

test("an admission number repeated in the grid is caught before anything is sent", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  const page = admin.page;
  const suffix = uniqueSuffix();

  let sent = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/v1/students/bulk")) sent += 1;
  });

  await page.goto(`${WEB}/students/new/bulk`);
  await page.getByRole("heading", { name: "Add multiple students" }).waitFor({ timeout: 60_000 });
  await expect.poll(() => page.locator("tbody tr").count(), { timeout: 30_000 }).toBeGreaterThan(1);

  await fillRow(page, 0, `E2E-${suffix}-X`, "Xena");
  await fillRow(page, 1, `E2E-${suffix}-X`, "Xavier");
  await page.getByRole("button", { name: /create students/i }).click();

  await expect(page.getByText("Same as row 1.")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/1 admission number is repeated/)).toBeVisible();
  expect(sent).toBe(0);

  await admin.context.close();
  await admin.api.dispose();
});
