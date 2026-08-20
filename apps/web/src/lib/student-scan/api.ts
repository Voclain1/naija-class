// Typed wrappers around the Smart Student Import endpoints.
// See docs/modules/smart-student-import.md.

import type {
  CommitScanInput,
  ScanExtractionResponse,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export interface ScanCommitResult {
  committedRows: number;
  notEnrolledRows: number;
  failedRows: { rowNumber: number; field: string; message: string }[];
}

// GET /student-scan/availability
//
// Asked before the camera is offered, so an admin never photographs a
// register and only then discovers AI is switched off for their school.
export async function getScanAvailability(): Promise<{ available: boolean }> {
  return apiFetch<{ available: boolean }>("/student-scan/availability");
}

// POST /student-scan — multipart.
//
// apiFetch detects FormData and leaves Content-Type unset so the browser
// generates the multipart boundary itself.
//
// NO TIMEOUT IS SET HERE, deliberately. Extraction is synchronous because the
// image is never persisted (D3) — there is no stored object for a background
// worker to pick up — and a full page can take 30-60s. A default timeout
// would abort a request the school has already been billed for, and the
// budget ledger would show a completed generation the admin never saw.
export async function scanStudentRegister(image: File): Promise<ScanExtractionResponse> {
  const form = new FormData();
  form.append("image", image);
  return apiFetch<ScanExtractionResponse>("/student-scan", {
    method: "POST",
    body: form,
  });
}

// POST /student-scan/:jobId/commit — D4's human gate.
//
// The rows sent here are what the admin confirmed on screen, not what the
// model produced. The server re-validates every field regardless.
export async function commitScan(
  jobId: string,
  input: CommitScanInput,
): Promise<ScanCommitResult> {
  return apiFetch<ScanCommitResult>(`/student-scan/${jobId}/commit`, {
    method: "POST",
    body: input,
  });
}
