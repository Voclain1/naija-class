import {
  createSchoolEventSchema,
  updateSchoolEventSchema,
  type CalendarEntryDto,
  type SchoolEventDto,
} from "@school-kit/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setTokenProvider } from "../api/client";
import {
  staffCreateSchoolEvent,
  staffDeleteSchoolEvent,
  staffSchoolEvents,
  staffUpdateSchoolEvent,
} from "../api/staff-schedule";
import { queryKeys } from "../query/keys";
import {
  buildCreateEventInput,
  buildUpdateEventInput,
  calendarAbilities,
  emptyEventForm,
  eventFormFrom,
  schoolEventId,
  validateEventForm,
  type EventFormValues,
} from "./event-form";

const EVENT: SchoolEventDto = {
  id: "7c1f0f7e-1c2b-4a57-9a55-2f3c1f1d0a11",
  title: "Inter-house sports",
  description: null,
  category: "EVENT",
  startDate: "2026-10-09",
  endDate: "2026-10-09",
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-01T09:00:00.000Z",
};

const FILLED: EventFormValues = {
  ...emptyEventForm("2026-10-09"),
  title: "Inter-house sports",
  category: "EVENT",
};

function entry(overrides: Partial<CalendarEntryDto>): CalendarEntryDto {
  return {
    id: `school:${EVENT.id}`,
    source: "SCHOOL",
    title: EVENT.title,
    category: "EVENT",
    startDate: EVENT.startDate,
    endDate: EVENT.endDate,
    dateConfirmed: true,
    description: null,
    ...overrides,
  };
}

describe("who may change the calendar", () => {
  it("is owners and admins holding the permission — the two checks the server makes", () => {
    expect(calendarAbilities([{ key: "owner" }], ["*"])).toEqual({ create: true, update: true, remove: true });
    expect(
      calendarAbilities([{ key: "admin" }], ["calendar-event.create", "calendar-event.update"]),
    ).toEqual({ create: true, update: true, remove: false });
  });

  it("is NOT a teacher, even one granted the permission — CalendarService checks the role", () => {
    expect(calendarAbilities([{ key: "teacher" }], ["calendar-event.create"]).create).toBe(false);
    expect(calendarAbilities(undefined, ["*"]).create).toBe(false);
  });
});

describe("which entries are the school's to edit", () => {
  it("takes the id from a school entry", () => {
    expect(schoolEventId(entry({}))).toBe(EVENT.id);
  });

  it("refuses national holidays and term dates", () => {
    expect(schoolEventId(entry({ id: "national:abc", source: "NATIONAL" }))).toBeNull();
    expect(schoolEventId(entry({ id: "term-start:t1", source: "TERM" }))).toBeNull();
    // A mislabelled row is refused too — the prefix and the source must agree.
    expect(schoolEventId(entry({ id: "national:abc", source: "SCHOOL" }))).toBeNull();
    expect(schoolEventId(entry({ id: "school:" }))).toBeNull();
  });
});

describe("the event form", () => {
  it("starts on the day the admin tapped, with the kind unanswered", () => {
    const form = emptyEventForm("2026-10-09");
    expect([form.startDay, form.startMonth, form.startYear]).toEqual(["9", "10", "2026"]);
    expect(form.category).toBeNull();
    expect(emptyEventForm(null).startYear).toBe("");
  });

  it("treats a blank end as a one-day event", () => {
    const input = buildCreateEventInput(FILLED);
    expect(input).toEqual({
      title: "Inter-house sports",
      category: "EVENT",
      startDate: "2026-10-09",
      endDate: "2026-10-09",
      description: null,
    });
    // What the phone sends is what the API validates.
    expect(createSchoolEventSchema.safeParse(input).success).toBe(true);
  });

  it("asks for a name, a kind and a real start date", () => {
    const errors = validateEventForm({ ...emptyEventForm(null), startDay: "31", startMonth: "2", startYear: "2026" });
    expect(Object.keys(errors).sort()).toEqual(["category", "startDate", "title"]);
  });

  it("refuses an end before the start, and a half-typed end", () => {
    expect(
      validateEventForm({ ...FILLED, endDay: "8", endMonth: "10", endYear: "2026" }).endDate,
    ).toMatch(/before the start/);
    expect(validateEventForm({ ...FILLED, endDay: "12" }).endDate).toMatch(/real end date/);
    expect(validateEventForm({ ...FILLED, endDay: "12", endMonth: "10", endYear: "2026" })).toEqual({});
  });

  it("round-trips an existing event, leaving a one-day event's end blank", () => {
    const form = eventFormFrom(EVENT);
    expect(form.endDay).toBe("");
    expect(buildUpdateEventInput(EVENT, form)).toBeNull();
    const span = eventFormFrom({ ...EVENT, endDate: "2026-10-10" });
    expect([span.endDay, span.endMonth, span.endYear]).toEqual(["10", "10", "2026"]);
  });

  it("sends only what changed, and the dates as a pair", () => {
    const renamed = buildUpdateEventInput(EVENT, { ...eventFormFrom(EVENT), title: "Sports day" });
    expect(renamed).toEqual({ title: "Sports day" });

    const moved = buildUpdateEventInput(EVENT, { ...eventFormFrom(EVENT), startDay: "16" });
    expect(moved).toEqual({ startDate: "2026-10-16", endDate: "2026-10-16" });
    expect(updateSchoolEventSchema.safeParse(moved).success).toBe(true);

    const noted = buildUpdateEventInput(EVENT, { ...eventFormFrom(EVENT), description: "  Bring water " });
    expect(noted).toEqual({ description: "Bring water" });
  });
});

describe("event bindings", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setTokenProvider(() => "test-token");
    fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify([EVENT]), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setTokenProvider(() => null);
  });

  function lastCall(): { url: URL; init: RequestInit } {
    const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
    return { url: new URL(url), init };
  }

  it("reads the school's own events for a window", async () => {
    const events = await staffSchoolEvents({ from: "2026-10-09", to: "2026-10-09" });
    const { url } = lastCall();
    expect(url.pathname).toMatch(/\/calendar\/events$/);
    expect(url.searchParams.get("from")).toBe("2026-10-09");
    expect(events[0]?.id).toBe(EVENT.id);
  });

  it("creates, updates and deletes on the event routes", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(EVENT), { status: 201 })));
    await staffCreateSchoolEvent(buildCreateEventInput(FILLED));
    expect(lastCall().init.method).toBe("POST");

    await staffUpdateSchoolEvent(EVENT.id, { title: "Sports day" });
    expect(lastCall().init.method).toBe("PATCH");
    expect(lastCall().url.pathname).toMatch(new RegExp(`/calendar/events/${EVENT.id}$`));

    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    await expect(staffDeleteSchoolEvent(EVENT.id)).resolves.toBeUndefined();
    expect(lastCall().init.method).toBe("DELETE");
  });

  it("keeps every calendar key under the staff prefix, so an event write clears every month", () => {
    const month = queryKeys.staffCalendar("s", "u", "2026-10-01", "2026-10-31");
    const all = queryKeys.staffCalendarAll("s", "u");
    expect(month.slice(0, all.length)).toEqual([...all]);
    expect(queryKeys.staffSchoolEvents("s", "u", "a", "b")[0]).toBe("staff");
  });
});
