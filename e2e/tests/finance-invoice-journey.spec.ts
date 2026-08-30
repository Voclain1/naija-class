import { expect, test, type Page } from "@playwright/test";

import {
  loginAsAdmin,
  setupAcademicStructure,
  uniqueSuffix,
  type AdminSession,
} from "../fixtures/index.js";
import { apiListInvoices, setupFinanceScaffold } from "../fixtures/finance.js";

// The bursar invoice journey, end to end in a real browser.
//
// SAFETY: every test here provisions its OWN school through loginAsAdmin
// (fresh signup, unique slug) against the LOCAL docker Postgres that
// DATABASE_URL points at. The invoices generated and cancelled below belong
// to a throwaway tenant — no real school's financial records are touched.
//
// Covers F-01 (cancellation confirmation), F-04 (human identity), F-05
// (empty vs error), F-29 (selector clarity / current context) and F-32
// (client navigation).

interface Scaffold {
  admin: AdminSession;
  page: Page;
  armName: string;
  termId: string;
  classArmId: string;
}

async function scaffold(browser: Parameters<typeof loginAsAdmin>[0]): Promise<Scaffold> {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 2 A", code: `jss2a-${suffix}`.slice(0, 20) }],
    subjectCode: `math-${suffix}`.slice(0, 20),
  });
  const arm = structure.arms[0]!;
  await setupFinanceScaffold(admin.api, {
    suffix,
    termId: structure.termId,
    classArmId: arm.id,
    classLevelId: structure.classLevelId,
    academicYearId: structure.academicYearId,
  });
  return {
    admin,
    page: admin.page,
    armName: arm.name,
    termId: structure.termId,
    classArmId: arm.id,
  };
}

/** Select year/term/class in the shared picker and switch to the list tab. */
async function selectContext(page: Page, armName: string): Promise<void> {
  // The academic year is pre-selected from isCurrent — assert that rather
  // than setting it, since it is part of what this slice changed.
  await expect(page.locator("#invoice-year")).not.toHaveValue("");
  // Index 1 = the first real term (index 0 is the "Choose a term" prompt).
  // Selected by position rather than label because the label now carries the
  // " (current)" suffix this slice adds.
  await page.locator("#invoice-term").selectOption({ index: 1 });
  await page.locator("#invoice-arm").selectOption({ label: armName });
}

/**
 * Generate invoices through the F-34 review gate.
 *
 * Before F-34, "Generate invoices" billed the arm on the click. It now opens a
 * review that states the arm, term, student count and naira total, and nothing
 * is created until that is confirmed — so every call site here that used to
 * assert on the result immediately must confirm first.
 *
 * The dedicated coverage for the gate itself lives in
 * finance-bulk-generation-confirmation.spec.ts; this helper only keeps the
 * pre-existing journey tests exercising the journey they are about.
 */
async function generateViaReview(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Generate invoices" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // The review loads its preview before it can state a count.
  await expect(page.getByText("Working out who would be invoiced")).toHaveCount(0, {
    timeout: 30000,
  });
  await page.getByRole("button", { name: /^Create \d+ invoices?$/ }).click();
}

test.describe("finance — invoice generation and list", () => {
  test("generation selectors are plain language, default the current year, and never auto-pick a term", async ({
    browser,
  }) => {
    const { admin, page, armName } = await scaffold(browser);
    await page.goto("/finance/invoices");

    // Wait for reference data to land BEFORE reading option text.
    // allTextContents() does NOT auto-wait, so reading it straight after
    // goto() races the client component's first render and returns [].
    // Asserting the pre-selected current year first is the natural barrier:
    // the value is only non-empty once listAcademicYears has resolved.
    await expect(page.locator("#invoice-year")).not.toHaveValue("");

    // F-29: no developer placeholders.
    const yearOptions = await page.locator("#invoice-year option").allTextContents();
    expect(yearOptions.some((o) => o.includes("Choose an academic year"))).toBe(true);
    expect(yearOptions.join(" ")).not.toContain("— year —");
    // The current year is labelled as such, so the pre-selection is legible.
    expect(yearOptions.some((o) => o.includes("(current)"))).toBe(true);

    // The TERM is deliberately NOT auto-selected — generation is a financial
    // write and this repo already refused a silent isCurrent default for the
    // equivalent import decision.
    await expect(page.locator("#invoice-term")).toHaveValue("");
    const termOptions = await page.locator("#invoice-term option").allTextContents();
    expect(termOptions.some((o) => o.includes("Choose a term"))).toBe(true);
    expect(termOptions.some((o) => o.includes("(current)"))).toBe(true);

    // Until a term and class are chosen, the page says what is needed.
    await expect(page.getByText("Choose an academic year, a term and a class")).toBeVisible();

    await selectContext(page, armName);

    // Once chosen, the page states exactly what generating will do.
    await expect(
      page.getByText(/Invoices will be created for every enrolled student in/),
    ).toBeVisible();

    await admin.context.close();
    await admin.api.dispose();
  });

  test("preview names students, generation reports a summary, and the list is human-readable", async ({
    browser,
  }) => {
    const { admin, page, armName, termId, classArmId } = await scaffold(browser);
    await page.goto("/finance/invoices");
    await selectContext(page, armName);

    // ── Preview names the students (F-04 on the generation preview) ──
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByText("Adaeze Okonkwo")).toBeVisible();
    await expect(page.getByText("Oluwaseun Adebayo-Ogundimu")).toBeVisible();
    await expect(page.getByText("Ibrahim Danjuma")).toBeVisible();
    // Realistic naira magnitude, formatted.
    await expect(page.getByText("₦135,000.00")).toBeVisible(); // 3 × ₦45,000

    // ── Generate ──
    await generateViaReview(page);
    await expect(page.getByText(/3 invoices created, 0 skipped/)).toBeVisible();

    // ── List ──
    await page.getByRole("tab", { name: "Invoice list" }).click();

    const table = page.getByRole("table");
    await expect(table.getByRole("columnheader", { name: "Student" })).toBeVisible();
    await expect(page.getByText("Adaeze Okonkwo")).toBeVisible();
    await expect(page.getByText("Oluwaseun Adebayo-Ogundimu")).toBeVisible();

    // Admission number as secondary identity.
    const invoices = await apiListInvoices(admin.api, { termId, classArmId });
    const admission = invoices.data[0]!.admissionNumber as string;
    await expect(page.getByText(admission)).toBeVisible();

    // F-04: no truncated UUID anywhere in the rendered table.
    const tableText = (await table.textContent()) ?? "";
    for (const invoice of invoices.data) {
      const studentId = invoice.studentId as string;
      expect(tableText).not.toContain(studentId);
      expect(tableText).not.toContain(studentId.slice(0, 8));
    }

    await admin.context.close();
    await admin.api.dispose();
  });

  test("long Nigerian names wrap instead of breaking the layout, at desktop and narrow widths", async ({
    browser,
  }) => {
    const { admin, page, armName } = await scaffold(browser);
    await page.goto("/finance/invoices");
    await selectContext(page, armName);
    await generateViaReview(page);
    await expect(page.getByText(/3 invoices created/)).toBeVisible();
    await page.getByRole("tab", { name: "Invoice list" }).click();
    await expect(page.getByText("Oluwaseun Adebayo-Ogundimu")).toBeVisible();

    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 }, // narrow phone-width browser
    ]) {
      await page.setViewportSize(viewport);
      // The page body must never scroll horizontally: wide content scrolls
      // inside the table's own overflow container instead.
      const bodyOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(bodyOverflow, `horizontal page overflow at ${viewport.width}px`).toBeLessThanOrEqual(1);
      await expect(page.getByText("Oluwaseun Adebayo-Ogundimu")).toBeVisible();
    }

    await admin.context.close();
    await admin.api.dispose();
  });
});

test.describe("finance — invoice list states (F-05)", () => {
  test("an empty term says 'No invoices yet', a filter says something different, and neither is used for an error", async ({
    browser,
  }) => {
    const { admin, page, armName } = await scaffold(browser);
    await page.goto("/finance/invoices");
    await selectContext(page, armName);
    await page.getByRole("tab", { name: "Invoice list" }).click();

    // Genuine zero — nothing generated yet.
    await expect(page.getByText("No invoices yet")).toBeVisible();
    await expect(page.getByText(/Use the .*Generate.* tab/)).toBeVisible();

    // Generate, then filter to a status nothing matches.
    await page.getByRole("tab", { name: "Generate" }).click();
    await generateViaReview(page);
    await expect(page.getByText(/3 invoices created/)).toBeVisible();
    await page.getByRole("tab", { name: "Invoice list" }).click();
    await expect(page.getByText("Adaeze Okonkwo")).toBeVisible();

    await page.locator("#invoice-status").selectOption("PAID");
    // The heading uses typographic quotes (&ldquo;/&rdquo;), so match loosely.
    await expect(page.getByText(/No .Paid. invoices here/)).toBeVisible();
    await expect(page.getByText("No invoices yet")).toBeHidden();
    // And a way back out of the filter.
    await page.getByRole("button", { name: "Show all statuses" }).click();
    await expect(page.getByText("Adaeze Okonkwo")).toBeVisible();
  await admin.context.close();
    await admin.api.dispose();
  });

  test("a failed invoice fetch shows an error with retry — NEVER 'no invoices'", async ({
    browser,
  }) => {
    const { admin, page, armName } = await scaffold(browser);
    await page.goto("/finance/invoices");
    await selectContext(page, armName);

    // Fail the list request the way a flaky Nigerian connection would.
    await page.route("**/api/v1/invoices?*", (route) => route.abort("failed"));
    await page.getByRole("tab", { name: "Invoice list" }).click();

    await expect(page.getByText("Could not load invoices")).toBeVisible();
    await expect(page.getByText(/internet connection/)).toBeVisible();
    // The heart of F-05: an error is not an emptiness claim.
    await expect(page.getByText("No invoices yet")).toBeHidden();
    // F-12: no raw error text.
    const bodyText = (await page.locator("body").textContent()) ?? "";
    expect(bodyText).not.toContain("TypeError");
    expect(bodyText).not.toContain("ApiError");
    expect(bodyText).not.toContain("Failed to fetch");

    // Retry recovers once the network is healthy again.
    await page.unroute("**/api/v1/invoices?*");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("Could not load invoices")).toBeHidden();
    await expect(page.getByText("No invoices yet")).toBeVisible();

    await admin.context.close();
    await admin.api.dispose();
  });
});

test.describe("finance — invoice cancellation (F-01)", () => {
  async function generatedList(browser: Parameters<typeof loginAsAdmin>[0]) {
    const s = await scaffold(browser);
    await s.page.goto("/finance/invoices");
    await selectContext(s.page, s.armName);
    await generateViaReview(s.page);
    await expect(s.page.getByText(/3 invoices created/)).toBeVisible();
    await s.page.getByRole("tab", { name: "Invoice list" }).click();
    await expect(s.page.getByText("Adaeze Okonkwo")).toBeVisible();
    return s;
  }

  test("a single click opens a confirmation and does NOT cancel anything", async ({ browser }) => {
    const { admin, page, termId, classArmId } = await generatedList(browser);

    const row = page.getByRole("row").filter({ hasText: "Adaeze Okonkwo" });
    await row.getByRole("button", { name: "Cancel invoice…" }).click();

    // A dialog appeared, naming who and how much.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Cancel this invoice?")).toBeVisible();
    await expect(dialog.getByText(/Adaeze Okonkwo/)).toBeVisible();
    await expect(dialog.getByText(/₦45,000\.00/)).toBeVisible();
    await expect(dialog.getByText(/cannot be undone/)).toBeVisible();

    // The two buttons cannot be confused for one another.
    await expect(dialog.getByRole("button", { name: "Keep invoice" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel this invoice" })).toBeVisible();

    // NOTHING has been cancelled by the click that opened the dialog.
    const before = await apiListInvoices(admin.api, { termId, classArmId });
    expect(before.data.filter((i) => i.status === "CANCELLED")).toHaveLength(0);

    await admin.context.close();
    await admin.api.dispose();
  });

  test("dismissing leaves the invoice untouched, in the UI and in the database", async ({
    browser,
  }) => {
    const { admin, page, termId, classArmId } = await generatedList(browser);

    const row = page.getByRole("row").filter({ hasText: "Adaeze Okonkwo" });
    await row.getByRole("button", { name: "Cancel invoice…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Keep invoice" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    await expect(row.getByText("Issued")).toBeVisible();
    const after = await apiListInvoices(admin.api, { termId, classArmId });
    expect(after.data.filter((i) => i.status === "CANCELLED")).toHaveLength(0);

    await admin.context.close();
    await admin.api.dispose();
  });

  test("confirming sends exactly ONE request, shows success, and persists", async ({ browser }) => {
    const { admin, page, termId, classArmId } = await generatedList(browser);

    let cancelRequests = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/invoices\/[^/]+\/cancel$/.test(req.url())) {
        cancelRequests += 1;
      }
    });

    // Hold the cancel response open so the in-flight window is observable
    // rather than a race — otherwise a fast local API can complete between
    // the two clicks and the guard would never actually be exercised.
    await page.route("**/api/v1/invoices/*/cancel", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });

    const row = page.getByRole("row").filter({ hasText: "Adaeze Okonkwo" });
    await row.getByRole("button", { name: "Cancel invoice…" }).click();
    const confirm = page.getByRole("dialog").getByRole("button", { name: /Cancel this invoice|Cancelling/ });
    await confirm.click();

    // While the request is in flight the button is disabled, so a second
    // click cannot produce a second POST.
    await expect(confirm).toBeDisabled();
    await confirm.click({ force: true, timeout: 5000 }).catch(() => undefined);

    // Success is visibly confirmed.
    await expect(page.getByText(/cancelled for Adaeze Okonkwo/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(row.getByText("Cancelled")).toBeVisible();
    // The action is no longer offered for a cancelled invoice.
    await expect(row.getByRole("button", { name: "Cancel invoice…" })).toBeHidden();

    expect(cancelRequests, "exactly one cancel POST").toBe(1);

    // Persisted — read back from the API, not from the DOM.
    const after = await apiListInvoices(admin.api, { termId, classArmId });
    const cancelled = after.data.filter((i) => i.status === "CANCELLED");
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]!.studentName).toBe("Adaeze Okonkwo");

    await admin.context.close();
    await admin.api.dispose();
  });

  test("a failed cancellation is explained, and the invoice state stays truthful", async ({
    browser,
  }) => {
    const { admin, page, termId, classArmId } = await generatedList(browser);

    await page.route("**/api/v1/invoices/*/cancel", (route) => route.abort("failed"));

    const row = page.getByRole("row").filter({ hasText: "Adaeze Okonkwo" });
    await row.getByRole("button", { name: "Cancel invoice…" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Cancel this invoice" }).click();

    // The failure is visible, in human words, and says what did NOT happen.
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByText(/internet connection/)).toBeVisible();
    await expect(dialog.getByText(/has not been cancelled/)).toBeVisible();
    // F-12: never a raw error object.
    const dialogText = (await dialog.textContent()) ?? "";
    expect(dialogText).not.toContain("TypeError");
    expect(dialogText).not.toContain("ApiError");

    // The displayed status is still the truth from the server.
    await dialog.getByRole("button", { name: "Keep invoice" }).click();
    await expect(row.getByText("Issued")).toBeVisible();
    const after = await apiListInvoices(admin.api, { termId, classArmId });
    expect(after.data.filter((i) => i.status === "CANCELLED")).toHaveLength(0);

    // And a retry after the network recovers still works.
    await page.unroute("**/api/v1/invoices/*/cancel");
    await row.getByRole("button", { name: "Cancel invoice…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel this invoice" }).click();
    await expect(row.getByText("Cancelled")).toBeVisible();

    await admin.context.close();
    await admin.api.dispose();
  });
});

test.describe("finance — invoice navigation (F-32)", () => {
  test("opening an invoice is a client navigation, not a full document reload", async ({
    browser,
  }) => {
    const { admin, page, armName } = await scaffold(browser);
    await page.goto("/finance/invoices");
    await selectContext(page, armName);
    await generateViaReview(page);
    await expect(page.getByText(/3 invoices created/)).toBeVisible();
    await page.getByRole("tab", { name: "Invoice list" }).click();
    await expect(page.getByText("Adaeze Okonkwo")).toBeVisible();

    // Stamp the live document. A hard navigation destroys it; a client-side
    // one preserves it.
    await page.evaluate(() => {
      (window as unknown as { __skClientNav?: boolean }).__skClientNav = true;
    });

    await page.getByRole("row").filter({ hasText: "Adaeze Okonkwo" })
      .getByRole("link", { name: "View" }).click();

    // Next dev compiles the detail route on first request — generous budget.
    await page.waitForURL(/\/finance\/invoices\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect(page.getByText("Adaeze Okonkwo").first()).toBeVisible({ timeout: 60_000 });
    const survived = await page.evaluate(
      () => (window as unknown as { __skClientNav?: boolean }).__skClientNav === true,
    );
    expect(survived, "document was NOT reloaded — client navigation").toBe(true);

    await admin.context.close();
    await admin.api.dispose();
  });
});
