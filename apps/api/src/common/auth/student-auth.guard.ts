import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";

import { basePrisma } from "@school-kit/db";
import { UnauthorizedError } from "@school-kit/types";

import { hashStudentToken } from "./student-sessions";
import { mayHoldSession } from "./student-portal-status";
import type { StudentAuthContext } from "./student-auth-context";

// Bearer-token guard for the student portal — the third principal after staff
// (AuthGuard) and guardians (GuardianAuthGuard). Mirrors both; see
// auth.guard.ts for the full "why SECURITY DEFINER" / "why strict Bearer
// casing" rationale, which applies identically here.
//
// What we DO attach to req.student: { sessionId, studentId, schoolId }.
// What we DELIBERATELY DON'T: name, admission number, class. Handlers that
// need them re-fetch via withTenant. `students` is the most PII-dense row in
// the schema and none of it belongs on a request object that may be logged.
//
// TWO independent authority checks, and neither subsumes the other
// (phase-6.md D23 as amended by D25):
//
//   student_status — the SCHOOL's judgement about enrolment. Set by staff.
//   portal_enabled — the GUARDIAN's judgement about this child holding
//                    credentials. Set by a parent, and untouched by enrolment.
//
// A parent deactivating their child must not alter that child's enrolment,
// and a school withdrawing a student must not wait on a parent to act. Both
// are re-read from the database on EVERY request rather than trusted from
// session-creation time, which is what makes revocation immediate: a student
// withdrawn on Tuesday cannot still be reading the portal on Wednesday on a
// 30-day token.
//
// portal_enabled also makes guardian deactivation authoritative at the point
// of AUTHORITY rather than the point of CLEANUP. Deactivation deletes session
// rows; if that delete somehow did not take effect, a surviving session is
// still refused here.
const BEARER_PREFIX = "Bearer ";

// Which statuses may hold a session — and why that set is WIDER than the set
// permitted to activate in the first place — lives in one place, shared with
// StudentPortalService. See student-portal-status.ts.

interface ResolveStudentSessionRow {
  session_id: string;
  student_id: string;
  school_id: string;
  expires_at: Date;
  student_status: string;
  portal_enabled: boolean;
}

@Injectable()
export class StudentAuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { student?: StudentAuthContext }>();

    const header = req.header("authorization");
    if (!header || !header.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedError("MISSING_BEARER_TOKEN", "Authentication required.");
    }

    const rawToken = header.slice(BEARER_PREFIX.length).trim();
    if (rawToken.length === 0) {
      throw new UnauthorizedError("MISSING_BEARER_TOKEN", "Authentication required.");
    }

    // SECURITY DEFINER function — bypasses RLS for this lookup ONLY, because
    // the request carries a bearer token and nothing else: there is no
    // school_id to put in the GUC until after this resolves.
    const rows = await basePrisma.$queryRaw<ResolveStudentSessionRow[]>`
      SELECT * FROM auth_resolve_student_session(${hashStudentToken(rawToken)})
    `;
    const row = rows[0];
    if (!row) {
      throw new UnauthorizedError("INVALID_SESSION", "Session is invalid or has been revoked.");
    }

    if (row.expires_at.getTime() <= Date.now()) {
      // Read-only hot path, same as AuthGuard/GuardianAuthGuard — no delete.
      throw new UnauthorizedError("SESSION_EXPIRED", "Session has expired. Please sign in again.");
    }

    // Deliberately the SAME error code and message as an expired or unknown
    // session. A child whose parent switched their account off should not
    // learn that from an API error code; the guardian tells them. This also
    // keeps the guard from becoming an oracle for account state.
    if (!row.portal_enabled || !mayHoldSession(row.student_status)) {
      throw new UnauthorizedError("INVALID_SESSION", "Session is invalid or has been revoked.");
    }

    req.student = {
      sessionId: row.session_id,
      studentId: row.student_id,
      schoolId: row.school_id,
    };
    return true;
  }
}
