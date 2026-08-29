import type { InvoiceStatus } from "../finance/invoice.dto.js";

/**
 * Human-facing invoice status labels shared by family-facing clients.
 *
 * API values are deliberately stable machine identifiers. Keeping their
 * presentation here prevents one surface from exposing `PARTIALLY_PAID`
 * while another says "Partially paid".
 */
export const invoiceStatusLabel: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};
