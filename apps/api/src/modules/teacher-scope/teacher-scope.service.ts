import { Injectable } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import {
  NotFoundError,
  type TeacherRosterResponse,
  type TeacherRosterStudentDto,
  type TeacherScopeDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";
import { getTeacherScope } from "./teacher-scope.helper";

@Injectable()
export class TeacherScopeService {
  // ----------------------------------------------------------------------
  // getMyScope — the calling teacher's own scope object.
  //
  // Role re-fetch (Q3 spec-drift reconciliation): the spec example
  // `user.roles.includes('teacher')` cannot work — AuthContext is role-free
  // by design (it carries only sessionId/userId/schoolId). Roles are
  // re-fetched under withTenant via assertUserActiveAndHasOneOf, exactly the
  // established pattern. Gating on ["teacher"] means a pure owner/admin
  // (no teacher role) gets 403 here — admins use the admin CRUD endpoints,
  // not the teacher-scoped ones (Q3a).
  // ----------------------------------------------------------------------
  async getMyScope(authCtx: AuthContext): Promise<TeacherScopeDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const scope = await getTeacherScope(db, authCtx.userId);
      // Slice 3 cp1: the gradebook needs a termId but teachers can't call the
      // admin-gated term endpoints, so the current term rides on this context
      // read. RLS scopes the lookup to the school; null when none is set.
      const currentTerm = await db.term.findFirst({
        where: { isCurrent: true },
        select: { id: true, name: true, sequence: true },
      });
      return {
        classArms: scope.classArms,
        // Map → plain Record for the JSON wire form.
        subjectsByArm: Object.fromEntries(scope.subjectsByArm),
        currentTerm,
      };
    });
  }

  // ----------------------------------------------------------------------
  // getMyArmRoster — the roster for ONE arm, only if it is in scope.
  //
  // Out-of-scope (or another tenant's) arm → 404, NOT 403: the arm should
  // appear NOT TO EXIST to this teacher, matching cross-tenant RLS semantics
  // (a foreign arm is invisible, not forbidden). A 403 would leak that the
  // arm exists; a 404 reveals nothing.
  //
  // Returns a TRIMMED roster (no medical notes / address / contact / DOB) —
  // see TeacherRosterStudentDto. Students are those enrolled in the arm in
  // the CURRENT term (term.isCurrent=true), same filter the admin roster
  // (StudentsService.list classArmId) uses.
  // ----------------------------------------------------------------------
  async getMyArmRoster(
    authCtx: AuthContext,
    armId: string,
  ): Promise<TeacherRosterResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const scope = await getTeacherScope(db, authCtx.userId);
      if (!scope.classArms.some((a) => a.id === armId)) {
        // Deliberate 404 (see method header) — do not distinguish
        // "exists but not yours" from "does not exist".
        throw new NotFoundError("Class arm not found.");
      }

      const students = await db.student.findMany({
        where: {
          enrollments: {
            some: { classArmId: armId, term: { isCurrent: true } },
          },
        },
        select: ROSTER_STUDENT_SELECT,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      });

      return { data: students.map(toRosterStudentDto) };
    });
  }
}

// -------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------

// PII-minimised register fields only. Intentionally OMITS address, phone,
// email, bloodGroup, medicalNotes, religion, stateOfOrigin, dateOfBirth,
// notes — a teacher's class register does not need them.
const ROSTER_STUDENT_SELECT = {
  id: true,
  admissionNumber: true,
  firstName: true,
  middleName: true,
  lastName: true,
  gender: true,
  photoUrl: true,
  status: true,
} satisfies Prisma.StudentSelect;

type RosterStudentRow = Prisma.StudentGetPayload<{
  select: typeof ROSTER_STUDENT_SELECT;
}>;

function toRosterStudentDto(row: RosterStudentRow): TeacherRosterStudentDto {
  return {
    id: row.id,
    admissionNumber: row.admissionNumber,
    firstName: row.firstName,
    middleName: row.middleName,
    lastName: row.lastName,
    gender: row.gender,
    photoUrl: row.photoUrl,
    status: row.status,
  };
}
