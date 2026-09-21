import type {
  CalendarResponse,
  CreateSchoolEventInput,
  SchoolEventDto,
  TeacherTimetableDto,
  UpdateSchoolEventInput,
} from "@school-kit/types";

import { apiFetch } from "./client";

// CP7 (7) — the teacher's own timetable and the school calendar.
//
// Two different permissions, and the split is deliberate upstream: a teacher
// holds `timetable.own.read`, which returns THEIR lessons plus read-only grids
// of the classes they form-teach — never the whole-school builder grid, which
// is `timetable.read` and stays with owner/admin. The phone asks for the
// narrow one and gets exactly what the role is for.
//
// The calendar is the ordinary staff calendar (`calendar-event.read`, held by
// every staff role), not the portal variant the guardian and student screens
// use — same shape on the wire, different endpoint and different session.

export function staffMyTimetable(termId?: string): Promise<TeacherTimetableDto> {
  const query = termId ? `?termId=${encodeURIComponent(termId)}` : "";
  return apiFetch<TeacherTimetableDto>(`/teacher-scope/me/timetable${query}`);
}

export function staffCalendar(window: { from: string; to: string }): Promise<CalendarResponse> {
  const params = new URLSearchParams({ from: window.from, to: window.to });
  return apiFetch<CalendarResponse>(`/calendar?${params.toString()}`);
}

// CP9a — school events, for owners and admins. The merged calendar above is
// read-only by nature (national holidays, term dates); these touch only the
// school's own events, which is all the API lets anyone edit.

export function staffSchoolEvents(window: { from: string; to: string }): Promise<SchoolEventDto[]> {
  const params = new URLSearchParams({ from: window.from, to: window.to });
  return apiFetch<SchoolEventDto[]>(`/calendar/events?${params.toString()}`);
}

export function staffCreateSchoolEvent(input: CreateSchoolEventInput): Promise<SchoolEventDto> {
  return apiFetch<SchoolEventDto>("/calendar/events", { method: "POST", body: input });
}

export function staffUpdateSchoolEvent(id: string, input: UpdateSchoolEventInput): Promise<SchoolEventDto> {
  return apiFetch<SchoolEventDto>(`/calendar/events/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
  });
}

export function staffDeleteSchoolEvent(id: string): Promise<void> {
  return apiFetch<void>(`/calendar/events/${encodeURIComponent(id)}`, { method: "DELETE" });
}
