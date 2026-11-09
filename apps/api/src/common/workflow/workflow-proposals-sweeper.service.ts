import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { basePrisma, withTenant } from "@school-kit/db";

import { expireWorkflowProposals } from "./workflow-proposals";

// Clears the rows of expired workflow proposals, every kind
// (docs/modules/student-intake-proposals.md, reminder-campaigns.md): a
// proposal holds names, dates of birth or balances only while it can still be
// confirmed. Each workflow also does this whenever a school touches it; this
// hourly pass covers schools that never come back. Each school under its own
// GUC (the pattern of StagedFilesSweeperService). Row metadata (counts,
// outcome ids, timestamps) is kept: no retention period for it is decided.
@Injectable()
export class WorkflowProposalsSweeperService {
  private readonly logger = new Logger(WorkflowProposalsSweeperService.name);

  @Cron("17 * * * *")
  async hourly(): Promise<void> {
    try {
      const n = await this.sweep(new Date());
      if (n > 0) this.logger.log(`Cleared the rows of ${n} expired workflow proposals.`);
    } catch {
      this.logger.error("Clearing expired workflow proposals failed; details omitted.");
    }
  }

  async sweep(now: Date): Promise<number> {
    const schools = await basePrisma.school.findMany({ select: { id: true } });
    let total = 0;
    for (const school of schools) {
      total += await withTenant(school.id, (db) => expireWorkflowProposals(db, school.id, now));
    }
    return total;
  }
}
