import type { StorageObjectKey } from "./storage.types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Centralised path builder. EVERY storage driver MUST route through this
// to construct on-disk / S3 keys. Reasons:
//   1. Single point of truth for layout — schools/<schoolId>/imports/<jobId>/<file>.
//   2. UUID validation on every component. A non-UUID schoolId or jobId
//      gets rejected here, BEFORE any I/O.
//   3. No way to pass a raw path. A caller wanting a different layout
//      must add a new case to StorageObjectKey AND a new branch here.
//
// If you find yourself wanting a raw-path setter on the driver, stop
// and add a new discriminated-union case here instead. That's the rule.
export function pathFor(schoolId: string, key: StorageObjectKey): string {
  if (!UUID_RE.test(schoolId)) {
    throw new Error(`storage: schoolId is not a UUID: ${redact(schoolId)}`);
  }
  switch (key.kind) {
    case "import-source": {
      if (!UUID_RE.test(key.jobId)) {
        throw new Error(`storage: jobId is not a UUID: ${redact(key.jobId)}`);
      }
      return `schools/${schoolId}/imports/${key.jobId}/source.csv`;
    }
    // slice 7 will add error-report
  }
}

export function importPrefixFor(schoolId: string, jobId: string): string {
  if (!UUID_RE.test(schoolId)) {
    throw new Error(`storage: schoolId is not a UUID: ${redact(schoolId)}`);
  }
  if (!UUID_RE.test(jobId)) {
    throw new Error(`storage: jobId is not a UUID: ${redact(jobId)}`);
  }
  return `schools/${schoolId}/imports/${jobId}/`;
}

// Defensive redaction for error messages — a bad path could plausibly
// contain user-supplied text and we don't want it in logs verbatim.
function redact(s: string): string {
  return s.length > 8 ? `${s.slice(0, 4)}…${s.slice(-4)}` : "<short>";
}
