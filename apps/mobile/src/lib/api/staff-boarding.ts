import type { HostelVisitDto, HouseBoardersDto, HouseHostelDto, LogHostelVisitInput } from "@school-kit/types";

import { apiFetch } from "./client";

// Phase 9 / CP6b.2 — what a house master keeps (docs/modules/phase-9.md §15
// CP6b-D4, D5, D7). hostel.house: admin, teacher and the House master; the
// service keeps anyone but owner and admin to the hostels they are assigned to.

export function staffMyHostels(): Promise<HouseHostelDto[]> {
  return apiFetch<HouseHostelDto[]>("/boarding/hostels");
}

export function staffHostelBoarders(hostelId: string): Promise<HouseBoardersDto> {
  return apiFetch<HouseBoardersDto>(`/boarding/hostels/${encodeURIComponent(hostelId)}/boarders`);
}

export function staffHostelVisits(hostelId: string, day: string): Promise<HostelVisitDto[]> {
  return apiFetch<HostelVisitDto[]>(`/boarding/hostels/${encodeURIComponent(hostelId)}/visits?${new URLSearchParams({ day }).toString()}`);
}

export function staffLogHostelVisit(hostelId: string, body: LogHostelVisitInput): Promise<HostelVisitDto> {
  return apiFetch<HostelVisitDto>(`/boarding/hostels/${encodeURIComponent(hostelId)}/visits`, { method: "POST", body });
}

export function staffVisitorLeft(visitId: string): Promise<HostelVisitDto> {
  return apiFetch<HostelVisitDto>(`/boarding/visits/${encodeURIComponent(visitId)}/left`, { method: "PATCH", body: {} });
}
