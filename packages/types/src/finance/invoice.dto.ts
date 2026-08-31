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
  /**
   * Tenant-scoped server resolution of `studentId` — the same contract
   * `issuedByName` established: consumers must never render the raw student
   * id as a human-facing fallback. Null only when the student row has since
   * been hard-deleted; the UI shows "Unknown student" in that case, not a
   * UUID. Batched per page (one findMany, no N+1) in
   * InvoiceGenerationService.resolveStudentIdentities.
   */
  studentName: string | null;
  /**
   * The school's own admission number for `studentId` — free text, unique
   * per school. Secondary identity: what a bursar reads out on the phone
   * when two children share a name. Null under the same condition as
   * `studentName`.
   */
  admissionNumber: string | null;
  termId: string;
  academicYearId: string;
  /** Immutable issuance-time arm snapshot; null only for unresolved legacy rows. */
  classArmId: string | null;
  status: InvoiceStatus;
  items: InvoiceLineItemDto[];
  totalAmount: number;   // kobo
  totalDiscount: number; // kobo
  totalDue: number;      // kobo
  totalPaid: number;     // kobo — updated by slice 7 payment service
  dueDate: string | null; // ISO date string (DATE col, no time)
  issuedAt: Date | null;
  issuedBy: string | null;
  // Tenant-scoped server resolution of `issuedBy`. Consumers must never
  // render the raw user id as a human-facing fallback.
  issuedByName: string | null;
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
  /** See InvoiceDto.studentName — same resolution, same batching. */
  studentName: string | null;
  /** See InvoiceDto.admissionNumber. */
  admissionNumber: string | null;
  feeItemCount: number;
  totalAmount: number;   // kobo
  totalDiscount: number; // kobo
  totalDue: number;      // kobo
  /**
   * True when this student already has an invoice for this term, and will
   * therefore be SKIPPED by `POST /invoices/arm/generate` rather than billed.
   *
   * Added for F-34. Preview used to list every enrolled student with no way
   * to tell which ones generation would actually create, so a review built on
   * it overstated both the count and the naira total — on a re-run of an
   * already-billed arm it would promise "30 students, ₦1,350,000" when the
   * true answer was "0 created, 30 skipped".
   *
   * This is computed by the SERVER from the same `@@unique([schoolId,
   * studentId, termId])` row that generation itself keys on, deliberately
   * rather than being re-derived on the client: the rule has a sharp edge
   * (see below) and there must be exactly one implementation of it.
   *
   * NOTE THE EDGE: the uniqueness row is status-agnostic, so a **CANCELLED**
   * invoice still sets this flag. Cancelling does not free the student to be
   * re-billed by a bulk run — verified at runtime, not assumed.
   */
  alreadyInvoiced: boolean;
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
