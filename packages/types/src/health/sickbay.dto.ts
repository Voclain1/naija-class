import { z } from "zod";

// Phase 9 / CP3.3 — the sickbay log (docs/modules/phase-9.md §10 CP3-D5,
// CP3-D6).
//
// Who reads what:
//   - owner, admin and the Health officer (sickbay.manage): every visit;
//   - the child's guardians: the time, "visited the sickbay", and whether the
//     child was sent home. The complaint, action and medicine only when the
//     visit was shared with the parent. Withdrawn visits are not listed;
//   - teachers and the student's own portal: nothing.
// No AI anywhere near it.

export const SICKBAY_LIMITS = {
  complaint: 500,
  actionTaken: 500,
  medicationName: 120,
  dose: 60,
  medicationsPerVisit: 10,
} as const;

/** Schools run on Lagos time. Nigeria keeps no daylight saving, so this is fixed. */
export const SICKBAY_TIME_ZONE = "Africa/Lagos";

const moment = z.string().datetime({ offset: true, message: "Enter a real time." });

export const sickbayMedicationInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name the medicine.").max(SICKBAY_LIMITS.medicationName),
    dose: z.string().trim().min(1, "Enter the dose.").max(SICKBAY_LIMITS.dose),
    givenAt: moment,
  })
  .strict();
export type SickbayMedicationInput = z.infer<typeof sickbayMedicationInputSchema>;

export const createSickbayVisitSchema = z
  .object({
    studentId: z.string().uuid(),
    visitedAt: moment,
    complaint: z.string().trim().min(1, "Say what the child came in with.").max(SICKBAY_LIMITS.complaint),
    actionTaken: z
      .string()
      .trim()
      .max(SICKBAY_LIMITS.actionTaken)
      .optional()
      .transform((v) => (v ? v : undefined)),
    sentHome: z.boolean().default(false),
    shareWithParent: z.boolean().default(false),
    medications: z.array(sickbayMedicationInputSchema).max(SICKBAY_LIMITS.medicationsPerVisit).default([]),
  })
  .strict();
export type CreateSickbayVisitInput = z.input<typeof createSickbayVisitSchema>;

export const addSickbayMedicationSchema = sickbayMedicationInputSchema;
export type AddSickbayMedicationInput = SickbayMedicationInput;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-15.");

/** One day's visits (a Lagos calendar day), or one child's. Neither means today. */
export const sickbayVisitListQuerySchema = z
  .object({
    date: isoDate.optional(),
    studentId: z.string().uuid().optional(),
  })
  .strict();
export type SickbayVisitListQuery = z.infer<typeof sickbayVisitListQuerySchema>;

export interface SickbayMedicationDto {
  id: string;
  name: string;
  dose: string;
  givenAt: string | Date;
  givenByName: string | null;
}

/** Staff view of one visit. */
export interface SickbayVisitDto {
  id: string;
  studentId: string;
  studentName: string;
  className: string | null;
  visitedAt: string | Date;
  complaint: string;
  actionTaken: string | null;
  sentHome: boolean;
  shareWithParent: boolean;
  recordedByName: string | null;
  medications: SickbayMedicationDto[];
  /** How each linked guardian was told: push, SMS, or neither. */
  notices: { push: number; sms: number; none: number };
  withdrawnAt: string | Date | null;
}

export interface SickbayVisitListResponse {
  data: SickbayVisitDto[];
}

/** The parent's view. `details` is null unless the visit was shared with them. */
export interface PortalSickbayVisitDto {
  id: string;
  visitedAt: string | Date;
  sentHome: boolean;
  details: {
    complaint: string;
    actionTaken: string | null;
    medications: { name: string; dose: string; givenAt: string | Date }[];
  } | null;
}

export interface PortalSickbayVisitListResponse {
  data: PortalSickbayVisitDto[];
}

/** "10:40", in the school's time. */
export function formatSickbayTime(at: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: SICKBAY_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(at));
}

/** "15 Oct 2026", in the school's time. */
export function formatSickbayDay(at: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: SICKBAY_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(at));
}

/** The Lagos calendar day a moment falls on, as YYYY-MM-DD. */
export function sickbayDayOf(at: string | Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SICKBAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(at));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** A Lagos day and wall-clock time ("2026-10-15", "10:40") as a moment. Lagos is UTC+1. */
export function sickbayMomentFrom(day: string, time: string): string {
  return new Date(`${day}T${time}:00+01:00`).toISOString();
}
