// Phase 1 / Slice 2 — ClassLevel DTO shape returned by the API.
//
// Dates serialize over JSON as strings; the DTO accepts both `Date` and
// `string` for the same reason as AcademicYearDto — test code constructs
// with native Dates, live fetches receive ISO strings.

export type ClassStageDto = "NURSERY" | "KG" | "PRIMARY" | "JSS" | "SSS";

/** Every stage in school order, with the words schools use (2026-11-02: KG is its own stage). */
export const CLASS_STAGES: { value: ClassStageDto; label: string }[] = [
  { value: "NURSERY", label: "Nursery" },
  { value: "KG", label: "KG" },
  { value: "PRIMARY", label: "Primary" },
  { value: "JSS", label: "Junior Secondary (JSS)" },
  { value: "SSS", label: "Senior Secondary (SSS)" },
];

export const CLASS_STAGE_VALUES = ["NURSERY", "KG", "PRIMARY", "JSS", "SSS"] as const;

export interface ClassLevelDto {
  id: string;
  name: string;
  code: string;
  stage: ClassStageDto;
  orderIndex: number;
  isActive: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}
