// Phase 1 / Slice 3 — Subject DTO shape returned by the API.
//
// Dates serialize as strings over JSON; the DTO accepts both `Date` and
// `string` for the same reason ClassLevelDto does — test code constructs
// with native Dates, live fetches receive ISO strings.

export type SubjectCategoryDto = "CORE" | "ELECTIVE" | "VOCATIONAL";

export interface SubjectDto {
  id: string;
  name: string;
  code: string;
  category: SubjectCategoryDto;
  isActive: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}
