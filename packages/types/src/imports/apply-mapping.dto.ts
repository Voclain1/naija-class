import { z } from "zod";

import {
  STUDENT_IMPORT_REQUIRED_FIELDS,
  STUDENT_IMPORT_TARGET_FIELDS,
  studentImportOptionsSchema,
  type StudentImportTargetField,
} from "../students/import.js";

// applyMappingSchema — body of POST /imports/:jobId/mapping for STUDENTS jobs.
//
// `columnMapping` keys are CSV headers as-detected; values are either the
// target Student field name OR `null` for "don't import this column". The
// schema enforces both ends of the contract:
//
//   - every target value must be a known StudentImportTargetField OR null
//     (typed at the API boundary so an admin can't smuggle "schoolId" via
//     the mapping JSON)
//   - all REQUIRED Student import fields must be covered exactly once
//     (no field-name appears twice across the values; every required one
//     appears at least once). This is what guarantees the validate worker
//     can run.
//
// `options` carry the dateFormat + treatBlankAs choices from the mapping
// UI; the schema reuses studentImportOptionsSchema and falls back to its
// defaults (YYYY-MM-DD / skip) if the body omits them.

export const applyStudentImportMappingSchema = z
  .object({
    columnMapping: z
      .record(
        z.string().min(1),
        z.enum(STUDENT_IMPORT_TARGET_FIELDS).nullable(),
      )
      .superRefine((mapping, ctx) => {
        const usedFields = new Map<StudentImportTargetField, number>();
        for (const value of Object.values(mapping)) {
          if (value === null) continue;
          usedFields.set(value, (usedFields.get(value) ?? 0) + 1);
        }

        // Required fields must be present. Surface the precise list of
        // missing fields so the UI can light up exactly which dropdowns
        // are unselected without parsing the message.
        const missing = STUDENT_IMPORT_REQUIRED_FIELDS.filter(
          (f) => !usedFields.has(f),
        );
        if (missing.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["columnMapping"],
            message: `Required student fields not mapped: ${missing.join(", ")}.`,
            params: { missing },
          });
        }

        // A target field mapped twice (two CSV headers → same field) is
        // ambiguous — refuse. The wizard prevents this client-side but
        // server-side enforcement keeps the rule load-bearing.
        const duplicated = [...usedFields.entries()]
          .filter(([, count]) => count > 1)
          .map(([f]) => f);
        if (duplicated.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["columnMapping"],
            message: `Duplicate mapping for: ${duplicated.join(", ")}.`,
            params: { duplicated },
          });
        }
      }),
    options: studentImportOptionsSchema.optional(),
  })
  .strict();

export type ApplyStudentImportMappingInput = z.infer<
  typeof applyStudentImportMappingSchema
>;
