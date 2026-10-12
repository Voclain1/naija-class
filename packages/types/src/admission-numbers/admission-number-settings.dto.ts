import { z } from "zod";

import { ADMISSION_FORMAT_MAX_LENGTH, ADMISSION_NUMBER_ORDERS, parseAdmissionFormat } from "./admission-number-format.js";

// GET / PATCH /schools/me/admission-numbers (docs/modules/admission-numbers.md).

export const ADMISSION_NUMBER_MODES = ["MANUAL", "AUTO"] as const;
export type AdmissionNumberMode = (typeof ADMISSION_NUMBER_MODES)[number];

export const updateAdmissionNumberSettingsSchema = z
  .object({
    mode: z.enum(ADMISSION_NUMBER_MODES),
    format: z.string().trim().max(ADMISSION_FORMAT_MAX_LENGTH).optional(),
    order: z.enum(ADMISSION_NUMBER_ORDERS).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode !== "AUTO") return;
    if (!value.format) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["format"], message: "Write the format, for example VFM/{YYYY}/{NNNN}." });
      return;
    }
    const parsed = parseAdmissionFormat(value.format, value.order ?? "SCHOOL");
    if (!parsed.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["format"], message: parsed.error });
  });

export type UpdateAdmissionNumberSettingsInput = z.infer<typeof updateAdmissionNumberSettingsSchema>;

export interface AdmissionNumberSettingsDto {
  mode: AdmissionNumberMode;
  format: string | null;
  order: (typeof ADMISSION_NUMBER_ORDERS)[number];
  /** The first-time question was answered (either way). */
  decided: boolean;
  /** Students on the school's books, of any status. */
  studentCount: number;
  /**
   * What the next number would be for a student admitted today (not reserved).
   * Null when typing numbers, or when numbering per class (it depends on the class).
   */
  nextNumber: string | null;
}
