// Phase 1 / Slice 10 — TeacherProfile DTO.
//
// The canonical response shape across single-fetch, list, create, and
// update endpoints. Embeds a trimmed `user` block so the staff roster can
// render name + email + active-state without a second round-trip (same
// denormalised-embed pattern as CurrentEnrollmentRefDto on Student).
//
// `joinedAt` is the row-creation moment (pinned spec shape — NOT an
// admin-entered hire date; that's Phase 3 payroll). Dates serialise as ISO
// strings over JSON; accept both Date and string to mirror every other
// Phase 1 DTO.

export interface TeacherProfileUserRef {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  isActive: boolean;
}

export interface TeacherProfileDto {
  id: string;
  userId: string;
  staffNumber: string;
  qualifications: string | null;
  specialty: string | null;
  nutNumber: string | null;
  joinedAt: string | Date;
  createdAt: string | Date;
  updatedAt: string | Date;
  user: TeacherProfileUserRef;
}

// Cursor-paginated list response. Same shape as Phase 1's other list
// responses (students, enrollments).
export interface TeacherProfileListResponse {
  data: TeacherProfileDto[];
  meta: {
    cursor?: string;
  };
}
