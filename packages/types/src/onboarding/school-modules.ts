import { z } from "zod";

export const SCHOOL_MODULE_KEYS = [
  "students",
  "fees",
  "attendance",
  "results",
  "parent-communication",
  "homework",
  "cbt",
  "health",
  "transport",
  "hostel",
  "library",
  "store",
  "insights",
] as const;

export type SchoolModuleKey = (typeof SCHOOL_MODULE_KEYS)[number];

export const CORE_SCHOOL_MODULES: SchoolModuleKey[] = [
  "students",
  "fees",
  "attendance",
  "results",
  "parent-communication",
];

export const schoolModulePreferencesSchema = z.object({
  selected: z.array(z.enum(SCHOOL_MODULE_KEYS)).min(1, "Choose at least one area.").max(SCHOOL_MODULE_KEYS.length),
});

export type SchoolModulePreferences = z.infer<typeof schoolModulePreferencesSchema>;

/** Null is the compatibility state for schools created before preferences. */
export function readSchoolModulePreferences(value: unknown): SchoolModulePreferences | null {
  const parsed = schoolModulePreferencesSchema.safeParse(value);
  return parsed.success ? { selected: [...new Set(parsed.data.selected)] } : null;
}
