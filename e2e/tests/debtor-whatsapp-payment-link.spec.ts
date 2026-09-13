import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";

// Debtors page → per-row WhatsApp share, with the invoice's Paystack link.
// Plan-first: docs/modules/school-bank-details.md, D5b.
//
// Real API, real Postgres. The only things NOT real are Paystack (a LIVE
// payment_links row is seeded directly — creating one live would call
// Paystack) and wa.me (stubbed, so the popup's URL can be read without
// leaving the test network).

const BALANCE = 150_000_00; // kobo
const LINK_A = "https://paystack.com/pay/PRQ_e2e_match";
const LINK_B = "https://paystack.com/pay/PRQ_e2e_stale";

async function createStudent(admin: { api: import("@playwright/test").APIRequestContext }, suffix: string, firstName: string) {
  const res = await admin.api.post("students", {
    data: {
      admissionNumber: `SKA/WA/${suffix}`,
      firstName,
      lastName: "Okafor",
      dateOfBirth: "2013-04-02T00:00:00.000Z",
      gender: "FEMALE",
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { id: string }).id;
}

/** Click a row's WhatsApp button and return the decoded message the popup was sent. */
async function shareAndReadMessage(context: BrowserContext, page: Page, studentName: string): Promise<string> {
  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", { name: `Share ${studentName}'s balance on WhatsApp` }).click();
  const popup = await popupPromise;
  await popup.waitForURL(/^https:\/\/wa\.me\//, { timeout: 15_000 });
  const text = new URL(popup.url()).searchParams.get("text") ?? "";
  await popup.close();
  return text;
}

test("WhatsApp reminder includes the Paystack link only when it is LIVE for exactly this balance", async ({
  browser,
}) => {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const structure = await setupAcademicStructure(admin.api, { subjectCode: `wa-${suffix}` });

  const studentA = await createStudent(admin, `${suffix}-a`, "Amara");
  const studentB = await createStudent(admin, `${suffix}-b`, "Bisi");
  const studentC = await createStudent(admin, `${suffix}-c`, "Chika");

  let invoiceA = "";
  await withTenant(admin.schoolId, async (db) => {
    // Paystack "connected" — otherwise GET /payment-link answers CONNECT_PAYSTACK
    // before it ever looks at a link row.
    await db.school.update({
      where: { id: admin.schoolId },
      data: {
        paystackPaymentsEnabled: true,
        paystackSubaccountCode: `ACCT_e2e_${suffix}`,
        paystackSplitCode: `SPL_e2e_${suffix}`,
      },
    });

    const invoice = (studentId: string) =>
      db.invoice.create({
        data: {
          schoolId: admin.schoolId,
          studentId,
          termId: structure.termId,
          academicYearId: structure.academicYearId,
          status: "ISSUED",
          items: [],
          totalAmount: BALANCE,
          totalDiscount: 0,
          totalDue: BALANCE,
          totalPaid: 0,
          issuedAt: new Date(),
        },
        select: { id: true },
      });
    const [a, b] = [await invoice(studentA), await invoice(studentB)];
    await invoice(studentC); // C: no payment link at all
    invoiceA = a.id;

    const liveLink = (invoiceId: string, amount: number, url: string, code: string) =>
      db.paymentLink.create({
        data: {
          schoolId: admin.schoolId,
          invoiceId,
          amount,
          status: "LIVE",
          hostedUrl: url,
          requestCode: `${code}_${suffix}`,
          createdBy: admin.ownerUserId,
        },
      });
    await liveLink(a.id, BALANCE, LINK_A, "PRQ_A"); // matches the balance
    await liveLink(b.id, 90_000_00, LINK_B, "PRQ_B"); // stale: a different amount
  });

  // wa.me stub — the popup navigates here and we read its ?text=.
  await admin.context.route("https://wa.me/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<p>whatsapp stub</p>" }),
  );
  // Delay ONLY invoice A's link fetch. The popup must still open and still
  // receive the link: that is the proof the window is opened inside the click,
  // before the await, rather than after it (where browsers popup-block it).
  await admin.context.route(`**/invoices/${invoiceA}/payment-link`, async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });

  const page = admin.page;
  try {
    await page.goto("/finance/debtors");
    await expect(page.getByText("Amara Okafor")).toBeVisible();
    await expect(page.getByText("Chika Okafor")).toBeVisible();

    // A — LIVE, matching amount, slow response.
    //
    // WHY THE TIMING ASSERTION, not "the popup opened". Real browsers block
    // window.open once the click's user activation has expired — Safari after
    // an async gap — so opening the window AFTER awaiting the link fetch makes
    // the button silently do nothing for real staff. But Playwright launches
    // Chromium with --disable-popup-blocking, so an automated browser lets a
    // late window.open through and "the popup opened" proves nothing: a
    // mutation that moved window.open after the await passed this spec in both
    // Chromium and WebKit. What CAN be pinned is the property that avoids the
    // block — the window exists before the (delayed) fetch has resolved.
    const popupA = admin.context.waitForEvent("page");
    const buttonA = page.getByRole("button", { name: "Share Amara Okafor's balance on WhatsApp" });
    const clickedAt = Date.now();
    await buttonA.click();
    const popup = await popupA;
    const openedAfterMs = Date.now() - clickedAt;
    // The link fetch is held for 2500 ms; a window opened after it resolves
    // cannot arrive sooner than that.
    expect(openedAfterMs, "window must open inside the click, before the link fetch resolves").toBeLessThan(1500);
    await expect(buttonA).toHaveText(/Preparing/);
    await popup.waitForURL(/^https:\/\/wa\.me\//, { timeout: 15_000 });
    const messageA = new URL(popup.url()).searchParams.get("text") ?? "";
    await popup.close();
    expect(messageA).toContain(`Pay online: ${LINK_A}`);
    expect(messageA).toContain("₦150,000.00");
    await expect(buttonA).toHaveText("WhatsApp");

    // B — LIVE, but for a different amount than the row shows.
    const messageB = await shareAndReadMessage(admin.context, page, "Bisi Okafor");
    expect(messageB).not.toContain("Pay online");
    expect(messageB).not.toContain(LINK_B);
    expect(messageB).toContain("₦150,000.00");

    // C — no link exists. The rest of the message still goes out.
    const messageC = await shareAndReadMessage(admin.context, page, "Chika Okafor");
    expect(messageC).not.toContain("Pay online");
    expect(messageC).toContain("Chika Okafor");
    expect(messageC).toContain("₦150,000.00");

    for (const m of [messageA, messageB, messageC]) {
      expect(m).not.toContain("undefined");
      expect(m).not.toContain("null");
    }
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});
