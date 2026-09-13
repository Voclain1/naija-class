// Typed wrapper around /calendar (Phase 8 / CP1). Shapes come from
// @school-kit/types so the client cannot drift from the API.

import type {
  CalendarResponse,
  CreateSchoolEventInput,
  ManagedNationalEventDto,
  SchoolEventDto,
  UpdateSchoolEventInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

type Window = { from: string; to: string };

const qs = (w: Window) => `from=${encodeURIComponent(w.from)}&to=${encodeURIComponent(w.to)}`;

export function getCalendar(w: Window): Promise<CalendarResponse> {
  return apiFetch<CalendarResponse>(`/calendar?${qs(w)}`);
}

export function listSchoolEvents(w: Window): Promise<SchoolEventDto[]> {
  return apiFetch<SchoolEventDto[]>(`/calendar/events?${qs(w)}`);
}

export function createSchoolEvent(input: CreateSchoolEventInput): Promise<SchoolEventDto> {
  return apiFetch<SchoolEventDto>("/calendar/events", { method: "POST", body: input });
}

export function updateSchoolEvent(id: string, input: UpdateSchoolEventInput): Promise<SchoolEventDto> {
  return apiFetch<SchoolEventDto>(`/calendar/events/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
}

export function deleteSchoolEvent(id: string): Promise<void> {
  return apiFetch<void>(`/calendar/events/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function listNationalEvents(w: Window): Promise<ManagedNationalEventDto[]> {
  return apiFetch<ManagedNationalEventDto[]>(`/calendar/national-events?${qs(w)}`);
}

export function hideNationalEvent(id: string): Promise<void> {
  return apiFetch<void>(`/calendar/national-events/${encodeURIComponent(id)}/hide`, { method: "PUT" });
}

export function unhideNationalEvent(id: string): Promise<void> {
  return apiFetch<void>(`/calendar/national-events/${encodeURIComponent(id)}/hide`, { method: "DELETE" });
}
