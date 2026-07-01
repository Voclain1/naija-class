import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const paymentMethodValues = ["PAYSTACK", "CASH", "POS", "BANK_TRANSFER"] as const;
export type PaymentMethod = (typeof paymentMethodValues)[number];

// CASH / POS / BANK_TRANSFER are the methods available in slice 7 (manual).
// PAYSTACK is slice 8 (online rail).
export const manualPaymentMethodValues = ["CASH", "POS", "BANK_TRANSFER"] as const;
export type ManualPaymentMethod = (typeof manualPaymentMethodValues)[number];

export const paymentStatusValues = ["PENDING", "SUCCESS", "FAILED", "REVERSED"] as const;
export type PaymentStatus = (typeof paymentStatusValues)[number];

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export interface PaymentDto {
  id: string;
  schoolId: string;
  invoiceId: string;
  studentId: string;
  amount: number; // kobo
  method: PaymentMethod;
  status: PaymentStatus;
  paystackReference: string | null;
  reference: string | null; // bank transfer ref, POS txn ID, cheque no.
  receiptNumber: string | null; // "RCP-<paymentId-first-8-upper>"
  receiptUrl: string | null; // R2 canonical path; signed on demand
  recordedBy: string | null; // userId; null for Paystack webhook (slice 8)
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedPaymentsDto {
  data: PaymentDto[];
  total: number;
  page: number;
  limit: number;
}

export interface PaymentReceiptUrlDto {
  url: string;
  expiresAt: Date;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

export const recordManualPaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  // Amount in kobo. The web UI converts from naira (× 100) before submitting.
  amount: z.number().int().positive(),
  method: z.enum(["CASH", "POS", "BANK_TRANSFER"]),
  // ISO 8601 datetime. Any valid date accepted — no backdate limit (D4).
  // Audit log records both paidAt and createdAt so the gap is always visible.
  paidAt: z.string().datetime(),
  reference: z.string().max(200).optional(),
});
export type RecordManualPaymentInput = z.infer<typeof recordManualPaymentSchema>;

export const listPaymentsSchema = z.object({
  invoiceId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type ListPaymentsInput = z.infer<typeof listPaymentsSchema>;
