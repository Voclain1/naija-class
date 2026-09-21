import {
  SCHOOL_EVENT_DESCRIPTION_MAX,
  SCHOOL_EVENT_TITLE_MAX,
  type AuthMeRoleDto,
  type CalendarEntryDto,
  type CreateSchoolEventInput,
  type SchoolEventCategory,
  type SchoolEventDto,
  type UpdateSchoolEventInput,
} from "@school-kit/types";

import { hasPermission } from "../auth/permissions";
import { isSchoolAdmin } from "../auth/roles";
import { isoDateFromParts } from "./student-form";

// CP9a — the rules behind adding, editing and removing a school event from
// the phone.
//
// Pure and separately tested, for three reasons:
//
// 1. WHO MAY. CalendarService checks the owner/admin ROLE on every write
//    (`assertUserActiveAndHasOneOf(["owner", "admin"])`) on top of the
//    controller's permission, so the phone asks both questions — a role with
//    `calendar-event.create` but not owner/admin would be offered a form that
//    can only refuse them.
// 2. ONLY SCHOOL EVENTS ARE EDITABLE. The merged calendar also carries
//    national holidays and term boundaries; neither has an edit route, and a
//    term date is changed where terms are set, not here. The entry id prefix
//    ("school:") is the API's own marker of which rows are the school's.
// 3. DATES ARE DAY/MONTH/YEAR BOXES, like the student form, and an event
//    left without an end date is a one-day event — the common case should
//    not need the same date typed twice.

export interface EventFormValues {
  title: string;
  category: SchoolEventCategory | null;
  startDay: string;
  startMonth: string;
  startYear: string;
  endDay: string;
  endMonth: string;
  endYear: string;
  description: string;
}

export type EventFormErrors = Partial<Record<"title" | "category" | "startDate" | "endDate" | "description", string>>;

export interface CalendarAbilities {
  create: boolean;
  update: boolean;
  remove: boolean;
}

export function calendarAbilities(
  roles: readonly Pick<AuthMeRoleDto, "key">[] | undefined,
  permissions: readonly string[],
): CalendarAbilities {
  const admin = isSchoolAdmin(roles);
  return {
    create: admin && hasPermission(permissions, "calendar-event.create"),
    update: admin && hasPermission(permissions, "calendar-event.update"),
    remove: admin && hasPermission(permissions, "calendar-event.delete"),
  };
}

const SCHOOL_PREFIX = "school:";

/** The school event behind a calendar entry, or null for national events and term dates. */
export function schoolEventId(entry: Pick<CalendarEntryDto, "id" | "source">): string | null {
  if (entry.source !== "SCHOOL" || !entry.id.startsWith(SCHOOL_PREFIX)) return null;
  const id = entry.id.slice(SCHOOL_PREFIX.length);
  return id === "" ? null : id;
}

function parts(iso: string | null | undefined): [string, string, string] {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ["", "", ""];
  const [y, m, d] = iso.split("-");
  return [String(Number(d)), String(Number(m)), y as string];
}

/** A blank form; `date` (YYYY-MM-DD) pre-fills the start — the day the admin tapped. */
export function emptyEventForm(date?: string | null): EventFormValues {
  const [startDay, startMonth, startYear] = parts(date);
  return {
    title: "",
    category: null,
    startDay,
    startMonth,
    startYear,
    endDay: "",
    endMonth: "",
    endYear: "",
    description: "",
  };
}

export function eventFormFrom(event: SchoolEventDto): EventFormValues {
  const [startDay, startMonth, startYear] = parts(event.startDate);
  const [endDay, endMonth, endYear] =
    event.endDate === event.startDate ? ["", "", ""] : parts(event.endDate);
  return {
    title: event.title,
    category: event.category,
    startDay,
    startMonth,
    startYear,
    endDay,
    endMonth,
    endYear,
    description: event.description ?? "",
  };
}

function endIsBlank(v: EventFormValues): boolean {
  return v.endDay.trim() === "" && v.endMonth.trim() === "" && v.endYear.trim() === "";
}

/** The two dates the form describes, or null where a date is not real. */
export function eventDates(v: EventFormValues): { startDate: string | null; endDate: string | null } {
  const startDate = isoDateFromParts(v.startDay, v.startMonth, v.startYear);
  const endDate = endIsBlank(v) ? startDate : isoDateFromParts(v.endDay, v.endMonth, v.endYear);
  return { startDate, endDate };
}

export function validateEventForm(v: EventFormValues): EventFormErrors {
  const errors: EventFormErrors = {};
  const title = v.title.trim();
  if (title === "") errors.title = "Give the event a name.";
  else if (title.length > SCHOOL_EVENT_TITLE_MAX) {
    errors.title = `Keep the name under ${SCHOOL_EVENT_TITLE_MAX} characters.`;
  }
  if (v.category === null) errors.category = "Choose what kind of event this is.";
  if (v.description.trim().length > SCHOOL_EVENT_DESCRIPTION_MAX) {
    errors.description = `Keep the note under ${SCHOOL_EVENT_DESCRIPTION_MAX} characters.`;
  }
  const { startDate, endDate } = eventDates(v);
  if (startDate === null) errors.startDate = "Enter a real start date — day, month, year.";
  if (!endIsBlank(v) && endDate === null) {
    errors.endDate = "Enter a real end date, or leave it blank for a one-day event.";
  } else if (startDate !== null && endDate !== null && endDate < startDate) {
    errors.endDate = "The end date cannot be before the start date.";
  }
  return errors;
}

/** Call only after validateEventForm returned no errors. */
export function buildCreateEventInput(v: EventFormValues): CreateSchoolEventInput {
  const { startDate, endDate } = eventDates(v);
  const description = v.description.trim();
  return {
    title: v.title.trim(),
    category: v.category as SchoolEventCategory,
    startDate: startDate as string,
    endDate: endDate as string,
    description: description === "" ? null : description,
  };
}

/**
 * Only what changed, so an edit never re-sends a field the admin did not
 * touch. The dates travel as a pair or not at all — the API's rule, because it
 * checks the range without reading the row. Null when nothing changed.
 */
export function buildUpdateEventInput(
  original: SchoolEventDto,
  v: EventFormValues,
): UpdateSchoolEventInput | null {
  const next = buildCreateEventInput(v);
  const patch: UpdateSchoolEventInput = {};
  if (next.title !== original.title) patch.title = next.title;
  if (next.category !== original.category) patch.category = next.category;
  if ((next.description ?? null) !== (original.description ?? null)) {
    patch.description = next.description ?? null;
  }
  if (next.startDate !== original.startDate || next.endDate !== original.endDate) {
    patch.startDate = next.startDate;
    patch.endDate = next.endDate;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}
