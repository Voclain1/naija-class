// Typed wrapper around /assignments (Phase 9 / CP4, docs/modules/phase-9.md
// §11): collecting work on a homework item, and marking what students hand in.
// Owner, admin and the class's teachers; never the bursar.

import type {
  AssignmentMarkingDto,
  CollectWorkInput,
  MarkSubmissionInput,
  ReturnSubmissionInput,
  StudentWorkDto,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

const enc = encodeURIComponent;

export function collectWork(homeworkId: string, input: CollectWorkInput): Promise<AssignmentMarkingDto> {
  return apiFetch<AssignmentMarkingDto>(`/assignments/${enc(homeworkId)}/collection`, { method: "PUT", body: input });
}

export function getMarking(homeworkId: string): Promise<AssignmentMarkingDto> {
  return apiFetch<AssignmentMarkingDto>(`/assignments/${enc(homeworkId)}/submissions`);
}

export function getStudentWork(homeworkId: string, studentId: string): Promise<StudentWorkDto> {
  return apiFetch<StudentWorkDto>(`/assignments/${enc(homeworkId)}/students/${enc(studentId)}`);
}

export function markSubmission(submissionId: string, input: MarkSubmissionInput): Promise<StudentWorkDto> {
  return apiFetch<StudentWorkDto>(`/assignments/submissions/${enc(submissionId)}/mark`, { method: "POST", body: input });
}

export function returnSubmission(submissionId: string, input: ReturnSubmissionInput): Promise<StudentWorkDto> {
  return apiFetch<StudentWorkDto>(`/assignments/submissions/${enc(submissionId)}/return`, { method: "POST", body: input });
}

export function releaseMarks(homeworkId: string): Promise<AssignmentMarkingDto> {
  return apiFetch<AssignmentMarkingDto>(`/assignments/${enc(homeworkId)}/release`, { method: "POST" });
}
