// Typed wrappers around the Phase 1 / Slice 3 class-subjects endpoints.
// The matrix UI uses only listForLevel + bulk; single-cell create/update/
// delete are intentionally NOT re-exported because the matrix should drive
// every change through /bulk for atomicity. Other callers (slice 13 admin
// scripts, etc.) can call apiFetch directly if needed.

import type {
  BulkClassSubjectsInput,
  ClassSubjectDto,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function listClassSubjectsForLevel(
  classLevelId: string,
): Promise<ClassSubjectDto[]> {
  return apiFetch<ClassSubjectDto[]>(
    `/class-levels/${classLevelId}/class-subjects`,
    { method: "GET" },
  );
}

export function bulkUpdateClassSubjects(
  classLevelId: string,
  input: BulkClassSubjectsInput,
): Promise<ClassSubjectDto[]> {
  return apiFetch<ClassSubjectDto[]>(
    `/class-levels/${classLevelId}/class-subjects/bulk`,
    { method: "POST", body: input },
  );
}
