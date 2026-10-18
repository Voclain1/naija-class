import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { basePrisma, withTenant } from "@school-kit/db";
import { MESSAGE_LIMITS } from "@school-kit/types";

// Phase 9 / CP8.1 — a conversation with no new message for 30 days is closed
// (docs/modules/phase-9.md §17.2 CP8-D4, §17.8 answer 3). Closed ones are
// read-only; the parent starts a new one. Each school is swept under its own
// GUC, as the admissions purge does. Deleting closed conversations after two
// years comes in CP8.2.

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class MessagesCloseService {
  private readonly logger = new Logger(MessagesCloseService.name);

  @Cron("45 2 * * *")
  async nightly(): Promise<void> {
    try {
      const n = await this.closeQuiet(new Date());
      if (n > 0) this.logger.log(`Closed ${n} conversations quiet for ${MESSAGE_LIMITS.closeAfterDays} days.`);
    } catch (err) {
      this.logger.error(`Closing quiet conversations failed: ${String(err)}`);
    }
  }

  /** Closes open conversations whose last message is more than 30 days before `now`. Returns how many. */
  async closeQuiet(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - MESSAGE_LIMITS.closeAfterDays * DAY_MS);
    const schools = await basePrisma.school.findMany({ select: { id: true } });
    let total = 0;
    for (const school of schools) {
      total += await withTenant(school.id, async (db) => {
        const done = await db.messageThread.updateMany({
          where: { schoolId: school.id, status: "OPEN", lastMessageAt: { lt: cutoff } },
          data: { status: "CLOSED", closedAt: now },
        });
        return done.count;
      });
    }
    return total;
  }
}
