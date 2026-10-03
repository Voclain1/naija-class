import { z } from "zod";

import type { ReleasedResultDetailDto } from "./released-results.dto.js";

// Phase 8c / CP6b — Result Checker PINs and the public checker
// (docs/modules/phase-8.md §21).

/** A PIN as typed or printed: 12 digits, spaces and dashes ignored (D55). */
export const RESULT_PIN_DIGITS = 12;
const pinInput = z.string().trim().min(1).max(40);

// POST /result-pins/batches — owner/admin. The response carries the only copy
// of the plaintext PINs that will ever exist (D16).
export const generateResultPinBatchSchema = z
  .object({
    termId: z.string().trim().min(1),
    quantity: z.number().int().min(1).max(2000),
    maxUses: z.number().int().min(1).max(20).default(5),
  })
  .strict();
export type GenerateResultPinBatchInput = z.infer<typeof generateResultPinBatchSchema>;

export interface ResultPinBatchDto {
  id: string;
  number: number;
  termId: string;
  termName: string;
  academicYearLabel: string;
  size: number;
  maxUses: number;
  /** PINs bound to a student by a first redemption. */
  redeemedCount: number;
  /** PINs voided one at a time (a voided batch voids all of them). */
  voidedCount: number;
  createdAt: string | Date;
  voidedAt: string | Date | null;
}

export interface GeneratedResultPinDto {
  serial: string;
  /** Formatted "4821 0937 5512". Returned once, never stored (D16). */
  pin: string;
}

export interface GeneratedResultPinBatchDto {
  batch: ResultPinBatchDto;
  pins: GeneratedResultPinDto[];
}

export interface ResultPinBatchListResponse {
  data: ResultPinBatchDto[];
}

// POST /result-pins/void — one lost or stolen card, by its printed serial.
export const voidResultPinSchema = z.object({ serial: z.string().trim().min(1).max(40) }).strict();
export type VoidResultPinInput = z.infer<typeof voidResultPinSchema>;

// POST …/results/:termId/unlock — a family redeeming a PIN inside a portal (D54).
export const resultPinUnlockSchema = z.object({ pin: pinInput }).strict();
export type ResultPinUnlockInput = z.infer<typeof resultPinUnlockSchema>;

// GET /result-checker/:slug — school-level only: nothing about any student.
export interface ResultCheckerSchoolDto {
  schoolName: string;
  terms: { termId: string; termName: string; academicYearLabel: string }[];
}

// POST /result-checker/:slug/check
export const resultCheckerCheckSchema = z
  .object({
    admissionNumber: z.string().trim().min(1).max(60),
    pin: pinInput,
    termId: z.string().trim().min(1),
  })
  .strict();
export type ResultCheckerCheckInput = z.infer<typeof resultCheckerCheckSchema>;

export interface ResultCheckerResultDto {
  result: ReleasedResultDetailDto;
  /** Presigned, 5-minute TTL (D50); null until the PDF is generated. */
  pdfUrl: string | null;
  /** Uses left on this card after this check (D57). */
  usesLeft: number;
}
