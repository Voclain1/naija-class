import { z } from "zod";
import type { PreviewLineDto } from "./invoice.dto.js";

const dueDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Choose a valid due date.");

export const billingRunInputSchema = z.object({
  termId: z.string().uuid(),
  classArmIds: z.array(z.string().uuid()).min(1).max(20),
  dueDate: dueDate.optional(),
}).strict();
export type BillingRunInput = z.infer<typeof billingRunInputSchema>;
export const billingRequestSchema = z.object({
  termId: z.string().uuid(),
  request: z.string().trim().min(1).max(500),
  dueDate: dueDate.optional(),
}).strict();
export type BillingRequestInput = z.infer<typeof billingRequestSchema>;
export const approveBillingRunSchema = z.object({
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export interface BillingContextDto {
  terms: { id: string; name: string; year: string; academicYearId: string; isCurrent: boolean }[];
  arms: { id: string; name: string; level: string }[];
}
export interface BillingRunArmDto {
  classArmId: string;
  label: string;
  rows: PreviewLineDto[];
  createCount: number;
  skipCount: number;
  totalDueKobo: string;
  missingFees: boolean;
}
export interface BillingRunDto {
  id: string;
  status: "PENDING" | "COMPLETED";
  termId: string;
  termLabel: string;
  academicYearId: string;
  dueDate: string | null;
  previewHash: string;
  expiresAt: string;
  createdAt: string;
  approvedAt: string | null;
  arms: BillingRunArmDto[];
  createCount: number;
  skipCount: number;
  totalDueKobo: string;
  blockers: string[];
  result: { created: number; skipped: number; totalDueKobo: string; invoiceIds: string[] } | null;
}
