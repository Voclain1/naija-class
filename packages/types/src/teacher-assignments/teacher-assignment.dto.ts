// Phase 1 / Slice 11 — TeacherAssignment DTO + list response.
//
// Canonical response shape across single-fetch, create, update, and list
// endpoints. Records "teacher T teaches subject S in class arm A for year Y
// (optionally term-specific)". termId is nullable: null = whole year, set =
// term-specific.
//
// Dates serialise as ISO strings over JSON; accept both Date and string to
// mirror every other Phase 1 DTO.

export interface TeacherAssignmentDto {
  id: string;
  teacherId: string;
  classArmId: string;
  subjectId: string;
  academicYearId: string;
  termId: string | null;
  isActive: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// Cursor-paginated list response. Same shape as Phase 1's other list
// responses (enrollments, students, guardians).
export interface TeacherAssignmentListResponse {
  data: TeacherAssignmentDto[];
  meta: {
    cursor?: string;
  };
}
