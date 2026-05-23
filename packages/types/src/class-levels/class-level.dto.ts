// Phase 1 / Slice 2 — ClassLevel DTO shape returned by the API.
//
// Dates serialize over JSON as strings; the DTO accepts both `Date` and
// `string` for the same reason as AcademicYearDto — test code constructs
// with native Dates, live fetches receive ISO strings.

export type ClassStageDto = "NURSERY" | "PRIMARY" | "JSS" | "SSS";

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
