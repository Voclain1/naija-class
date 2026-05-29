import { z } from "zod";

// Shared options schema for CSV imports — used by both student and
// guardian imports in Phase 1 (and teacher imports in slice 10). Lives
// here rather than under one resource's folder because the options are
// identical across all import types: a date format (only consumed by
// schemas that have a date column) and a blank-handling policy. The
// guardian import doesn't have a date column today, but the field stays
// on every import's options because:
//   - The mapping wizard renders the date-format radio identically for
//     every import type; only required-field-checks differ.
//   - The validate engine's options-handling code is shared (cp1 slice 8
//     extracted parseSourceCsv). Different options shapes per type would
//     fork that code.
//   - Slice 10's teacher import will reintroduce a date column
//     (joinedAt), so removing dateFormat from the guardian options for
//     one slice and adding it back for the next is churn for no gain.

export const IMPORT_DATE_FORMATS = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"] as const;
export type ImportDateFormat = (typeof IMPORT_DATE_FORMATS)[number];

export const IMPORT_BLANK_HANDLING = ["skip", "error"] as const;
export type ImportBlankHandling = (typeof IMPORT_BLANK_HANDLING)[number];

export const importOptionsSchema = z
  .object({
    dateFormat: z.enum(IMPORT_DATE_FORMATS).default("YYYY-MM-DD"),
    treatBlankAs: z.enum(IMPORT_BLANK_HANDLING).default("skip"),
  })
  .strict();
export type ImportOptions = z.infer<typeof importOptionsSchema>;
