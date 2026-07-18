import { Injectable } from "@nestjs/common";

import { Prisma, withGuardian, withTenant } from "@school-kit/db";
import {
  NotFoundError,
  type CurrentEnrollmentRefDto,
  type PortalStudentDto,
  type PortalStudentListResponse,
} from "@school-kit/types";

import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context";
import {
  loadCurrentEnrollmentForStudent,
  loadCurrentEnrollmentsForStudents,
} from "../enrollments/enrollments.service";

const STUDENT_SELECT = {
  id: true,
  admissionNumber: true,
  firstName: true,
  middleName: true,
  lastName: true,
  dateOfBirth: true,
  gender: true,
  photoUrl: true,
  status: true,
} satisfies Prisma.StudentSelect;

type StudentRow = Prisma.StudentGetPayload<{ select: typeof STUDENT_SELECT }>;

function toPortalStudentDto(
  student: StudentRow,
  link: { isPrimary: boolean; canPickup: boolean },
  currentEnrollment: CurrentEnrollmentRefDto | null,
): PortalStudentDto {
  return {
    id: student.id,
    admissionNumber: student.admissionNumber,
    firstName: student.firstName,
    middleName: student.middleName,
    lastName: student.lastName,
    dateOfBirth: student.dateOfBirth,
    gender: student.gender,
    photoUrl: student.photoUrl,
    status: student.status,
    isPrimary: link.isPrimary,
    canPickup: link.canPickup,
    currentEnrollment: currentEnrollment ?? null,
  };
}

@Injectable()
export class PortalStudentsService {
  // GET /portal/students — the guardian's own linked children.
  //
  // Deliberately does NOT call withGuardian(). The `where: { guardianId }`
  // filter on studentGuardian IS the authorization check here — there is
  // no path through this query that could return a row belonging to a
  // student this guardian isn't linked to, so a second explicit check
  // would be redundant, not defense-in-depth. Contrast with findById
  // below, which takes a caller-supplied studentId and therefore DOES
  // need withGuardian() to verify the specific id requested.
  async list(guardianCtx: GuardianAuthContext): Promise<PortalStudentListResponse> {
    return withTenant(guardianCtx.schoolId, async (db) => {
      const links = await db.studentGuardian.findMany({
        where: { guardianId: guardianCtx.guardianId },
        select: {
          isPrimary: true,
          canPickup: true,
          student: { select: STUDENT_SELECT },
        },
      });

      const studentIds = links.map((l) => l.student.id);
      const enrollments = await loadCurrentEnrollmentsForStudents(db, studentIds);

      return {
        data: links.map((link) =>
          toPortalStudentDto(
            link.student,
            link,
            enrollments.get(link.student.id) ?? null,
          ),
        ),
      };
    });
  }

  // GET /portal/students/:id — one child, through withGuardian(). This is
  // the literal proof of Decision B (docs/modules/phase-4.md §3/§4): a
  // guardian A cannot fetch guardian B's child's detail even within the
  // SAME school, where RLS alone would happily return the row (both
  // students share school_id). withTenant handles cross-school isolation;
  // withGuardian handles cross-family isolation within the school — the
  // two are composed, not substitutes for each other.
  async findById(guardianCtx: GuardianAuthContext, studentId: string): Promise<PortalStudentDto> {
    return withTenant(guardianCtx.schoolId, (db) =>
      withGuardian(guardianCtx.guardianId, studentId, db, async (db2) => {
        // withGuardian already proved the link exists (that's its whole
        // job); this is a second query for the actual response data, one
        // round trip covering both the link flags and the student row —
        // same select shape as list() above, for consistency.
        const link = await db2.studentGuardian.findFirst({
          where: { guardianId: guardianCtx.guardianId, studentId },
          select: { isPrimary: true, canPickup: true, student: { select: STUDENT_SELECT } },
        });
        // Unreachable in practice — withGuardian just proved this link
        // exists inside the same transaction — but checked anyway rather
        // than asserting non-null with `!`, since a null-check costs
        // nothing and this is the one place in the file that would
        // otherwise trust an invariant instead of verifying it.
        if (!link) {
          throw new NotFoundError("Student not found.");
        }
        const currentEnrollment = await loadCurrentEnrollmentForStudent(db2, studentId);
        return toPortalStudentDto(link.student, link, currentEnrollment);
      }),
    );
  }
}
