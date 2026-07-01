import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const invoiceStatusValues = [
  "DRAFT",
  "ISSUED",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "CANCELLED",
  "REFUNDED",
] as const;
export type InvoiceStatus = (typeof invoiceStatusValues)[number];

// ---------------------------------------------------------------------------
// Snapshot types — frozen at issue time, never mutated by service layer
// ---------------------------------------------------------------------------

export interface DiscountSnapshotDto {
  ruleId: string;
  ruleName: string;
  discountAmount: number; // kobo — individual rule's contribution before stacking cap
}

export interface InvoiceLineItemDto {
  feeItemId: string;
  categoryName: string;
  feeName: string;
  amount: number; // kobo — original fee item amount (frozen)
  discountsApplied: DiscountSnapshotDto[];
  netAmount: number; // kobo — amount minus capped stacked discount, always >= 0
}

// ---------------------------------------------------------------------------
// Response DTO
// ---------------------------------------------------------------------------

export interface InvoiceDto {
  id: string;
  schoolId: string;
  studentId: string;
  termId: string;
  academicYearId: string;
  status: InvoiceStatus;
  items: InvoiceLineItemDto[];
  totalAmount: number;   // kobo
  totalDiscount: number; // kobo
  totalDue: number;      // kobo
  totalPaid: number;     // kobo — updated by slice 7 payment service
  dueDate: string | null; // ISO date string (DATE col, no time)
  issuedAt: Date | null;
  issuedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const generateInvoicesSchema = z.object({
  termId: z.string().uuid(),
  classArmId: z.string().uuid(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD").optional(),
});
export type GenerateInvoicesInput = z.infer<typeof generateInvoicesSchema>;

export const previewInvoicesSchema = z.object({
  termId: z.string().uuid(),
  classArmId: z.string().uuid(),
});
export type PreviewInvoicesInput = z.infer<typeof previewInvoicesSchema>;

export const listInvoicesSchema = z.object({
  termId: z.string().uuid().optional(),
  classArmId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  status: z.enum(invoiceStatusValues).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type ListInvoicesInput = z.infer<typeof listInvoicesSchema>;

// ---------------------------------------------------------------------------
// Response shapes for generate / preview
// ---------------------------------------------------------------------------

export interface PreviewLineDto {
  studentId: string;
  feeItemCount: number;
  totalAmount: number;   // kobo
  totalDiscount: number; // kobo
  totalDue: number;      // kobo
}

export interface GenerateInvoicesResponseDto {
  created: number;
  skipped: number;
  invoices: InvoiceDto[];
}

export interface PaginatedInvoicesDto {
  data: InvoiceDto[];
  total: number;
  page: number;
  limit: number;
}
