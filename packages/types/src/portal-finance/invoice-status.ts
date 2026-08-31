import type { InvoiceStatus } from "../finance/invoice.dto.js";
import type { PaymentStatus } from "../finance/payment.dto.js";
import type { PayrollStatus } from "../finance/payroll.dto.js";
import type { PaystackSetupStatus } from "../paystack-setup/paystack-setup-request.dto.js";

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

/** Human-facing payment statuses. API values remain machine identifiers. */
export const paymentStatusLabel: Record<PaymentStatus, string> = {
  PENDING: "Pending",
  SUCCESS: "Successful",
  FAILED: "Failed",
  REVERSED: "Reversed",
};

/** Human-facing payroll statuses for staff-payment operators. */
export const payrollStatusLabel: Record<PayrollStatus, string> = {
  DRAFT: "Draft",
  APPROVED: "Approved",
  PROCESSING: "Processing",
  PAID: "Paid",
  FAILED: "Failed",
};

/** Human-facing labels for an assisted Paystack setup request. */
export const paystackSetupStatusLabel: Record<PaystackSetupStatus, string> = {
  PENDING: "Pending",
  FULFILLED: "Completed",
  REJECTED: "Rejected",
};
