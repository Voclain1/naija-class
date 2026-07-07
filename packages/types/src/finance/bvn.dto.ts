import { z } from "zod";

// Phase 3 / Slice 12 — BVN (Bank Verification Number) is staff/payroll PII,
// not student/guardian data. Lives on User (packages/db schema), not
// TeacherProfile — PayrollItem.userId is staff-generic, and non-teaching
// staff (admin, bursar, owner) can be salaried without ever holding a
// TeacherProfile row.

// CBN (Central Bank of Nigeria) BVN format: exactly 11 digits.
export const bvnSchema = z.string().regex(/^\d{11}$/, "BVN must be exactly 11 digits");

export const captureBvnSchema = z.object({
  bvn: bvnSchema,
});
export type CaptureBvnInput = z.infer<typeof captureBvnSchema>;

// Masked status — safe for a staff detail view. Never appears in a list
// endpoint (CLAUDE.md: BVN "never returned in list responses").
export interface BvnStatusDto {
  hasBvn: boolean;
  bvnLast4: string | null;
}

// Full plaintext — only ever returned by the /reveal routes, self or
// owner/admin-gated, and audited on every call.
export interface BvnRevealDto {
  bvn: string;
}
