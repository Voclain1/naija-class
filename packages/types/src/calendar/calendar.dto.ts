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

// Phase 9 / CP10.1 — ask families to reply (phase-9.md §19.2).
export const RSVP_ANSWERS = ["YES", "NO", "MAYBE"] as const;
export type RsvpAnswer = (typeof RSVP_ANSWERS)[number];
export const RSVP_ANSWER_LABELS: Record<RsvpAnswer, string> = { YES: "Yes", NO: "No", MAYBE: "Maybe" };
export const RSVP_MAX_ATTENDING = 10;

/** Null switches replies off. */
export const eventRsvpSettingsSchema = z
  .object({
    deadline: z.string().date("Reply-by must be a real date.").nullable().default(null),
    askCount: z.boolean().default(false),
    /** Empty: the whole school. */
    classArmIds: z.array(z.string().uuid()).max(100).default([]),
  })
  .nullable();
export type EventRsvpSettingsInput = z.infer<typeof eventRsvpSettingsSchema>;

const rsvpDeadlineRefine = (v: { startDate?: string; rsvp?: EventRsvpSettingsInput }) =>
  !v.rsvp?.deadline || !v.startDate || v.rsvp.deadline <= v.startDate;
const rsvpDeadlineMessage = { message: "Reply-by must be on or before the start date.", path: ["rsvp", "deadline"] };

export const createSchoolEventSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required.").max(SCHOOL_EVENT_TITLE_MAX),
    description: z.string().trim().max(SCHOOL_EVENT_DESCRIPTION_MAX).nullable().optional(),
    category: z.enum(SCHOOL_EVENT_CATEGORIES),
    startDate: z.string().date("Start date must be a real date."),
    endDate: z.string().date("End date must be a real date."),
    rsvp: eventRsvpSettingsSchema.optional(),
    /** 2026-10-22: shown on the school's public website (school-website.md). */
    showOnWebsite: z.boolean().optional(),
  })
  .refine(dateRangeRefine, dateRangeMessage)
  .refine(rsvpDeadlineRefine, rsvpDeadlineMessage);
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
    rsvp: eventRsvpSettingsSchema.optional(),
    showOnWebsite: z.boolean().optional(),
  })
  .refine((v) => (v.startDate === undefined) === (v.endDate === undefined), {
    message: "Send startDate and endDate together.",
    path: ["endDate"],
  })
  .refine((v) => v.startDate === undefined || v.endDate === undefined || v.endDate >= v.startDate, dateRangeMessage)
  .refine(rsvpDeadlineRefine, rsvpDeadlineMessage)
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
  /** CP10.1: null when families are not asked to reply. */
  rsvp: SchoolEventRsvpDto | null;
  /** On the school's public website. */
  showOnWebsite: boolean;
}

export interface SchoolEventRsvpDto {
  deadline: string | null;
  askCount: boolean;
  /** Empty: the whole school. */
  classArmIds: string[];
  /** Replies so far. */
  counts: RsvpCountsDto;
}

export interface RsvpCountsDto {
  /** Parents asked. */
  asked: number;
  yes: number;
  no: number;
  maybe: number;
  notAnswered: number;
  /** People coming, from Yes answers (and Maybe, counted apart). */
  attending: number;
  maybeAttending: number;
}

// GET /calendar/events/:id/rsvps
export interface EventRsvpListDto {
  event: { id: string; title: string; startDate: string; deadline: string | null; askCount: boolean; open: boolean };
  counts: RsvpCountsDto;
  rows: EventRsvpRowDto[];
}

export interface EventRsvpRowDto {
  guardianId: string;
  guardianName: string;
  phone: string;
  children: { name: string; className: string | null }[];
  answer: RsvpAnswer | null;
  attending: number | null;
  answeredAt: string | null;
}

// POST /portal/calendar/events/:id/rsvp
export const answerRsvpSchema = z
  .object({
    answer: z.enum(RSVP_ANSWERS),
    attending: z.number().int().min(1).max(RSVP_MAX_ATTENDING).nullable().default(null),
  })
  .refine((v) => v.answer !== "NO" || v.attending === null, { message: "No one is coming with a No.", path: ["attending"] });
export type AnswerRsvpInput = z.infer<typeof answerRsvpSchema>;

/** What a parent sees on an event that asks them to reply. */
export interface FamilyRsvpDto {
  deadline: string | null;
  askCount: boolean;
  /** Replies are still accepted. */
  open: boolean;
  answer: RsvpAnswer | null;
  attending: number | null;
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
  /** CP10.1, guardian reads only: the event asks this family to reply. */
  rsvp?: FamilyRsvpDto | null;
}

export interface CalendarResponse {
  from: string;
  to: string;
  entries: CalendarEntryDto[];
}

/**
 * Human labels for every category a calendar entry can carry — shared so web,
 * portal and mobile never word the same event differently.
 */
export const CALENDAR_CATEGORY_LABELS: Record<CalendarEntryCategory, string> = {
  HOLIDAY: "Holiday",
  BREAK: "Break",
  EXAM_PERIOD: "Exams",
  MEETING: "Meeting",
  EVENT: "Event",
  RESUMPTION: "Resumption",
  OTHER: "Other",
  PUBLIC_HOLIDAY: "Public holiday",
  SPECIAL_HOLIDAY: "Special holiday",
  TERM_START: "Term",
  TERM_END: "Term",
};

/** Groups entries (already sorted by the API) under "June 2026"-style month keys, preserving order. */
export function groupCalendarEntriesByMonth<T extends { startDate: string }>(entries: T[]): Array<{ month: string; entries: T[] }> {
  const groups: Array<{ month: string; entries: T[] }> = [];
  for (const e of entries) {
    const month = e.startDate.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.entries.push(e);
    else groups.push({ month, entries: [e] });
  }
  return groups;
}
