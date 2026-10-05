import { basePrisma } from "@school-kit/db";
import { UnauthorizedError } from "@school-kit/types";

// Platform-admin suspension (docs/modules/platform-admin.md slice 2). A
// suspended school refuses every sign-in — staff, parents, students — and its
// live sessions end at their next request (the three session guards read
// `school_suspended` from their resolvers; the staff guard's 30-second session
// cache bounds how long that takes). Payment links are public pages, not
// sessions, so fees can still be paid.
//
// One error for every principal, so a person sees the same words wherever
// they sign in. It is only ever raised AFTER a credential has been verified
// (session creation, or a resolved session), so it never tells a stranger
// which schools are suspended.
export const SCHOOL_SUSPENDED_CODE = "SCHOOL_SUSPENDED";

export function schoolSuspendedError(): UnauthorizedError {
  return new UnauthorizedError(
    SCHOOL_SUSPENDED_CODE,
    "This school's School Kit account is suspended. Please contact the school.",
  );
}

// Called by createSession / createGuardianSession / createStudentSession — the
// single point every sign-in path (password, staff mobile, web handoff,
// invitation accept, password reset) passes through. `schools` has no RLS, so
// this is a plain primary-key read.
export async function assertSchoolNotSuspended(schoolId: string): Promise<void> {
  const school = await basePrisma.school.findUnique({
    where: { id: schoolId },
    select: { suspendedAt: true },
  });
  if (school?.suspendedAt) throw schoolSuspendedError();
}
