import type {
  CopyBedsInput,
  CopyBedsResultDto,
  CreateBedInput,
  CreateHostelInput,
  HostelBedDto,
  HostelDto,
  HouseMasterCandidateDto,
  MoveBedInput,
  RoomInput,
  SetHostelFeeResultDto,
  StudentHostelDto,
  UpdateHostelInput,
  UpdateRoomInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

// Phase 9 / CP6b.1 — hostels, rooms and beds (docs/modules/phase-9.md §15).

const id = (value: string) => encodeURIComponent(value);
const termQuery = (termId?: string) => (termId ? `?${new URLSearchParams({ termId })}` : "");

export const listHostels = (termId?: string) => apiFetch<HostelDto[]>(`/hostels${termQuery(termId)}`, { method: "GET" });
export const getHostel = (hostelId: string, termId?: string) =>
  apiFetch<HostelDto>(`/hostels/${id(hostelId)}${termQuery(termId)}`, { method: "GET" });
export const createHostel = (body: CreateHostelInput) => apiFetch<HostelDto>("/hostels", { method: "POST", body });
export const updateHostel = (hostelId: string, body: UpdateHostelInput) =>
  apiFetch<HostelDto>(`/hostels/${id(hostelId)}`, { method: "PATCH", body });
export const deleteHostel = (hostelId: string) => apiFetch<void>(`/hostels/${id(hostelId)}`, { method: "DELETE" });
export const setHostelFee = (hostelId: string, fee: number) =>
  apiFetch<SetHostelFeeResultDto>(`/hostels/${id(hostelId)}/fee`, { method: "PUT", body: { fee } });
export const houseMasterCandidates = () => apiFetch<HouseMasterCandidateDto[]>("/hostels/house-master-candidates", { method: "GET" });
export const setHouseMasters = (hostelId: string, userIds: string[]) =>
  apiFetch<HostelDto>(`/hostels/${id(hostelId)}/house-masters`, { method: "PUT", body: { userIds } });

export const createRoom = (hostelId: string, body: RoomInput) => apiFetch<HostelDto>(`/hostels/${id(hostelId)}/rooms`, { method: "POST", body });
export const updateRoom = (roomId: string, body: UpdateRoomInput) => apiFetch<HostelDto>(`/hostels/rooms/${id(roomId)}`, { method: "PATCH", body });
export const deleteRoom = (roomId: string) => apiFetch<HostelDto>(`/hostels/rooms/${id(roomId)}`, { method: "DELETE" });

export const listBeds = (hostelId: string, termId: string) => apiFetch<HostelBedDto[]>(`/hostels/${id(hostelId)}/beds${termQuery(termId)}`, { method: "GET" });
export const placeStudent = (body: CreateBedInput) => apiFetch<HostelBedDto>("/hostels/beds", { method: "POST", body });
export const moveStudent = (bedId: string, body: MoveBedInput) => apiFetch<HostelBedDto>(`/hostels/beds/${id(bedId)}`, { method: "PATCH", body });
export const removeStudent = (bedId: string) => apiFetch<void>(`/hostels/beds/${id(bedId)}`, { method: "DELETE" });
export const copyBeds = (body: CopyBedsInput) => apiFetch<CopyBedsResultDto>("/hostels/beds/copy", { method: "POST", body });

export const getStudentHostel = (studentId: string) =>
  apiFetch<StudentHostelDto | null>(`/hostels/students/${id(studentId)}`, { method: "GET" });
