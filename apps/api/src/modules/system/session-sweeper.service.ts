import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { basePrisma, withTenant } from "@school-kit/db";

// Deletes expired staff, guardian and student sessions (docs/deferred.md,
// "No expired-session sweeper"). Housekeeping only: every guard already
// refuses an expired row, so nothing here changes who is signed in. Without
// it the three tables grow by every sign-in, forever.
//
// School by school under withTenant, like FinanceService's overdue sweep,
// rather than one cross-tenant DELETE: the session tables are FORCE RLS
// (joined through users / guardians / students), and a SECURITY DEFINER
// function for housekeeping would be a privileged escape hatch with no
// security reason to exist. Every school, whatever its status: a suspended
// school's expired sessions are just as dead.
//
// A day's grace past expiry, so a row is never deleted while a request that
// read it a moment before expiry is still finishing.
const GRACE_MS = 24 * 60 * 60 * 1000;

export interface SweepResult {
  schools: number;
  staff: number;
  guardian: number;
  student: number;
}

@Injectable()
export class SessionSweeperService {
  private readonly logger = new Logger(SessionSweeperService.name);

  // Daily at 03:40 UTC (04:40 in Lagos), away from the other midnight jobs.
  // `schoolIds` scopes the sweep in tests; the cron passes nothing.
  @Cron("40 3 * * *")
  async sweepExpiredSessions(schoolIds?: string[], now: Date = new Date()): Promise<SweepResult> {
    const cutoff = new Date(now.getTime() - GRACE_MS);
    const result: SweepResult = { schools: 0, staff: 0, guardian: 0, student: 0 };

    let schools: Array<{ id: string }>;
    try {
      schools = await basePrisma.school.findMany({
        where: schoolIds?.length ? { id: { in: schoolIds } } : {},
        select: { id: true },
      });
    } catch (err) {
      this.logger.error(`Session sweep: failed to list schools: ${String(err)}`);
      return result;
    }

    for (const school of schools) {
      try {
        // One after another: they share withTenant's transaction.
        const [staff, guardian, student] = await withTenant(school.id, async (db) => [
          await db.session.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
          await db.guardianSession.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
          await db.studentSession.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
        ]);
        result.schools += 1;
        result.staff += staff.count;
        result.guardian += guardian.count;
        result.student += student.count;
      } catch (err) {
        this.logger.error(`Session sweep: school ${school.id} failed: ${String(err)}`);
      }
    }

    const removed = result.staff + result.guardian + result.student;
    if (removed > 0) {
      this.logger.log(
        `Session sweep: removed ${result.staff} staff, ${result.guardian} guardian and ${result.student} student session(s) across ${result.schools} school(s)`,
      );
    }
    return result;
  }
}
