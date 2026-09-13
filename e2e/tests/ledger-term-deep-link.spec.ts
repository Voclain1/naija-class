import { expect, test } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";

// Finance dashboard → "Detailed ledger view" → invoice list filtered to the
// dashboard's term. Real API, real Postgres, real link click.
//
// The two terms are deliberately in the SAME academic year, each with one
// invoice, so "filtered" cannot pass by accident: an unfiltered list shows
// both students.

async function createStudent(api: import("@playwright/test").APIRequestContext, suffix: string, firstName: string) {
  const res = await api.post("students", {
    data: {
      admissionNumber: `SKA/LED/${suffix}`,
      firstName,
      lastName: "Eze",
      dateOfBirth: "2013-04-02T00:00:00.000Z",
      gender: "MALE",
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { id: string }).id;
}

test("dashboard ledger link filters the invoice list to the dashboard's term, and never pre-selects it for generation", async ({
  browser,
}) => {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  // setupAcademicStructure flags its year AND its term current, so the
  // dashboard lands on term 1 without anyone choosing it — the exact case the
  // generation guard exists for.
  const structure = await setupAcademicStructure(admin.api, { subjectCode: `led-${suffix}` });
  const termOneStudent = await createStudent(admin.api, `${suffix}-1`, "Obinna");
  const termTwoStudent = await createStudent(admin.api, `${suffix}-2`, "Tobenna");

  const term2Id = await withTenant(admin.schoolId, async (db) => {
    const term2 = await db.term.create({
      data: {
        schoolId: admin.schoolId,
        academicYearId: structure.academicYearId,
        sequence: 2,
        name: "Second Term",
        startDate: new Date("2027-01-05"),
        endDate: new Date("2027-04-10"),
      },
      select: { id: true },
    });
    const invoice = (studentId: string, termId: string) =>
      db.invoice.create({
        data: {
          schoolId: admin.schoolId,
          studentId,
          termId,
          academicYearId: structure.academicYearId,
          status: "ISSUED",
          items: [],
          totalAmount: 80_000_00,
          totalDiscount: 0,
          totalDue: 80_000_00,
          totalPaid: 0,
          issuedAt: new Date(),
        },
      });
    await invoice(termOneStudent, structure.termId);
    await invoice(termTwoStudent, term2.id);
    return term2.id;
  });

  // Record every invoice-LIST request the page makes (not /invoices/:id).
  const listRequests: string[] = [];
  admin.page.on("request", (req) => {
    const url = new URL(req.url());
    if (req.method() === "GET" && /\/api\/v1\/invoices$/.test(url.pathname)) listRequests.push(url.search);
  });

  const page = admin.page;
  try {
    // ── 1. The real link, from the real dashboard ──
    await page.goto("/finance/dashboard");
    const ledgerLink = page.getByRole("link", { name: /Detailed ledger view/ });
    await expect(ledgerLink).toBeVisible();
    const href = await ledgerLink.getAttribute("href");
    expect(href).toContain(`termId=${structure.termId}`);
    expect(href).toContain(`yearId=${structure.academicYearId}`);

    await ledgerLink.click();
    await page.waitForURL(/\/finance\/invoices\?/);
    await expect(page.getByRole("tab", { name: "Invoice list" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("Term")).toHaveValue(structure.termId);
    await expect(page.getByRole("link", { name: "Obinna Eze" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Tobenna Eze" })).toHaveCount(0);
    await page.screenshot({ path: "test-results/ledger-term-deep-link/1-filtered-list.png", fullPage: true });

    // No unfiltered request was ever made — the whole-school ledger did not
    // flash up before the filter landed.
    expect(listRequests.length).toBeGreaterThan(0);
    for (const search of listRequests) expect(search).toContain(`termId=${structure.termId}`);

    // ── 2. Generation never inherits the linked term ──
    await page.getByRole("tab", { name: "Generate" }).click();
    await expect(page.getByLabel("Term")).toHaveValue("");
    await expect(page.getByText("The term from the finance dashboard only filtered the invoice list.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate invoices" })).toBeDisabled();
    await page.screenshot({ path: "test-results/ledger-term-deep-link/2-generate-cleared.png", fullPage: true });

    // A term the bursar picks themselves IS kept for generation.
    await page.getByLabel("Term").selectOption(term2Id);
    await expect(page.getByText("The term from the finance dashboard only filtered the invoice list.")).toHaveCount(0);
    await expect(page.getByLabel("Term")).toHaveValue(term2Id);

    // ── 3. Links that name no term of this school ──
    for (const bogus of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      listRequests.length = 0;
      await page.goto(`/finance/invoices?tab=list&yearId=${structure.academicYearId}&termId=${bogus}`);
      await expect(page.getByText("The term in this link could not be found for your school")).toBeVisible();
      await expect(page.getByLabel("Term")).toHaveValue("");
      // Unfiltered, and SAYS so — both terms' invoices, no 400 error state.
      await expect(page.getByRole("link", { name: "Obinna Eze" }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "Tobenna Eze" }).first()).toBeVisible();
      await expect(page.getByText("Could not load invoices")).toHaveCount(0);
      for (const search of listRequests) expect(search).not.toContain(bogus);
    }
    await page.screenshot({ path: "test-results/ledger-term-deep-link/3-bogus-link.png", fullPage: true });

    // ── 4. No link at all: page behaves exactly as before ──
    await page.goto("/finance/invoices");
    await expect(page.getByRole("tab", { name: "Generate" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("Term")).toHaveValue("");
    await expect(page.getByText("could not be found for your school")).toHaveCount(0);
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});
