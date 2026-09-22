import { describe, expect, it } from "vitest";

import {
  buildBrandedReceiptHtml,
  formatReceiptDate,
  formatSequentialReceiptNumber,
  lagosYear,
  safeBrandColor,
  type ReceiptData,
} from "./receipt.js";

// Branded receipts — the pure renderer (docs/modules/branded-receipts.md D1).
// No database: every fact goes in, the document comes out, and these pin it.

const LOGO = "data:image/png;base64,iVBORw0KGgo=";

const RECEIPT: ReceiptData = {
  receiptNumber: "RCP/2026/000123",
  paidAt: new Date("2026-09-22T09:42:00.000Z"), // 10:42 in Lagos
  school: {
    name: "Greenfield Academy",
    motto: "Knowledge and Character",
    address: "12 Awolowo Road, Ikeja, Lagos",
    phone: "0803 123 4567",
    email: "accounts@greenfield.ng",
    primaryColor: "#1A4D8F",
    logoDataUri: LOGO,
  },
  student: { name: "Adaeze Okafor", admissionNumber: "GFA/2021/041", className: "JSS2 Blue" },
  termLabel: "First Term 2026/2027",
  amount: 50_000_00,
  method: "BANK_TRANSFER",
  reference: "TRF-889213",
  invoice: { totalDue: 150_000_00, totalPaidAfter: 100_000_00 },
  receivedBy: { name: "Ngozi Eze", role: "Bursar" },
};

describe("buildBrandedReceiptHtml — what the receipt shows (D1)", () => {
  const html = buildBrandedReceiptHtml(RECEIPT);

  it("carries the school's branding", () => {
    expect(html).toContain("Greenfield Academy");
    expect(html).toContain("Knowledge and Character");
    expect(html).toContain("12 Awolowo Road, Ikeja, Lagos");
    expect(html).toContain("0803 123 4567 · accounts@greenfield.ng");
    expect(html).toContain(`src="${LOGO}"`);
    expect(html).toContain("--brand: #1A4D8F");
  });

  it("names the receipt, its number and the Lagos date", () => {
    expect(html).toContain("OFFICIAL RECEIPT");
    expect(html).toContain("No. RCP/2026/000123");
    expect(html).toContain("22 September 2026, 10:42");
  });

  it("says who paid, for what, how much — in figures AND words", () => {
    expect(html).toContain("The parent/guardian of <b>Adaeze Okafor</b>");
    expect(html).toContain("Admission no. GFA/2021/041 · JSS2 Blue");
    expect(html).toContain("School fees — First Term 2026/2027");
    expect(html).toContain("₦50,000.00");
    expect(html).toContain("Fifty thousand naira only");
    expect(html).toContain("Bank transfer · Ref. TRF-889213");
  });

  it("shows the invoice position AFTER this payment, from the server's figures", () => {
    expect(html).toContain("Invoice total<b>₦150,000.00</b>");
    expect(html).toContain("Paid to date<b>₦100,000.00</b>");
    expect(html).toContain("Balance<b>₦50,000.00</b>");
  });

  it("names who received it — or says it was paid online", () => {
    expect(html).toContain("Received by: Ngozi Eze");
    expect(html).toContain("(Bursar)");
    const online = buildBrandedReceiptHtml({ ...RECEIPT, method: "PAYSTACK", reference: null, receivedBy: null });
    expect(online).toContain("Received by: Paid online (Paystack)");
    expect(online).toContain("Online (Paystack)");
  });

  it("never shows a negative balance, even on an overpaid invoice", () => {
    const over = buildBrandedReceiptHtml({ ...RECEIPT, invoice: { totalDue: 100, totalPaidAfter: 150 } });
    expect(over).toContain("Balance<b>₦0.00</b>");
  });

  it("does not expose internal ids", () => {
    expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
  });
});

describe("missing branding leaves no blanks", () => {
  it("omits the logo, motto, address and contact line cleanly", () => {
    const html = buildBrandedReceiptHtml({
      ...RECEIPT,
      school: { ...RECEIPT.school, motto: null, address: null, phone: null, email: "  ", logoDataUri: null, primaryColor: null },
      student: { ...RECEIPT.student, className: null },
      termLabel: null,
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain('class="motto"');
    expect(html).not.toContain("School fees —");
    expect(html).not.toContain(" · JSS2");
    expect(html).not.toContain("<p></p>");
    expect(html).not.toMatch(/null|undefined/);
    expect(html).toContain("--brand: #0E5C43");
  });
});

describe("every school- and parent-supplied string is escaped", () => {
  it("renders markup as text, never as markup", () => {
    const hostile = "<script>alert(1)</script>";
    const html = buildBrandedReceiptHtml({
      ...RECEIPT,
      school: { ...RECEIPT.school, name: hostile, motto: `"><img src=x onerror=alert(1)>`, address: hostile, email: hostile },
      student: { name: hostile, admissionNumber: hostile, className: hostile },
      termLabel: hostile,
      reference: hostile,
      receivedBy: { name: hostile, role: hostile },
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("only lets a plain #rrggbb colour into the stylesheet", () => {
    expect(safeBrandColor("#0e5c43")).toBe("#0e5c43");
    expect(safeBrandColor("red; } body { display:none")).toBe("#0E5C43");
    expect(safeBrandColor("#fff")).toBe("#0E5C43");
    expect(safeBrandColor(null)).toBe("#0E5C43");
  });
});

describe("dates and numbers", () => {
  it("dates the receipt in Lagos, not UTC — the 23:30 UTC payment is the next day", () => {
    expect(formatReceiptDate(new Date("2026-09-21T23:30:00.000Z"))).toBe("22 September 2026, 00:30");
  });

  it("counts the year in Lagos too, so New Year's Eve at 23:30 UTC is next year's sequence", () => {
    expect(lagosYear(new Date("2026-12-31T23:30:00.000Z"))).toBe(2027);
    expect(lagosYear(new Date("2026-12-31T22:30:00.000Z"))).toBe(2026);
  });

  it("formats sequential numbers with six digits", () => {
    expect(formatSequentialReceiptNumber(2026, 1)).toBe("RCP/2026/000001");
    expect(formatSequentialReceiptNumber(2026, 123456)).toBe("RCP/2026/123456");
  });
});
