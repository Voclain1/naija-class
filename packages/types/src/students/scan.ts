// Smart Student Import — camera-captured register extraction.
//
// See docs/modules/smart-student-import.md. An admin photographs a class
// register; the model transcribes it; the admin reviews and edits every row;
// only then is anything written to `students`.
//
// WHERE THIS SITS RELATIVE TO THE CSV IMPORT (D4): the scan does NOT get its
// own commit pipeline. Extraction produces rows in the same shape
// parseStudentImportRow produces from a CSV, they land in the same
// ImportJob.previewSnapshot, and they commit through the same
// commitStudentRow worker — the same validation, the same dedup, the same
// class-arm resolution, the same audit action. The only step that does not
// apply is column mapping, because the model already mapped the fields; that
// IS the feature.
//
// So the types below cover exactly two things the CSV path has no equivalent
// for: what the model returns (raw, nullable, with legibility flags), and
// what the admin sends back after reviewing it.

import { z } from "zod";

// ---------------------------------------------------------------------------
// 1. What the model returns.
//
// Mirrors STUDENT_LIST_EXTRACTION_SCHEMA in packages/ai. Every field is
// nullable — including the three the import pipeline treats as required —
// because "could not read the admission number" is a real outcome that has
// to round-trip to the review grid as an empty, flagged cell. Refusing to
// represent it would force the model to choose between inventing a value and
// dropping the row, and it would choose one of those (D6).
//
// This schema is applied to the MODEL's output, so it is a trust boundary as
// much as a type: structured outputs make a shape violation unlikely, not
// impossible, and a malformed extraction must fail loudly here rather than
// halfway through building a preview.

// Upper bound on rows accepted from one page. A register page does not hold
// 200 names; a response claiming it does means the model looped or
// hallucinated a continuation, and truncating silently would hide that. The
// cap is generous enough that no real page hits it.
//
// Declared before the schemas that reference it, not after: these are module-
// scope `const`s evaluated at import time, so a forward reference here is a
// TDZ ReferenceError on load rather than a type error tsc would catch.
export const MAX_ROWS_PER_SCAN = 120;

export const extractedStudentRowSchema = z
  .object({
    admissionNumber: z.string().trim().max(40).nullable(),
    firstName: z.string().trim().max(60).nullable(),
    middleName: z.string().trim().max(60).nullable(),
    lastName: z.string().trim().max(60).nullable(),
    // Strict YYYY-MM-DD — the prompt instructs the model to normalise to it,
    // and an ambiguous written date is returned as null + flagged rather
    // than converted (D6). Validated as a STRING here, not coerced to Date:
    // the value travels to the browser as JSON and back, and a Date would
    // serialise to an ISO instant, reintroducing exactly the "midnight in
    // which zone?" trap CLAUDE.md's @db.Date convention exists to avoid.
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date of birth must be YYYY-MM-DD")
      .nullable(),
    gender: z.enum(["MALE", "FEMALE", "OTHER"]).nullable(),
    classArm: z.string().trim().max(60).nullable(),
    guardianName: z.string().trim().max(120).nullable(),
    guardianPhone: z.string().trim().max(30).nullable(),
    // Fields that are PRESENT on the page but could not be read. Distinct
    // from a null value, which means "absent from the page" — the difference
    // is what tells the admin whether a cell needs their eyes or is simply
    // not something this register records.
    unreadableFields: z.array(z.string().max(40)).max(20),
  })
  .strict();
export type ExtractedStudentRow = z.infer<typeof extractedStudentRowSchema>;

export const studentListExtractionSchema = z
  .object({
    rows: z.array(extractedStudentRowSchema).max(MAX_ROWS_PER_SCAN),
    pageNotes: z.string().max(500).nullable(),
  })
  .strict();
export type StudentListExtraction = z.infer<typeof studentListExtractionSchema>;

// ---------------------------------------------------------------------------
// 2. Upload constraints.
//
// 10 MB matches the Claude API's own per-image base64 ceiling, so a file
// that passes here cannot fail at the API for size. Anything larger is a
// user-experience problem (a slow upload over Nigerian mobile data) long
// before it is a technical one.
export const SCAN_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// JPEG, PNG and WebP only. GIF is technically accepted by the API but there
// is no camera on earth that produces one, and every format admitted here is
// a format the dimension decoder has to handle.
export const SCAN_ACCEPTED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ScanMimeType = (typeof SCAN_ACCEPTED_MIME_TYPES)[number];

// ---------------------------------------------------------------------------
// 3. What the admin sends back after reviewing (D4 — the human gate).
//
// The reviewed rows are the AUTHORITATIVE input to the commit, not the
// extracted ones: the admin has by then corrected names, filled unreadable
// cells and deleted rows that were not students. The server re-validates
// every field from scratch against studentImportRowSchema rather than
// trusting anything it produced earlier in the flow — the extraction is a
// draft, and a draft the client has been editing is not a source of truth.
//
// Note there is no `unreadableFields` here. Legibility is a property of the
// extraction, not of the confirmed record; once a human has looked at a cell
// and accepted or corrected it, how hard it was to read stops mattering.
export const reviewedStudentRowSchema = z
  .object({
    // Echoed back so a per-row commit error can be reported against the row
    // the admin is looking at, rather than against an index that shifts when
    // they delete a row mid-review.
    rowNumber: z.number().int().min(1),
    admissionNumber: z.string().trim().min(1, "admission number required").max(40),
    firstName: z.string().trim().min(1, "first name required").max(60),
    middleName: z.string().trim().max(60).optional(),
    lastName: z.string().trim().min(1, "last name required").max(60),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date of birth must be YYYY-MM-DD"),
    gender: z.enum(["MALE", "FEMALE", "OTHER"]),
    classArm: z.string().trim().max(60).optional(),
  })
  .strict();
export type ReviewedStudentRow = z.infer<typeof reviewedStudentRowSchema>;

export const commitScanSchema = z
  .object({
    rows: z.array(reviewedStudentRowSchema).min(1, "at least one row required").max(MAX_ROWS_PER_SCAN),
    // Same option the CSV mapping step offers. Optional: a school mid-
    // admission legitimately creates students without enrolling them.
    targetTermId: z.string().uuid().optional(),
  })
  .strict();
export type CommitScanInput = z.infer<typeof commitScanSchema>;

// ---------------------------------------------------------------------------
// 4. What the extraction endpoint returns to the review screen.
export interface ScanExtractionResponse {
  jobId: string;
  rows: ExtractedStudentRow[];
  // The model's one-line note about the page as a whole — cut off, obscured,
  // not a register at all. Surfaced above the grid because it explains a
  // whole bad extraction in a way per-row flags cannot.
  pageNotes: string | null;
  // Class arms the school actually has, echoed so the review grid can offer
  // them as a dropdown rather than making the admin retype a name the
  // resolver will then reject for not matching.
  knownClassArms: string[];
}
