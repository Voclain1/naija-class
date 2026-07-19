// Phase 4 / Slice 4 — guardian-facing invoice shape, returned by
// GET /portal/students/:id/invoices.
//
// Deliberately narrower than the admin-facing InvoiceDto (finance/
// invoice.dto.ts): drops schoolId (redundant — the guardian already knows
// their own school from the session) and issuedBy (a staff User id,
// internal, not useful to a parent). Adds a resolved `term` ref in place
// of a bare termId — a raw UUID answers nothing when a parent asks "which
// term is this," same reasoning CurrentEnrollmentRefDto already applies
// to enrollments.
//
// Reuses InvoiceLineItemDto/DiscountSnapshotDto as-is (finance/
// invoice.dto.ts) — nothing sensitive in either (categoryName, feeName,
// amount, discount rule name/amount): this is the guardian's own child's
// money data, not another family's, so the exclusion discipline here is
// about internal/staff-operational fields, not about the guardian's own
// entitlement to see it.
//
// "Fee structure" (phase-4.md's Slice 4 scope) is deliberately NOT a
// separate DTO/endpoint — each invoice's `items` array already is the fee
// structure as applied to that student for that term. See this slice's
// plan-first §2 for the full reasoning.

import type {
  InvoiceLineItemDto,
  InvoiceStatus,
} from "../finance/invoice.dto.js";

export interface PortalInvoiceTermRefDto {
  id: string;
  name: string;
  sequence: number;
}

export interface PortalInvoiceDto {
  id: string;
  studentId: string;
  term: PortalInvoiceTermRefDto;
  status: InvoiceStatus;
  items: InvoiceLineItemDto[];
  totalAmount: number; // kobo
  totalDiscount: number; // kobo
  totalDue: number; // kobo
  totalPaid: number; // kobo
  dueDate: string | null; // ISO date string (DATE col, no time)
  issuedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// No pagination — same reasoning as PortalStudentListResponse: a student
// has a small, bounded number of invoices (roughly one per term), not a
// roster-scale list.
export interface PortalInvoiceListResponse {
  data: PortalInvoiceDto[];
}
