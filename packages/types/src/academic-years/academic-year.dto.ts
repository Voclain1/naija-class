// AcademicYear + Term DTO shapes returned by the API.
//
// Dates are serialized over JSON as strings. The DTO types accept both
// `Date` and `string` so test code can construct them with native Dates
// while live-fetch responses arrive as ISO strings.

export interface AcademicYearDto {
  id: string;
  label: string;
  startDate: string | Date;
  endDate: string | Date;
  isCurrent: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface TermDto {
  id: string;
  academicYearId: string;
  sequence: number;
  name: string;
  startDate: string | Date;
  endDate: string | Date;
  isCurrent: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}
