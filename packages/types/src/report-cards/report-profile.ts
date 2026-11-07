import { z } from "zod";

export const AFFECTIVE_TRAITS = [
  "Punctuality",
  "Honesty",
  "Neatness",
  "Attentiveness",
  "Cooperation",
  "Self control",
] as const;
export const PSYCHOMOTOR_SKILLS = [
  "Handwriting",
  "Verbal fluency",
  "Drawing and creativity",
  "Games and sports",
  "Handling tools",
  "Musical skills",
] as const;
export const REPORT_RATING_KEY =
  "5 Excellent · 4 Good · 3 Satisfactory · 2 Developing · 1 Needs support";
const rating = z.number().int().min(1).max(5).nullable();
const ratings = (keys: readonly string[]) =>
  z.record(z.string(), rating).superRefine((values, ctx) => {
    for (const key of Object.keys(values))
      if (!keys.includes(key))
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Unknown rating.",
        });
  });
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Use a valid calendar date.");
const fieldKey = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
export const reportCustomFieldSchema = z
  .object({ key: fieldKey, label: z.string().trim().min(1).max(60) })
  .strict();
export const reportCardDesignSchema = z
  .object({
    template: z.enum(["standard", "classic", "compact"]).default("standard"),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#0E5C43"),
    font: z.enum(["sans", "serif"]).default("sans"),
    watermark: z.string().trim().max(60).default(""),
    customFields: z.array(reportCustomFieldSchema).max(8).default([]),
  })
  .strict()
  .refine(
    (d) =>
      new Set(d.customFields.map((f) => f.key)).size === d.customFields.length,
    "Field keys must be unique.",
  );
export type ReportCardDesign = z.infer<typeof reportCardDesignSchema>;
export const DEFAULT_REPORT_CARD_DESIGN: ReportCardDesign =
  reportCardDesignSchema.parse({});

export const reportProfileSchema = z
  .object({
    level: z.enum(["NURSERY", "PRIMARY", "SECONDARY"]).default("SECONDARY"),
    affective: ratings(AFFECTIVE_TRAITS).default({}),
    psychomotor: ratings(PSYCHOMOTOR_SKILLS).default({}),
    nextTermDate: calendarDate.nullable().default(null),
    teacherName: z.string().trim().max(120).default(""),
    headName: z.string().trim().max(120).default(""),
    // Labels are canonicalised from the school's paid design at the write boundary.
    customFields: z
      .array(
        reportCustomFieldSchema.extend({ value: z.string().trim().max(300) }),
      )
      .max(8)
      .default([]),
  })
  .strict()
  .refine(
    (d) =>
      new Set(d.customFields.map((f) => f.key)).size === d.customFields.length,
    "Field keys must be unique.",
  );
export type ReportProfile = z.infer<typeof reportProfileSchema>;
export function readReportProfile(value: unknown): ReportProfile {
  const parsed = reportProfileSchema.safeParse(value);
  return parsed.success ? parsed.data : reportProfileSchema.parse({});
}
export function readReportCardDesign(value: unknown): ReportCardDesign {
  const parsed = reportCardDesignSchema.safeParse(value);
  return parsed.success ? parsed.data : reportCardDesignSchema.parse({});
}
