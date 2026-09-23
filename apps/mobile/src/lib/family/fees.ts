import type { PortalInvoiceDto, SchoolBankDetails } from "@school-kit/types";

// A parent's fees, on the phone (docs/modules/phone-for-every-role.md D3).
//
// Pure, and mirroring apps/portal's own rules rather than inventing new ones,
// so a parent sees the same thing in the app and in the browser:
//
//  - WHETHER money can be paid is the API's STATUS, never arithmetic here.
//  - The balance shown is the difference between two figures the server sent
//    for display only. The app computes no fee, no discount and no total —
//    that is the money rule, and it is why "Pay" always charges what the
//    SERVER decides (PortalPaymentsService charges the exact outstanding
//    balance; the app never sends an amount).
// Checkout itself already exists and is not touched here: src/lib/payments/
// checkout.ts opens the hosted page and poll.ts asks the SERVER what happened,
// because the browser closing proves nothing.

/** Invoice states a parent can still pay against — the portal's own set. */
export const PAYABLE_STATUSES: ReadonlySet<PortalInvoiceDto["status"]> = new Set([
  "ISSUED",
  "PARTIALLY_PAID",
  "OVERDUE",
]);

export function canPay(invoice: Pick<PortalInvoiceDto, "status" | "totalDue" | "totalPaid">): boolean {
  return PAYABLE_STATUSES.has(invoice.status) && invoiceBalance(invoice) > 0;
}

/** Display only: what the server said is due, less what it said is paid. */
export function invoiceBalance(invoice: Pick<PortalInvoiceDto, "totalDue" | "totalPaid">): number {
  return Math.max(invoice.totalDue - invoice.totalPaid, 0);
}

/** What a child still owes across their invoices — for the "needs you" line. */
export function totalOwed(invoices: readonly PortalInvoiceDto[]): number {
  return invoices.filter(canPay).reduce((sum, invoice) => sum + invoiceBalance(invoice), 0);
}

export function describeInvoiceStatus(status: PortalInvoiceDto["status"]): string {
  switch (status) {
    case "DRAFT":
      return "Not issued yet";
    case "ISSUED":
      return "Due";
    case "PARTIALLY_PAID":
      return "Part paid";
    case "PAID":
      return "Paid";
    case "OVERDUE":
      return "Overdue";
    case "CANCELLED":
      return "Cancelled";
    case "REFUNDED":
      return "Refunded";
    default:
      return status;
  }
}

/** Bank transfer details are shown only when the school turned them on AND filled them in. */
export function transferDetails(details: SchoolBankDetails | null | undefined): SchoolBankDetails | null {
  if (!details) return null;
  const complete = [details.bankName, details.bankAccountName, details.bankAccountNumber].every(
    (field) => typeof field === "string" && field.trim() !== "",
  );
  return complete ? details : null;
}

/** What a parent copies and pastes into their bank app. */
export function transferClipboardText(details: SchoolBankDetails, reference: string): string {
  return `${details.bankAccountNumber} · ${details.bankName} · ${details.bankAccountName} · Reference: ${reference}`;
}
