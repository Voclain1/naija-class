// Typed wrappers around the Phase 1 / Slice 4 students endpoints.
//
// All endpoints are admin/owner-gated server-side; the web UI surfaces only
// /students routes inside (admin) so the wrappers do not need to be
// per-role.

import type {
  CreateStudentInput,
  GraduateStudentInput,
  ListStudentsQuery,
  ReactivateStudentInput,
  StudentDetailDto,
  StudentDto,
  StudentListResponse,
  UpdateStudentInput,
  WithdrawStudentInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

function buildListQuery(query: ListStudentsQuery): string {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.search) params.set("search", query.search);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.classArmId) params.set("classArmId", query.classArmId);
  if (query.academicYearId) params.set("academicYearId", query.academicYearId);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function listStudents(
  query: ListStudentsQuery = {},
): Promise<StudentListResponse> {
  return apiFetch<StudentListResponse>(`/students${buildListQuery(query)}`, {
    method: "GET",
  });
}

export function getStudent(id: string): Promise<StudentDetailDto> {
  return apiFetch<StudentDetailDto>(`/students/${id}`, { method: "GET" });
}

export function createStudent(input: CreateStudentInput): Promise<StudentDto> {
  return apiFetch<StudentDto>("/students", { method: "POST", body: input });
}

export function updateStudent(
  id: string,
  input: UpdateStudentInput,
): Promise<StudentDto> {
  return apiFetch<StudentDto>(`/students/${id}`, {
    method: "PATCH",
    body: input,
  });
}

export function withdrawStudent(
  id: string,
  input: WithdrawStudentInput = {},
): Promise<StudentDto> {
  return apiFetch<StudentDto>(`/students/${id}/withdraw`, {
    method: "POST",
    body: input,
  });
}

export function graduateStudent(
  id: string,
  input: GraduateStudentInput = {},
): Promise<StudentDto> {
  return apiFetch<StudentDto>(`/students/${id}/graduate`, {
    method: "POST",
    body: input,
  });
}

export function reactivateStudent(
  id: string,
  input?: ReactivateStudentInput,
): Promise<StudentDto> {
  return apiFetch<StudentDto>(`/students/${id}/reactivate`, {
    method: "POST",
    body: input ?? {},
  });
}
