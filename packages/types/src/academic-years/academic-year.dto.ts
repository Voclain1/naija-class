import type { TimetableClashDto } from "../timetable/timetable.dto.js";

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
  /**
   * Phase 8 / CP4 (§18 D43) — set only on the response to CREATING a term:
   * timetable clashes the new term put into force (year-wide timetables of its
   * year come into force for it). Surfaced, never silent; an empty array means
   * none. Absent on every other term response.
   */
  timetableClashes?: TimetableClashDto[];
}
