import { ForbiddenError } from "@school-kit/types";

import { PrismaClient } from "../generated/client/index.js";

// Guardian-to-student authorization (Decision B, docs/modules/phase-4.md §3/
// §4). Layered on top of withTenant, not a replacement for it: withTenant
// handles cross-school isolation via RLS; withGuardian handles cross-family
// isolation *within* a school, which RLS was never designed to do (RLS only
// knows school_id, not which guardian is allowed to see which student).
//
// Every portal endpoint returning student/invoice/payment data must call
// this before touching the row, nested inside an already-tenant-scoped
// withTenant callback:
//
//   withTenant(schoolId, (tx) =>
//     withGuardian(guardianId, studentId, tx, (tx2) =>
//       tx2.invoice.findMany({ where: { studentId } }),
//     ),
//   )
//
// schoolId is deliberately NOT a parameter here — the caller is already
// inside a withTenant(schoolId) transaction by the time withGuardian runs,
// so RLS already scopes the studentGuardian read to the right school; no
// need to duplicate the check.
export async function withGuardian<T>(
  guardianId: string,
  studentId: string,
  db: PrismaClient,
  callback: (db: PrismaClient) => Promise<T>,
): Promise<T> {
  const link = await db.studentGuardian.findFirst({
    where: { guardianId, studentId },
  });
  if (!link) {
    throw new ForbiddenError("Guardian is not linked to this student");
  }
  return callback(db);
}
