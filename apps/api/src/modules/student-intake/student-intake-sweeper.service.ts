import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { basePrisma, withTenant } from "@school-kit/db";

import { expireStudentIntakeProposals } from "./student-intake.service";

// Clears the rows of expired intake proposals (docs/modules/student-intake-proposals.md):
// a proposal holds names and dates of birth only while it can still be
// confirmed. The service also does this whenever a school touches intake;
// this hourly pass covers schools that never come back. Each school under its
// own GUC (the pattern of StagedFilesSweeperService). Row metadata (counts,
// outcome ids, timestamps) is kept: no retention period for it is decided.
@Injectable()
export class StudentIntakeSweeperService {
  private readonly logger = new Logger(StudentIntakeSweeperService.name);

  @Cron("17 * * * *")
  async hourly(): Promise<void> {
    try {
      const n = await this.sweep(new Date());
      if (n > 0) this.logger.log(`Cleared the rows of ${n} expired student intake proposals.`);
    } catch {
      this.logger.error("Clearing expired student intake proposals failed; details omitted.");
    }
  }

  async sweep(now: Date): Promise<number> {
    const schools = await basePrisma.school.findMany({ select: { id: true } });
    let total = 0;
    for (const school of schools) {
      total += await withTenant(school.id, (db) => expireStudentIntakeProposals(db, school.id, now));
    }
    return total;
  }
}
