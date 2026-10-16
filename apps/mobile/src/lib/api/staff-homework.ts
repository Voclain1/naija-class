import type {
  AssignmentMarkingDto,
  CollectWorkInput,
  MarkSubmissionInput,
  ReturnSubmissionInput,
  StudentWorkDto,
  CreateHomeworkInput,
  HomeworkDto,
  HomeworkListResponse,
} from "@school-kit/types";

import { apiFetch } from "./client";

// Homework, staff side (docs/modules/the-school-day.md Part B).
//
// The list defaults to the caller's OWN — which is what a teacher wants and
// the only thing the server will give them. `all` exists for owner/admin and
// is refused for anyone else rather than quietly narrowed, so the phone does
// not offer it to a teacher.

export function staffHomework(classArmId?: string, all?: boolean): Promise<HomeworkListResponse> {
  const params = new URLSearchParams();
  if (classArmId) params.set("classArmId", classArmId);
  if (all) params.set("all", "true");
  const query = params.toString();
  return apiFetch<HomeworkListResponse>(`/homework${query ? `?${query}` : ""}`);
}

export function createStaffHomework(input: CreateHomeworkInput): Promise<HomeworkDto> {
  return apiFetch<HomeworkDto>("/homework", { method: "POST", body: input });
}

export function withdrawStaffHomework(id: string): Promise<HomeworkDto> {
  return apiFetch<HomeworkDto>(`/homework/${encodeURIComponent(id)}/withdraw`, { method: "POST" });
}

// Phase 9 / CP4.1 — collecting work and marking it (docs/modules/phase-9.md
// §11). Owner, admin and the class's teachers; the server checks the class.

const enc = encodeURIComponent;

export function collectStaffWork(homeworkId: string, input: CollectWorkInput): Promise<AssignmentMarkingDto> {
  return apiFetch<AssignmentMarkingDto>(`/assignments/${enc(homeworkId)}/collection`, { method: "PUT", body: input });
}

export function staffMarking(homeworkId: string): Promise<AssignmentMarkingDto> {
  return apiFetch<AssignmentMarkingDto>(`/assignments/${enc(homeworkId)}/submissions`);
}

export function staffStudentWork(homeworkId: string, studentId: string): Promise<StudentWorkDto> {
  return apiFetch<StudentWorkDto>(`/assignments/${enc(homeworkId)}/students/${enc(studentId)}`);
}

export function markStaffSubmission(submissionId: string, input: MarkSubmissionInput): Promise<StudentWorkDto> {
  return apiFetch<StudentWorkDto>(`/assignments/submissions/${enc(submissionId)}/mark`, { method: "POST", body: input });
}

export function returnStaffSubmission(submissionId: string, input: ReturnSubmissionInput): Promise<StudentWorkDto> {
  return apiFetch<StudentWorkDto>(`/assignments/submissions/${enc(submissionId)}/return`, { method: "POST", body: input });
}

export function releaseStaffMarks(homeworkId: string): Promise<AssignmentMarkingDto> {
  return apiFetch<AssignmentMarkingDto>(`/assignments/${enc(homeworkId)}/release`, { method: "POST" });
}
