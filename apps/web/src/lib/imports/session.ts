// Bridges the upload response (headers + sampleRows) from step 1 → step 2
// of the wizard. The wizard URL carries the jobId but the GET /imports/:id
// endpoint deliberately doesn't expose the CSV headers (PII concerns +
// keeping the row projection lossy). We therefore park them in
// sessionStorage keyed by jobId so refresh inside the same browser session
// resumes mapping cleanly.
//
// If sessionStorage is empty on mount (different tab, manual URL paste,
// browser restart), the mapping page redirects back to /students/import.
// That gap is acceptable because:
//   - typical wizard completion is <5min
//   - the job row + uploaded blob are still tenant-scoped & abortable
//   - exposing headers via GET would broaden the public DTO surface for a
//     fringe case; deferring is cheap
//
// Tracked in docs/deferred.md as "expose headers on GET /imports/:jobId".

import type { ImportUploadResponse } from "@school-kit/types";

const KEY_PREFIX = "sk_import_upload_";

export function saveUploadResponse(res: ImportUploadResponse): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      `${KEY_PREFIX}${res.jobId}`,
      JSON.stringify({
        headers: res.headers,
        sampleRows: res.sampleRows,
        totalRows: res.totalRows,
      }),
    );
  } catch {
    // Quota or disabled storage — fall through silently. The mapping page
    // will detect the missing entry and redirect back to upload.
  }
}

export interface UploadSessionData {
  headers: string[];
  sampleRows: Record<string, string>[];
  totalRows: number;
}

export function loadUploadResponse(jobId: string): UploadSessionData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`${KEY_PREFIX}${jobId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UploadSessionData;
    if (
      !Array.isArray(parsed.headers) ||
      !Array.isArray(parsed.sampleRows) ||
      typeof parsed.totalRows !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearUploadResponse(jobId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(`${KEY_PREFIX}${jobId}`);
  } catch {
    // Same rationale as above — nothing to do if the storage call fails.
  }
}
