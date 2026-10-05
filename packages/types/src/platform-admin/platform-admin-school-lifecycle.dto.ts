import { z } from "zod";

// Platform-admin tools, slice 2 — school lifecycle (docs/modules/platform-admin.md).
//
// Owner's decisions, 2026-10-05:
//   * Suspend blocks every sign-in (staff, parents, students) and ends live
//     sessions at their next request. Data is kept; payment links still work.
//   * Delete only a school that has never recorded a payment, and only after
//     the operator types the school's slug.

// POST /platform-admin/schools/:schoolId/suspend
export const platformAdminSuspendSchoolSchema = z.object({
  // Why — kept in the audit row, never shown to the school.
  reason: z.string().trim().min(3).max(500),
});
export type PlatformAdminSuspendSchoolInput = z.infer<typeof platformAdminSuspendSchoolSchema>;

// POST .../suspend and POST .../reactivate both answer with the new state.
export interface PlatformAdminSchoolSuspensionResponse {
  schoolId: string;
  suspendedAt: string | null;
}

// Why a school cannot be deleted (or suspended, for the first one).
export const SCHOOL_DELETION_BLOCKERS = ["HAS_PAYMENTS", "HAS_PLATFORM_ADMIN"] as const;
export type SchoolDeletionBlocker = (typeof SCHOOL_DELETION_BLOCKERS)[number];

// GET /platform-admin/schools/:schoolId/deletion-check — what a delete would
// remove, and whether it is allowed. Counts only.
export interface PlatformAdminSchoolDeletionCheckDto {
  schoolId: string;
  slug: string;
  deletable: boolean;
  blockers: SchoolDeletionBlocker[];
  paymentCount: number;
  studentCount: number;
  staffCount: number;
  guardianCount: number;
}

// POST /platform-admin/schools/:schoolId/delete — POST rather than DELETE
// because it carries a body, and the web proxy's DELETE does not forward one.
export const platformAdminDeleteSchoolSchema = z.object({
  // Must equal the school's slug exactly — the operator types it.
  confirmSlug: z.string().trim().min(1).max(100),
});
export type PlatformAdminDeleteSchoolInput = z.infer<typeof platformAdminDeleteSchoolSchema>;

export interface PlatformAdminDeleteSchoolResponse {
  schoolId: string;
  slug: string;
  deletedRowCount: number;
}
