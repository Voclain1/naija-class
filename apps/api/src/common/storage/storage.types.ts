// Typed scope keys for objects we store on behalf of a tenant.
//
// Why a discriminated union, not a raw path: every method on
// StorageDriver takes (schoolId, key) and asks the driver to derive the
// actual storage path. There is no API for "give me the object at this
// raw path" — that would be a path-traversal foot-gun ("schools/A/.../
// /schools/B/..."). New blob kinds require adding a case here AND to
// pathFor() in storage.utils.ts, so a casual caller cannot bypass the
// layout.
export type StorageObjectKey =
  | { kind: "import-source"; jobId: string }
  | { kind: "import-error-report"; jobId: string }
  // Phase 2 / Slice 5 — the rendered report-card PDF. Layout:
  // schools/<schoolId>/report-cards/<termId>/<studentId>.pdf
  | { kind: "report-card"; termId: string; studentId: string }
  // Phase 3 / Slice 7 — HTML payment receipt. Layout:
  // schools/<schoolId>/receipts/<paymentId>.html
  | { kind: "payment-receipt"; paymentId: string }
  // Phase 3 / Slice 13 — user-uploaded expense receipt (photo or scanned
  // invoice). Layout: schools/<schoolId>/expenses/<expenseId>/receipt
  // Deliberately NO file extension in the path — unlike payment-receipt
  // (always .html), the upload can be JPEG/PNG/PDF and the object's
  // Content-Type (set from the upload's mimetype at put() time) is what
  // tells the browser how to render it, not the URL. Adding an `ext` field
  // here would require persisting it back on the Expense row just so a
  // later get()/signUrl()/delete() call could reconstruct the same key —
  // an extensionless path avoids that entirely.
  | { kind: "expense-receipt"; expenseId: string }
  // Phase 3 / Payroll CP3 — HTML payslip. Layout:
  // schools/<schoolId>/payslips/<payrollItemId>.html
  // Same shape as payment-receipt: always .html, canonical path persisted
  // on PayrollItem.payslipUrl, signed on demand for viewing.
  | { kind: "payroll-payslip"; payrollItemId: string };

export type StorageDriverKind = "filesystem" | "r2";

// Output of put*: every driver returns the SAME shape — the canonical
// storage path string (e.g. "schools/<id>/imports/<jobId>/source.csv").
// Persisted on ImportJob.sourceFileUrl. Drivers do NOT return absolute
// filesystem paths or signed URLs from put* — those come from sign*.
export type StoragePath = string;

// Input for put*. We accept a Node Buffer because the multipart upload
// produces one (file size is capped at 5 MB by slice-6 controller, so
// in-memory is fine). Slice 7 may stream large error-report CSVs back
// to R2 with a separate streaming overload.
export type StorageBody = Buffer;

export interface StorageDriver {
  /**
   * Persist a tenant-scoped object. Returns the canonical storage path
   * (the same layout for every driver — see storage.utils.ts/pathFor).
   *
   * Drivers MUST validate that schoolId and key components are UUIDs
   * (or otherwise safe identifiers) before touching the underlying
   * store. A driver that accepts a slash-containing schoolId is broken.
   */
  put(
    schoolId: string,
    key: StorageObjectKey,
    body: StorageBody,
    contentType: string,
    contentDisposition?: string,
  ): Promise<StoragePath>;

  /**
   * Read a tenant-scoped object as a Buffer. Slice 6's validate worker
   * reads via this method (5 MB ceiling, in-memory is fine). Slice 7
   * may add a streaming variant.
   */
  get(schoolId: string, key: StorageObjectKey): Promise<Buffer>;

  /**
   * Produce a short-lived URL the admin's browser can fetch directly.
   * For the filesystem driver in dev this is a path the api will serve
   * over a tenant-checked endpoint (slice 6 does not yet expose such an
   * endpoint — the bad-rows download is built in cp3 and goes through
   * the api). For R2 in prod this is a presigned URL with the configured
   * TTL.
   */
  signUrl(
    schoolId: string,
    key: StorageObjectKey,
    ttlSeconds: number,
  ): Promise<string>;

  /**
   * Delete a single object. No-op if it doesn't exist (idempotent).
   */
  delete(schoolId: string, key: StorageObjectKey): Promise<void>;

  /**
   * Delete every object under a tenant + jobId prefix. Used on
   * DELETE /imports/:jobId to clean up R2 / local disk in one call.
   * Slice 7's commit cleanup uses the same method.
   */
  deleteImportPrefix(schoolId: string, jobId: string): Promise<void>;

  /**
   * Sentinel — returned by storage.utils.ts/pathFor for testing. Allows
   * a unit test to assert the canonical path layout without touching
   * either backend. Not part of the runtime hot path.
   */
  readonly kind: StorageDriverKind;
}
