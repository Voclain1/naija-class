import type { PortalInvoiceDto, SchoolBankDetails } from "@school-kit/types";
import { describe, expect, it } from "vitest";

import {
  PAYABLE_STATUSES,
  canPay,
  describeInvoiceStatus,
  invoiceBalance,
  totalOwed,
  transferClipboardText,
  transferDetails,
} from "./fees";

// A parent's fees (docs/modules/phone-for-every-role.md D3). Paying itself
// already existed (src/lib/payments/checkout.ts); these are the rules behind
// what the app shows about a bill.

const INVOICE = {
  id: "inv-1",
  status: "PARTIALLY_PAID",
  totalDue: 150_000_00,
  totalPaid: 100_000_00,
} as unknown as PortalInvoiceDto;

const BANK: SchoolBankDetails = {
  bankName: "Zenith Bank",
  bankAccountName: "Virgo Fidelis Montessori School",
  bankAccountNumber: "1234567890",
};

describe("whether a parent can pay", () => {
  it("follows the API's status, the same set the web portal uses", () => {
    expect([...PAYABLE_STATUSES].sort()).toEqual(["ISSUED", "OVERDUE", "PARTIALLY_PAID"]);
    expect(canPay(INVOICE)).toBe(true);
  });

  it("refuses a settled, cancelled or refunded bill even if the figures look owed", () => {
    expect(canPay({ ...INVOICE, status: "PAID", totalPaid: 150_000_00 })).toBe(false);
    expect(canPay({ ...INVOICE, status: "CANCELLED" })).toBe(false);
    expect(canPay({ ...INVOICE, status: "REFUNDED" })).toBe(false);
    expect(canPay({ ...INVOICE, status: "DRAFT" })).toBe(false);
  });

  it("refuses a payable status with nothing left on it", () => {
    expect(canPay({ ...INVOICE, totalPaid: 150_000_00 })).toBe(false);
  });
});

describe("what a parent is shown", () => {
  it("shows the server's figures, and never a negative balance", () => {
    expect(invoiceBalance(INVOICE)).toBe(50_000_00);
    expect(invoiceBalance({ ...INVOICE, totalPaid: 200_000_00 })).toBe(0);
  });

  it("adds up only what is still owed, across bills", () => {
    const settled = { ...INVOICE, id: "inv-2", status: "PAID", totalPaid: 150_000_00 } as PortalInvoiceDto;
    expect(totalOwed([INVOICE, settled])).toBe(50_000_00);
    expect(totalOwed([])).toBe(0);
  });

  it("says each status in words a parent reads, not the API's", () => {
    expect(describeInvoiceStatus("PARTIALLY_PAID")).toBe("Part paid");
    expect(describeInvoiceStatus("OVERDUE")).toBe("Overdue");
    expect(describeInvoiceStatus("DRAFT")).toBe("Not issued yet");
  });
});

describe("bank transfer details", () => {
  it("are shown only when the school actually filled them in", () => {
    expect(transferDetails(BANK)).toEqual(BANK);
    expect(transferDetails(null)).toBeNull();
    expect(transferDetails({ ...BANK, bankAccountNumber: "" })).toBeNull();
    expect(transferDetails({ ...BANK, bankName: "   " })).toBeNull();
  });

  it("copy the account with the child's admission number as the reference", () => {
    expect(transferClipboardText(BANK, "2026/JSS3/050")).toBe(
      "1234567890 · Zenith Bank · Virgo Fidelis Montessori School · Reference: 2026/JSS3/050",
    );
  });
});
