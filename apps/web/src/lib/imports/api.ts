// Typed wrappers around the Phase 1 / Slice 6 CSV-import endpoints.
//
// Two endpoints break the apiFetch JSON convention:
//   - upload uses multipart/form-data, so we fetch() directly with FormData
//     and let the browser set the Content-Type boundary
//   - bad-rows.csv returns a binary text/csv blob, which we trigger as a
//     browser download via an in-memory <a> click
//
// Everything else is a plain JSON call through apiFetch.

import type {
  ApplyStudentImportMappingInput,
  ImportCommitAcceptedResponse,
  ImportJobDto,
  ImportMappingAcceptedResponse,
  ImportUploadResponse,
} from "@school-kit/types";

import { ApiError, apiFetch, getStoredToken } from "../api-client";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

// POST /imports/students/upload — multipart upload.
//
// We don't reuse apiFetch because it forces application/json. The browser
// MUST set Content-Type for multipart/form-data so the boundary is
// generated correctly — passing it manually would break the parse.
export async function uploadStudentsCsv(
  file: File,
): Promise<ImportUploadResponse> {
  const form = new FormData();
  form.append("file", file);

  const headers = new Headers();
  const token = getStoredToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_BASE_URL}/imports/students/upload`, {
    method: "POST",
    headers,
    body: form,
  });

  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const errorBody =
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      parsed.error &&
      typeof parsed.error === "object"
        ? (parsed.error as { code: string; message: string; details?: unknown })
        : { code: "UNKNOWN_ERROR", message: response.statusText };
    throw new ApiError(response.status, errorBody);
  }

  return parsed as ImportUploadResponse;
}

export function applyStudentsImportMapping(
  jobId: string,
  input: ApplyStudentImportMappingInput,
): Promise<ImportMappingAcceptedResponse> {
  return apiFetch<ImportMappingAcceptedResponse>(
    `/imports/${jobId}/mapping`,
    { method: "POST", body: input },
  );
}

export function getImportJob(jobId: string): Promise<ImportJobDto> {
  return apiFetch<ImportJobDto>(`/imports/${jobId}`, { method: "GET" });
}

export function deleteImportJob(jobId: string): Promise<void> {
  return apiFetch<void>(`/imports/${jobId}`, { method: "DELETE" });
}

// POST /imports/:jobId/commit — fire-and-forget enqueue.
//
// 202 on success with status=COMMITTING; the /done page polls
// GET /imports/:jobId to learn when status flips to COMPLETED or FAILED.
// 409 JOB_NOT_IN_READY_STATE if the job has already been committed (or is
// otherwise not in READY) — the preview-page guard makes this unreachable
// in normal use; we still surface the error cleanly if it happens.
export function triggerImportCommit(
  jobId: string,
): Promise<ImportCommitAcceptedResponse> {
  return apiFetch<ImportCommitAcceptedResponse>(`/imports/${jobId}/commit`, {
    method: "POST",
  });
}

// GET /imports/:jobId/bad-rows.csv — triggers a browser download.
//
// We fetch the bytes (so we can attach the Authorization header) and feed
// them into an in-memory <a download> click. Returns the byte count so the
// caller can surface a "downloaded N KB" toast if desired.
export async function downloadBadRowsCsv(jobId: string): Promise<void> {
  return downloadCsvByPath(
    `/imports/${jobId}/bad-rows.csv`,
    `import-${jobId}-bad-rows.csv`,
  );
}

// GET /imports/:jobId/error-report.csv — same shape as bad-rows.csv, but
// returns the post-COMMIT persisted error report (validate-time bad rows +
// commit-time race-condition failures). 409 NO_ERROR_REPORT if the import
// completed cleanly; the /done page only renders the download link when
// hasErrorReport is true, so that branch is unreachable in normal use.
export async function downloadErrorReportCsv(jobId: string): Promise<void> {
  return downloadCsvByPath(
    `/imports/${jobId}/error-report.csv`,
    `import-${jobId}-error-report.csv`,
  );
}

// Shared CSV-download helper. Exists because Authorization-headered binary
// downloads can't use a plain <a href> — the browser doesn't forward the
// header. The blob fetch + in-memory <a download> click is the only
// browser-native way that preserves auth. Both bad-rows and error-report
// run through this; the only thing that differs is the URL and the
// fallback filename if Content-Disposition is missing.
async function downloadCsvByPath(
  path: string,
  fallbackFilename: string,
): Promise<void> {
  const headers = new Headers();
  const token = getStoredToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    const parsed: unknown = text ? JSON.parse(text) : null;
    const errorBody =
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      parsed.error &&
      typeof parsed.error === "object"
        ? (parsed.error as { code: string; message: string; details?: unknown })
        : { code: "UNKNOWN_ERROR", message: response.statusText };
    throw new ApiError(response.status, errorBody);
  }

  const blob = await response.blob();
  // Parse the filename from Content-Disposition; fall back to the
  // caller-supplied default if the header is missing (shouldn't happen —
  // the controller always sets it).
  const cd = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(cd);
  const filename = match?.[1] ?? fallbackFilename;

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
