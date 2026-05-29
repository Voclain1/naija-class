import { z } from "zod";

import {
  GUARDIAN_IMPORT_REQUIRED_FIELDS,
  GUARDIAN_IMPORT_TARGET_FIELDS,
  type GuardianImportTargetField,
} from "../guardians/import.js";
import {
  STUDENT_IMPORT_REQUIRED_FIELDS,
  STUDENT_IMPORT_TARGET_FIELDS,
  type StudentImportTargetField,
} from "../students/import.js";
import { importOptionsSchema } from "./options.js";

// applyMappingSchema — body of POST /imports/:jobId/mapping. One schema
// per import type because the target-field enum differs; the surrounding
// shape (columnMapping + options) is otherwise identical. The service
// loads the job, branches on `type`, picks the right schema.
//
// `columnMapping` keys are CSV headers as-detected; values are either a
// known target-field name OR `null` for "don't import this column". The
// schema enforces both ends of the contract:
//
//   - every target value must be a known target field OR null (typed at
//     the API boundary so an admin can't smuggle "schoolId" via the
//     mapping JSON)
//   - all REQUIRED fields must be covered exactly once (no field-name
//     appears twice across the values; every required one appears at
//     least once). This is what guarantees the validate worker can run.
//
// `options` carry the dateFormat + treatBlankAs choices from the mapping
// UI; the schema reuses importOptionsSchema and falls back to its
// defaults (YYYY-MM-DD / skip) if the body omits them.
//
// Slice 8 note: tried factoring the two schemas through a generic
// buildMappingSchema(targetFields, requiredFields, resourceLabel)
// function — turns out Zod's z.record/z.enum chain interacts badly with
// generic readonly-array parameters at parse-time (the schema is
// constructable but safeParse crashes with "Cannot read properties of
// undefined (reading 'map')" before superRefine runs). Inlining both
// schemas costs ~30 lines of duplication and avoids the issue.

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
    options: importOptionsSchema.optional(),
  })
  .strict();

export type ApplyStudentImportMappingInput = z.infer<
  typeof applyStudentImportMappingSchema
>;

export const applyGuardianImportMappingSchema = z
  .object({
    columnMapping: z
      .record(
        z.string().min(1),
        z.enum(GUARDIAN_IMPORT_TARGET_FIELDS).nullable(),
      )
      .superRefine((mapping, ctx) => {
        const usedFields = new Map<GuardianImportTargetField, number>();
        for (const value of Object.values(mapping)) {
          if (value === null) continue;
          usedFields.set(value, (usedFields.get(value) ?? 0) + 1);
        }

        const missing = GUARDIAN_IMPORT_REQUIRED_FIELDS.filter(
          (f) => !usedFields.has(f),
        );
        if (missing.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["columnMapping"],
            message: `Required guardian fields not mapped: ${missing.join(", ")}.`,
            params: { missing },
          });
        }

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
    options: importOptionsSchema.optional(),
  })
  .strict();

export type ApplyGuardianImportMappingInput = z.infer<
  typeof applyGuardianImportMappingSchema
>;
