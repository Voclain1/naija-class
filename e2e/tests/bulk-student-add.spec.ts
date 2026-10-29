import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";

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

for (const mode of ["MANUAL", "SCHOOL", "RANDOM", "CLASS"] as const) {
  test(`bulk entry explicitly places only the new pupils with ${mode} numbering`, async ({ browser }) => {
    const admin = await loginAsAdmin(browser);
    try {
      const structure = await setupAcademicStructure(admin.api, {
        arms: [{ name: "Intake A", code: "intake-a" }, { name: "Other B", code: "other-b" }],
      });
      if (mode !== "MANUAL") {
        const settings = await admin.api.patch("schools/me/admission-numbers", {
          data: { mode: "AUTO", format: mode === "CLASS" ? "{CLASS}/{NNNN}" : "QA/{NNNNN}", order: mode },
        });
        expect(settings.ok(), await settings.text()).toBe(true);
      }
      const existing = await admin.api.post("students", {
        data: { admissionNumber: `OLD-${uniqueSuffix()}`, firstName: "Existing", lastName: "Pupil", dateOfBirth: "2012-01-01", gender: "MALE" },
      });
      expect(existing.ok(), await existing.text()).toBe(true);

      const page = admin.page;
      const posts: Array<{ enrollment?: { termId: string; classArmId: string } }> = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && request.url().endsWith("/students/bulk")) {
          posts.push(request.postDataJSON() as typeof posts[number]);
        }
      });
      await page.goto(`${WEB}/students/new/bulk`);
      await expect(page.getByText(mode === "MANUAL" ? "Admission numbers: typed by you" : /Admission numbers: automatic/)).toBeVisible();
      const choice = page.getByRole("combobox", { name: "Class", exact: true });
      await expect(choice).toHaveValue("");
      await fillRow(page, 0, mode === "MANUAL" ? `NEW-${uniqueSuffix()}` : "", "Intake");
      await page.getByRole("button", { name: /create students/i }).click();
      await expect(page.getByText("Choose a class for this batch, or choose to place the students later.")).toBeVisible();
      expect(posts).toHaveLength(0);

      if (mode === "CLASS") {
        await choice.selectOption("__later__");
        await page.getByRole("button", { name: /create students/i }).click();
        await expect(page.getByText("Choose the class for these students, so SchoolKit can number them per class.")).toBeVisible();
        expect(posts).toHaveLength(0);
      }

      await choice.selectOption(structure.arms[0]!.id);
      await expect(page.getByRole("combobox", { name: "Term", exact: true })).toHaveValue(structure.termId);
      await page.getByRole("button", { name: /create students/i }).click();
      await expect(page.getByText("All 1 student created.")).toBeVisible();
      await expect(page.getByText("They were also added to the class and term selected above.")).toBeVisible();
      expect(posts).toHaveLength(1);
      expect(posts[0]!.enrollment).toEqual({ termId: structure.termId, classArmId: structure.arms[0]!.id });
      await expect(choice).toBeDisabled();

      const enrollments = await admin.api.get(`enrollments?termId=${structure.termId}`);
      expect(enrollments.ok(), await enrollments.text()).toBe(true);
      const body = await enrollments.json() as { data: Array<{ studentId: string; classArmId: string }> };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]!.classArmId).toBe(structure.arms[0]!.id);
      expect(body.data[0]!.studentId).not.toBe((await existing.json() as { id: string }).id);
    } finally {
      await admin.context.close();
      await admin.api.dispose();
    }
  });
}

test("bulk entry can explicitly leave pupils unplaced", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  try {
    const structure = await setupAcademicStructure(admin.api);
    await admin.page.goto(`${WEB}/students/new/bulk`);
    await fillRow(admin.page, 0, `LATER-${uniqueSuffix()}`, "Later");
    await admin.page.getByRole("combobox", { name: "Class", exact: true }).selectOption("__later__");
    await admin.page.getByRole("button", { name: /create students/i }).click();
    await expect(admin.page.getByText("All 1 student created.")).toBeVisible();
    await expect(admin.page.getByText(/They are not in a class yet\./)).toBeVisible();
    const response = await admin.api.get(`enrollments?termId=${structure.termId}`);
    expect(response.ok(), await response.text()).toBe(true);
    expect((await response.json() as { data: unknown[] }).data).toEqual([]);
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});

test("old bulk-enrollment links show the carry-over restriction before loading candidates", async ({ browser }) => {
  const admin = await loginAsAdmin(browser);
  try {
    const structure = await setupAcademicStructure(admin.api);
    const enrollmentRequests: string[] = [];
    admin.page.on("request", (request) => {
      if (/\/api\/v1\/enrollments(?:[/?]|$)/.test(request.url())) enrollmentRequests.push(request.url());
    });
    for (const query of ["", `?armId=${structure.arms[0]!.id}&termId=${structure.termId}`]) {
      await admin.page.goto(`${WEB}/enrollments/bulk${query}`);
      await expect(admin.page.getByRole("heading", { name: "Carry over is temporarily unavailable" })).toBeVisible();
      await expect(admin.page.getByText(/Missing armId|Carry over button/)).toHaveCount(0);
      await expect(admin.page.getByRole("link", { name: "Add students to a class" })).toBeVisible();
      await expect(admin.page.getByRole("link", { name: "Find an existing student" })).toBeVisible();
    }
    expect(enrollmentRequests).toEqual([]);
    await admin.page.getByRole("link", { name: "Add students to a class" }).click();
    await expect(admin.page.getByRole("combobox", { name: "Class", exact: true })).toBeVisible();
    await expect(admin.page.getByRole("link", { name: "bulk enrollment", exact: true })).toHaveCount(0);
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});

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

  // Placement is now an explicit prerequisite in every numbering mode. These
  // cases test batch validation/numbering, so deliberately defer enrollment.
  await page.getByRole("combobox", { name: "Class", exact: true }).selectOption("__later__");
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

// Admission numbers assigned by SchoolKit (docs/modules/admission-numbers.md).

test("a new school is asked how it gives admission numbers, and SchoolKit numbers the grid", async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await loginAsAdmin(browser, { admissionNumbersUndecided: true });
  const page = admin.page;
  const year = new Date().getFullYear();

  await page.goto(`${WEB}/students/new/bulk`);
  const question = page.getByRole("dialog");
  await expect(question.getByText("How does your school give admission numbers?")).toBeVisible({ timeout: 60_000 });
  await question.getByRole("button", { name: /SchoolKit assigns them/ }).click();
  await question.getByLabel("Your admission number format").fill("E2E/{YYYY}/{NNNN}");
  await expect(question.getByText(`E2E/${year}/0001, E2E/${year}/0002, E2E/${year}/0003…`)).toBeVisible();
  await question.getByRole("button", { name: "Use this format" }).click();
  await expect(question).toBeHidden();
  await expect(page.getByText(/Admission numbers: automatic/)).toBeVisible();

  await page.getByRole("combobox", { name: "Class", exact: true }).selectOption("__later__");

  // Three rows with no admission number at all.
  for (const [i, first] of ["Ada", "Bisi", "Chinedu"].entries()) {
    const row = page.locator("tbody tr").nth(i);
    await row.locator(`[data-cell="${i}:1"]`).fill(first);
    await row.locator(`[data-cell="${i}:3"]`).fill("Auto");
    await row.locator(`[data-cell="${i}:4"]`).fill("2013-02-03");
    await row.locator(`[data-cell="${i}:5"]`).selectOption("FEMALE");
  }
  await page.getByRole("button", { name: /create students/i }).click();
  await expect(page.getByText("All 3 students created.")).toBeVisible({ timeout: 30_000 });

  // The grid shows the numbers SchoolKit gave, in row order.
  for (const [i, n] of ["0001", "0002", "0003"].entries()) {
    await expect(page.locator(`[data-cell="${i}:0"]`)).toHaveValue(`E2E/${year}/${n}`);
  }
  const res = await admin.api.get("students?limit=200");
  const body = (await res.json()) as { data: { admissionNumber: string }[] };
  expect(body.data.map((s) => s.admissionNumber).sort()).toEqual([`E2E/${year}/0001`, `E2E/${year}/0002`, `E2E/${year}/0003`]);

  // Asked once: the question does not come back.
  await page.reload();
  await expect(page.getByText(/Admission numbers: automatic/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("How does your school give admission numbers?")).toHaveCount(0);

  await admin.context.close();
  await admin.api.dispose();
});

test("Settings turns on random numbers; the Change dialog switches back to typing", async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await loginAsAdmin(browser);
  const page = admin.page;

  await page.goto(`${WEB}/settings`);
  await page.getByRole("link", { name: /Admission numbers/ }).click();
  await expect(page.getByRole("heading", { name: "Admission numbers" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Now: typed by you/)).toBeVisible();

  await page.getByRole("radio", { name: /Random/ }).check();
  await page.getByLabel("Your admission number format").fill("R{NNNNN}");
  await page.getByRole("button", { name: "Turn on automatic numbers" }).click();
  await expect(page.getByText(/Now: automatic/)).toBeVisible({ timeout: 30_000 });

  const created = await admin.api.post("students", {
    data: { firstName: "Rand", lastName: "Om", dateOfBirth: "2012-01-01", gender: "MALE" },
  });
  expect(created.ok(), await created.text()).toBe(true);
  expect(((await created.json()) as { admissionNumber: string }).admissionNumber).toMatch(/^R\d{5}$/);

  await page.goto(`${WEB}/students/new/bulk`);
  await expect(page.getByText(/Admission numbers: automatic/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Change" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Automatic admission numbers")).toBeVisible();
  await dialog.getByRole("button", { name: "Type numbers instead" }).click();
  await expect(page.getByText("Admission numbers: typed by you")).toBeVisible({ timeout: 30_000 });

  await admin.context.close();
  await admin.api.dispose();
});
