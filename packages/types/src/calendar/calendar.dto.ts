import { z } from "zod";

// Phase 8 / CP1 — Event Calendar. Plan-first: docs/modules/phase-8.md §15.
//
// Every calendar date is a YYYY-MM-DD string on the wire and @db.Date in the
// database — no time of day, no timezone (D29). `z.string().date()` rejects
// impossible dates such as 2026-02-30, which a bare regex would accept.

export const SCHOOL_EVENT_CATEGORIES = [
  "HOLIDAY",
  "BREAK",
  "EXAM_PERIOD",
  "MEETING",
  "EVENT",
  "RESUMPTION",
  "OTHER",
] as const;
export type SchoolEventCategory = (typeof SCHOOL_EVENT_CATEGORIES)[number];

export const NATIONAL_EVENT_KINDS = ["PUBLIC_HOLIDAY", "SPECIAL_HOLIDAY"] as const;
export type NationalEventKind = (typeof NATIONAL_EVENT_KINDS)[number];

// The widest window one calendar read may span (D27). Bounds the query; a year
// view plus a little overlap fits comfortably.
export const CALENDAR_MAX_WINDOW_DAYS = 400;

export const SCHOOL_EVENT_TITLE_MAX = 120;
export const SCHOOL_EVENT_DESCRIPTION_MAX = 1000;

const dateRangeRefine = <T extends { startDate: string; endDate: string }>(v: T) =>
  v.endDate >= v.startDate;
const dateRangeMessage = { message: "End date cannot be before the start date.", path: ["endDate"] };

export const calendarWindowQuerySchema = z
  .object({
    from: z.string().date("from must be a real date (YYYY-MM-DD)."),
    to: z.string().date("to must be a real date (YYYY-MM-DD)."),
  })
  .refine((v) => v.to >= v.from, { message: "to cannot be before from.", path: ["to"] })
  .refine(
    (v) =>
      (Date.parse(`${v.to}T00:00:00Z`) - Date.parse(`${v.from}T00:00:00Z`)) / 86_400_000 <=
      CALENDAR_MAX_WINDOW_DAYS,
    { message: `A calendar window may span at most ${CALENDAR_MAX_WINDOW_DAYS} days.`, path: ["to"] },
  );
export type CalendarWindowQuery = z.infer<typeof calendarWindowQuerySchema>;

export const createSchoolEventSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required.").max(SCHOOL_EVENT_TITLE_MAX),
    description: z.string().trim().max(SCHOOL_EVENT_DESCRIPTION_MAX).nullable().optional(),
    category: z.enum(SCHOOL_EVENT_CATEGORIES),
    startDate: z.string().date("Start date must be a real date."),
    endDate: z.string().date("End date must be a real date."),
  })
  .refine(dateRangeRefine, dateRangeMessage);
export type CreateSchoolEventInput = z.infer<typeof createSchoolEventSchema>;

// PATCH semantics, but the date pair travels together: validating a lone
// endDate against a start date the client did not send would need a DB read
// the schema cannot do, so both-or-neither keeps the range check in one place.
export const updateSchoolEventSchema = z
  .object({
    title: z.string().trim().min(1).max(SCHOOL_EVENT_TITLE_MAX).optional(),
    description: z.string().trim().max(SCHOOL_EVENT_DESCRIPTION_MAX).nullable().optional(),
    category: z.enum(SCHOOL_EVENT_CATEGORIES).optional(),
    startDate: z.string().date().optional(),
    endDate: z.string().date().optional(),
  })
  .refine((v) => (v.startDate === undefined) === (v.endDate === undefined), {
    message: "Send startDate and endDate together.",
    path: ["endDate"],
  })
  .refine((v) => v.startDate === undefined || v.endDate === undefined || v.endDate >= v.startDate, dateRangeMessage)
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to update." });
export type UpdateSchoolEventInput = z.infer<typeof updateSchoolEventSchema>;

/** A school event as the management screen sees it. */
export interface SchoolEventDto {
  id: string;
  title: string;
  description: string | null;
  category: SchoolEventCategory;
  startDate: string; // YYYY-MM-DD, inclusive
  endDate: string; // YYYY-MM-DD, inclusive
  createdAt: string;
  updatedAt: string;
}

/** A national event as the management screen sees it — with this school's hide state. */
export interface ManagedNationalEventDto {
  id: string;
  name: string;
  kind: NationalEventKind;
  startDate: string;
  endDate: string;
  dateConfirmed: boolean;
  hidden: boolean;
}

export type CalendarEntrySource = "SCHOOL" | "NATIONAL" | "TERM";
export type CalendarEntryCategory = SchoolEventCategory | NationalEventKind | "TERM_START" | "TERM_END";

/**
 * One row of the merged calendar every principal reads (D27). Built in ONE
 * place — CalendarService.buildCalendar — for staff, guardians and students.
 */
export interface CalendarEntryDto {
  /** Prefixed by source ("school:", "national:", "term-start:", "term-end:") so ids never collide. */
  id: string;
  source: CalendarEntrySource;
  title: string;
  category: CalendarEntryCategory;
  startDate: string; // YYYY-MM-DD, inclusive
  endDate: string; // YYYY-MM-DD, inclusive
  /** Always true except for a national event awaiting official confirmation ("expected"). */
  dateConfirmed: boolean;
  description: string | null;
}

export interface CalendarResponse {
  from: string;
  to: string;
  entries: CalendarEntryDto[];
}
