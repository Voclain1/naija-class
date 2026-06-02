// Grading-configuration DTO shapes returned by the API.
//
// Dates serialize over JSON as strings; the DTO types accept both Date and
// string so test code can construct them with native Dates while live-fetch
// responses arrive as ISO strings (same convention as AcademicYearDto).

export interface GradingComponentDto {
  id: string;
  schemeId: string;
  key: string;
  label: string;
  weight: number; // integer percent
  orderIndex: number;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface GradingSchemeDto {
  id: string;
  name: string;
  isActive: boolean;
  components: GradingComponentDto[]; // ordered by orderIndex
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface GradeBoundaryDto {
  id: string;
  letter: string;
  minScore: number; // inclusive
  maxScore: number; // inclusive
  remark: string | null;
  orderIndex: number;
  createdAt: string | Date;
  updatedAt: string | Date;
}
