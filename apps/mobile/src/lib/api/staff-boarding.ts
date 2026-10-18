import type { HostelExeatDto, HostelVisitDto, HouseBoardersDto, HouseHostelDto, LogHostelVisitInput, StaffHostelExeatInput } from "@school-kit/types";

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

// Phase 9 / CP6b.3 — leave out (exeats): the open ones, and each step.
export function staffHostelExeats(hostelId: string, view: "open" | "past" = "open"): Promise<HostelExeatDto[]> {
  return apiFetch<HostelExeatDto[]>(`/boarding/hostels/${encodeURIComponent(hostelId)}/exeats?view=${view}`);
}

// CP11.2 (docs/modules/phase-9.md §20): a request taken by phone, and cancel.
export function staffRecordExeat(hostelId: string, input: StaffHostelExeatInput): Promise<HostelExeatDto> {
  return apiFetch<HostelExeatDto>(`/boarding/hostels/${encodeURIComponent(hostelId)}/exeats`, { method: "POST", body: input });
}

export function staffExeatStep(exeatId: string, step: "approve" | "refuse" | "left" | "back" | "cancel", body: Record<string, string> = {}): Promise<HostelExeatDto> {
  return apiFetch<HostelExeatDto>(`/boarding/exeats/${encodeURIComponent(exeatId)}/${step}`, { method: "POST", body });
}
