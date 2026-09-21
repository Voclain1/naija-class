import type {
  ClassArmDto,
  CreateStudentInput,
  GraduateStudentInput,
  ListStudentsQuery,
  StudentDetailDto,
  StudentDto,
  StudentListResponse,
  UpdateStudentInput,
  WithdrawStudentInput,
} from "@school-kit/types";

import { apiFetch } from "./client";

// CP4c — student records for owners and admins.
//
// Every one of these is gated server-side on the owner/admin ROLE
// (StudentsService), which is why the Students screen is offered on
// isSchoolAdmin rather than on `student.read` — teachers hold that permission
// too, for their own class lists, and would be refused here.
//
// The responses carry a student's full record — address, phone, medical
// notes. That is appropriate for the people these endpoints admit, and it is
// also why every query key for them starts with "staff" and is never written
// to disk: a phone left on a staffroom table is the last place that record
// should persist.

export function staffListStudents(query: ListStudentsQuery = {}): Promise<StudentListResponse> {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.status) params.set("status", query.status);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.classArmId) params.set("classArmId", query.classArmId);
  if (query.limit) params.set("limit", String(query.limit));
  const suffix = params.toString();
  return apiFetch<StudentListResponse>(`/students${suffix ? `?${suffix}` : ""}`);
}

export function staffGetStudent(id: string): Promise<StudentDetailDto> {
  return apiFetch<StudentDetailDto>(`/students/${encodeURIComponent(id)}`);
}

export function staffCreateStudent(input: CreateStudentInput): Promise<StudentDto> {
  return apiFetch<StudentDto>("/students", { method: "POST", body: input });
}

export function staffUpdateStudent(id: string, input: UpdateStudentInput): Promise<StudentDto> {
  return apiFetch<StudentDto>(`/students/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
  });
}

export function staffWithdrawStudent(id: string, input: WithdrawStudentInput): Promise<StudentDto> {
  return apiFetch<StudentDto>(`/students/${encodeURIComponent(id)}/withdraw`, {
    method: "POST",
    body: input,
  });
}

export function staffGraduateStudent(id: string, input: GraduateStudentInput): Promise<StudentDto> {
  return apiFetch<StudentDto>(`/students/${encodeURIComponent(id)}/graduate`, {
    method: "POST",
    body: input,
  });
}

/** Active classes, for placing a new student. Inactive classes are excluded server-side. */
export function staffClassArms(): Promise<ClassArmDto[]> {
  return apiFetch<ClassArmDto[]>("/class-arms");
}
