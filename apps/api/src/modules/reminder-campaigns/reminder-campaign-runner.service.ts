import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { basePrisma, withTenant } from "@school-kit/db";

import { ReminderCampaignsService } from "./reminder-campaigns.service";

// Continues RUNNING fee reminder campaigns (docs/modules/reminder-campaigns.md)
// after a restart, a lost in-process worker or a quiet-hours hold. Every two
// minutes, a bounded number of batches per campaign. Lists schools from
// `schools` (no RLS) by their stored switch, then reads each school's
// campaigns under its own GUC. The worker itself re-checks the switch, the
// platform override and the confirmer's access before every batch.
@Injectable()
export class ReminderCampaignRunnerService {
  private readonly logger = new Logger(ReminderCampaignRunnerService.name);
  private running = false;

  constructor(private readonly campaigns: ReminderCampaignsService) {}

  @Cron("*/2 * * * *")
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch {
      this.logger.error("Reminder campaign runner failed; details omitted.");
    } finally {
      this.running = false;
    }
  }

  async runOnce(opts: { now?: () => Date; maxBatches?: number } = {}): Promise<number> {
    const schools = await basePrisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM schools WHERE feature_switches ->> 'reminder-campaigns' = 'true'`;
    let processed = 0;
    for (const { id: schoolId } of schools) {
      const running = await withTenant(schoolId, (db) =>
        db.reminderCampaign.findMany({ where: { schoolId, status: "RUNNING" }, select: { id: true }, orderBy: { createdAt: "asc" } }),
      );
      for (const c of running) {
        try {
          await this.campaigns.processCampaign(schoolId, c.id, { now: opts.now, maxBatches: opts.maxBatches ?? 20 });
          processed += 1;
        } catch {
          this.logger.error(`Reminder campaign ${c.id} batch failed; details omitted.`);
        }
      }
    }
    return processed;
  }
}
