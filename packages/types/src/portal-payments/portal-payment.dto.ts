// Phase 4 / Slice 5 — guardian-facing payment shape, returned by
// GET /portal/payments/:reference (the post-checkout status poll).
//
// Deliberately narrower than the admin-facing PaymentDto (finance/
// payment.dto.ts): drops schoolId (redundant, same reasoning as
// PortalInvoiceDto), recordedBy (always null for a guardian-initiated
// payment — see PortalPaymentsService's own comment on why; a staff-only
// concept regardless), paystackReference (redundant — the caller already
// has the reference, it's the lookup key), reference (bank-transfer/POS
// reference, always null for a PAYSTACK-method row), and receiptNumber/
// receiptUrl (a guardian-facing receipt view is explicitly deferred — see
// docs/deferred.md).

import type { PaymentMethod, PaymentStatus } from "../finance/payment.dto.js";

export interface PortalPaymentDto {
  id: string;
  invoiceId: string;
  studentId: string;
  amount: number; // kobo
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
