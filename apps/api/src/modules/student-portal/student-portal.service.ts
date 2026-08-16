import { Injectable } from "@nestjs/common";

import { Prisma, basePrisma, withTenant } from "@school-kit/db";
import {
  GoneError,
  NotFoundError,
  UnauthorizedError,
  type AcceptStudentInvitationInput,
  type AcceptStudentInvitationResponse,
  type PublicStudentInvitationDto,
  type StudentLoginInput,
  type StudentLoginResponse,
  type StudentMeResponse,
  type StudentPortalStudentDto,
} from "@school-kit/types";

import * as password from "../../common/auth/password";
import { createStudentSession, hashStudentToken } from "../../common/auth/student-sessions";
import type { StudentAuthContext } from "../../common/auth/student-auth-context";
import { loadCurrentEnrollmentForStudent } from "../enrollments/enrollments.service";

const LOGIN_AUDIT_ACTION = "student.login";
const LOGIN_FAILED_AUDIT_ACTION = "student.login-failed";
const ACCEPT_AUDIT_ACTION = "student.invitation-accept";
const LOGOUT_AUDIT_ACTION = "student.logout";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

interface LookupStudentForLoginRow {
  student_id: string;
  school_id: string;
  password_hash: string | null;
  student_status: string;
  activated_at: Date | null;
}

interface ResolveStudentInvitationRow {
  invitation_id: string;
  school_id: string;
  student_id: string;
  expires_at: Date;
}

const PORTAL_ALLOWED_STATUS = "ACTIVE";

// Fixed argon2id hash for the timing-attack defence when no candidate exists,
// same pattern and rationale as AuthService.dummyVerifyHash and
// PortalAuthService's own copy. Kept as a SEPARATE cache from both so the
// three auth surfaces have no coupling through a shared module.
let dummyVerifyHash: string | null = null;
async function getDummyVerifyHash(): Promise<string> {
  if (!dummyVerifyHash) {
    dummyVerifyHash = await password.hashPassword("dummy-student-login-target");
  }
  return dummyVerifyHash;
}

const STUDENT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  admissionNumber: true,
} satisfies Prisma.StudentSelect;

type StudentRow = Prisma.StudentGetPayload<{ select: typeof STUDENT_SELECT }>;

function toStudentDto(
  row: StudentRow,
  currentEnrollment: StudentPortalStudentDto["currentEnrollment"],
): StudentPortalStudentDto {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    admissionNumber: row.admissionNumber,
    currentEnrollment,
  };
}

@Injectable()
export class StudentPortalService {
  // POST /student-portal/login — PUBLIC.
  //
  // EVERY failure path below returns the SAME UnauthorizedError with the SAME
  // code and message: unknown school slug, unknown admission number, never
  // activated, deactivated by a guardian, wrong password, non-ACTIVE status.
  //
  // That uniformity is the single most important property of this method.
  // A student's login identity is enumerable BY CONSTRUCTION (phase-6.md
  // §14.2): admission numbers are sequential and formatted, and school slugs
  // are public because they are subdomains. Any message that distinguishes
  // "no such student" from "wrong password" turns this endpoint into a roster
  // oracle for an attacker with a script.
  //
  // The dummy verify keeps the zero-candidate path's timing comparable to the
  // wrong-password path, so timing does not leak what the message refuses to.
  async login(input: StudentLoginInput, ctx: RequestContext): Promise<StudentLoginResponse> {
    const rows = await basePrisma.$queryRaw<LookupStudentForLoginRow[]>`
      SELECT * FROM auth_lookup_student_for_login(${input.schoolSlug}, ${input.admissionNumber})
    `;

    // Single-row by construction (D20): schools.slug is globally unique and
    // students carries UNIQUE(school_id, admission_number). This surface
    // deliberately does NOT inherit the guardian login's multi-candidate
    // verify loop, which exists only because Guardian.email is per-school
    // unique and is documented as interim in its own migration header.
    const row = rows[0];

    if (!row || !row.password_hash) {
      // No student, or a student with no usable credential (never activated,
      // or deactivated by a guardian). Burn comparable time, then fail
      // identically to a wrong password.
      const dummy = await getDummyVerifyHash();
      await password.verifyPassword(dummy, input.password).catch(() => false);
      // Pass the resolved tenant when we HAVE one. Without this the
      // deactivated / never-activated case — a real student being probed —
      // wrote no audit row at all, which is precisely the case a school
      // most needs to see. Found by reading the audit table after the
      // end-to-end walkthrough rather than by any assertion.
      await this.recordFailedLogin(
        input,
        ctx,
        row ? "NO_CREDENTIAL" : "NO_STUDENT",
        row?.school_id,
        row?.student_id,
      );
      throw new UnauthorizedError("INVALID_CREDENTIALS", "Invalid sign-in details.");
    }

    const ok = await password.verifyPassword(row.password_hash, input.password).catch(() => false);
    if (!ok) {
      await this.recordFailedLogin(input, ctx, "BAD_PASSWORD", row.school_id, row.student_id);
      throw new UnauthorizedError("INVALID_CREDENTIALS", "Invalid sign-in details.");
    }

    // Status is checked AFTER the password, deliberately. Checking it first
    // would let an attacker who guessed an admission number distinguish
    // "enrolled" from "withdrawn" without knowing any password, by timing.
    if (row.student_status !== PORTAL_ALLOWED_STATUS) {
      await this.recordFailedLogin(input, ctx, "NOT_ACTIVE", row.school_id, row.student_id);
      throw new UnauthorizedError("INVALID_CREDENTIALS", "Invalid sign-in details.");
    }

    const { rawToken } = await createStudentSession(row.school_id, row.student_id, ctx);

    const student = await withTenant(row.school_id, async (db) => {
      const updated = await db.student.update({
        where: { id: row.student_id },
        data: { lastLoginAt: new Date() },
        select: STUDENT_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: row.school_id,
          // "Who performed this action" — the column has no FK constraint, so
          // a student id here is safe and correct, matching how guardian.login
          // records a guardian id.
          userId: row.student_id,
          action: LOGIN_AUDIT_ACTION,
          entityType: "student",
          entityId: row.student_id,
          ipAddress: ctx.ipAddress,
          metadata: { admissionNumber: input.admissionNumber, userAgent: ctx.userAgent },
        },
      });

      return { updated, enrollment: await loadCurrentEnrollmentForStudent(db, row.student_id) };
    });

    const school = await basePrisma.school.findUniqueOrThrow({
      where: { id: row.school_id },
      select: { id: true, name: true, slug: true },
    });

    return {
      student: toStudentDto(student.updated, student.enrollment),
      school,
      token: rawToken,
    };
  }

  // Failed logins are audited — a deliberate addition beyond what staff and
  // guardian login record. §14.2's enumeration risk is only DETECTABLE if
  // failures are written down; without this a school has no way to see a
  // script walking their admission numbers.
  //
  // Best-effort: an audit failure must never convert a clean 401 into a 500,
  // which would itself be a signal.
  private async recordFailedLogin(
    input: StudentLoginInput,
    ctx: RequestContext,
    reason: string,
    schoolId?: string,
    studentId?: string,
  ): Promise<void> {
    // No tenant resolved means no school to scope an audit row to — audit_logs
    // is tenant-scoped and RLS has nothing to key on. This is a real, accepted
    // blind spot: probing a NON-EXISTENT school slug leaves no trace. Probing a
    // real school's roster — the attack that actually matters, since that is
    // where the sequential admission numbers are — is fully recorded.
    if (!schoolId) return;
    try {
      await withTenant(schoolId, (db) =>
        db.auditLog.create({
          data: {
            schoolId,
            userId: null,
            action: LOGIN_FAILED_AUDIT_ACTION,
            entityType: "student",
            entityId: studentId ?? null,
            ipAddress: ctx.ipAddress,
            metadata: {
              schoolSlug: input.schoolSlug,
              admissionNumber: input.admissionNumber,
              reason,
              userAgent: ctx.userAgent,
            },
          },
        }),
      );
    } catch {
      // Swallowed on purpose — see above.
    }
  }

  async me(ctx: StudentAuthContext): Promise<StudentMeResponse> {
    const student = await withTenant(ctx.schoolId, async (db) => ({
      row: await db.student.findUniqueOrThrow({
        where: { id: ctx.studentId },
        select: STUDENT_SELECT,
      }),
      enrollment: await loadCurrentEnrollmentForStudent(db, ctx.studentId),
    }));
    const school = await basePrisma.school.findUniqueOrThrow({
      where: { id: ctx.schoolId },
      select: { id: true, name: true, slug: true },
    });
    return { student: toStudentDto(student.row, student.enrollment), school };
  }

  async logout(ctx: StudentAuthContext): Promise<void> {
    await withTenant(ctx.schoolId, async (db) => {
      await db.studentSession.deleteMany({ where: { id: ctx.sessionId } });
      await db.auditLog.create({
        data: {
          schoolId: ctx.schoolId,
          userId: ctx.studentId,
          action: LOGOUT_AUDIT_ACTION,
          entityType: "student",
          entityId: ctx.studentId,
          metadata: {},
        },
      });
    });
  }

  // GET /student-portal/invitations/:token — PUBLIC.
  //
  // Returns the school name and expiry ONLY. No student name: this endpoint
  // takes an attacker-supplied token, and a name would turn a leaked or
  // brute-forced token into a disclosure of which child it belongs to.
  async getInvitation(rawToken: string): Promise<PublicStudentInvitationDto> {
    const row = await this.resolveLiveInvitation(rawToken);
    const school = await basePrisma.school.findUniqueOrThrow({
      where: { id: row.school_id },
      select: { name: true },
    });
    return { schoolName: school.name, expiresAt: row.expires_at };
  }

  // POST /student-portal/invitations/:token/accept — PUBLIC.
  //
  // The child sets their own password. This is where D24's policy is enforced
  // (by the DTO schema), because this is where the password is CHOSEN.
  //
  // Accepting CONSUMES the token: accepted_at is stamped inside the same
  // transaction as the password write, so the SECURITY DEFINER resolver can
  // never return it again. That is what makes a forwarded screenshot of an
  // already-used link worth nothing.
  async acceptInvitation(
    rawToken: string,
    input: AcceptStudentInvitationInput,
    ctx: RequestContext,
  ): Promise<AcceptStudentInvitationResponse> {
    const row = await this.resolveLiveInvitation(rawToken);

    const passwordHash = await password.hashPassword(input.password);

    const student = await withTenant(row.school_id, async (db) => {
      // Re-read the invitation INSIDE the transaction and re-assert liveness.
      // The SECURITY DEFINER resolve above happened outside any transaction,
      // so without this two concurrent accepts of the same token could both
      // pass the check. updateMany with the liveness predicate in its WHERE
      // makes consumption atomic: exactly one caller can flip accepted_at.
      const consumed = await db.studentPortalInvitation.updateMany({
        where: { id: row.invitation_id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new GoneError("INVITATION_ALREADY_USED", "This link has already been used.");
      }

      const target = await db.student.findUnique({
        where: { id: row.student_id },
        select: { status: true },
      });
      if (!target) {
        throw new NotFoundError("Student not found.");
      }
      if (target.status !== PORTAL_ALLOWED_STATUS) {
        // A student withdrawn between invitation and acceptance must not be
        // able to complete setup.
        throw new GoneError("INVITATION_NOT_AVAILABLE", "This link is no longer available.");
      }

      // activated_at is stamped on FIRST activation only — it is history, not
      // current state (D25), so a re-activation after deactivation must leave
      // the original timestamp intact. Prisma cannot express "set only if
      // null" in a single update, so it is a second, narrowly-scoped write
      // guarded by `activatedAt: null` in its WHERE. Both run in the same
      // transaction, so the pair is atomic.
      await db.student.updateMany({
        where: { id: row.student_id, activatedAt: null },
        data: { activatedAt: new Date() },
      });

      const updated = await db.student.update({
        where: { id: row.student_id },
        data: { passwordHash },
        select: STUDENT_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: row.school_id,
          userId: row.student_id,
          action: ACCEPT_AUDIT_ACTION,
          entityType: "student",
          entityId: row.student_id,
          ipAddress: ctx.ipAddress,
          metadata: { invitationId: row.invitation_id, userAgent: ctx.userAgent },
        },
      });

      return { updated, enrollment: await loadCurrentEnrollmentForStudent(db, row.student_id) };
    });

    const { rawToken: sessionToken } = await createStudentSession(
      row.school_id,
      row.student_id,
      ctx,
    );
    const school = await basePrisma.school.findUniqueOrThrow({
      where: { id: row.school_id },
      select: { id: true, name: true, slug: true },
    });

    return {
      student: toStudentDto(student.updated, student.enrollment),
      school,
      token: sessionToken,
    };
  }

  // Resolves a raw invitation token to a LIVE invitation, or throws.
  //
  // Liveness (not accepted, not revoked) is enforced inside the SECURITY
  // DEFINER function's WHERE clause, not here — see the migration header for
  // why that predicate lives in SQL. This method only adds the expiry
  // comparison, which the function deliberately leaves to its caller so
  // EXPIRED and INVALID can carry different copy.
  private async resolveLiveInvitation(rawToken: string): Promise<ResolveStudentInvitationRow> {
    const rows = await basePrisma.$queryRaw<ResolveStudentInvitationRow[]>`
      SELECT * FROM auth_resolve_student_invitation(${hashStudentToken(rawToken)})
    `;
    const row = rows[0];
    if (!row) {
      throw new NotFoundError("This link is not valid.");
    }
    if (row.expires_at.getTime() <= Date.now()) {
      throw new GoneError("INVITATION_EXPIRED", "This link has expired. Ask for a new one.");
    }
    return row;
  }
}
