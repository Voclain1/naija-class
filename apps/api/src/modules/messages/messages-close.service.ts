import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { basePrisma, withTenant } from "@school-kit/db";
import { MESSAGE_LIMITS } from "@school-kit/types";

import { StorageService } from "../../common/storage/storage.service.js";
import { deleteImageFiles } from "./message-safety.js";

// Phase 9 / CP8.1 — a conversation with no new message for 30 days is closed
// (docs/modules/phase-9.md §17.2 CP8-D4, §17.8 answer 3). Closed ones are
// read-only; the parent starts a new one. Each school is swept under its own
// GUC, as the admissions purge does.
//
// CP8.2 (§17.10): a closed conversation is deleted two years after closing,
// images and all, unless it is flagged; a flagged one stays until an admin
// clears the flag. A photo staged but never sent is deleted after a day.

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class MessagesCloseService {
  private readonly logger = new Logger(MessagesCloseService.name);

  constructor(private readonly storage: StorageService) {}

  @Cron("45 2 * * *")
  async nightly(): Promise<void> {
    try {
      const n = await this.closeQuiet(new Date());
      if (n > 0) this.logger.log(`Closed ${n} conversations quiet for ${MESSAGE_LIMITS.closeAfterDays} days.`);
    } catch (err) {
      this.logger.error(`Closing quiet conversations failed: ${String(err)}`);
    }
    try {
      const { threads, images } = await this.deleteOld(new Date());
      if (threads + images > 0) this.logger.log(`Deleted ${threads} conversations closed two years ago and ${images} unsent photos.`);
    } catch (err) {
      this.logger.error(`Deleting old conversations failed: ${String(err)}`);
    }
  }

  /**
   * Deletes unflagged conversations closed more than two years before `now`
   * (with their photos), and photos staged more than a day ago and never sent.
   */
  async deleteOld(now: Date): Promise<{ threads: number; images: number }> {
    const keepCutoff = new Date(now.getTime() - MESSAGE_LIMITS.keepClosedDays * DAY_MS);
    const stagedCutoff = new Date(now.getTime() - DAY_MS);
    const schools = await basePrisma.school.findMany({ select: { id: true } });
    let threads = 0;
    let images = 0;
    for (const school of schools) {
      const found = await withTenant(school.id, async (db) => {
        const old = await db.messageThread.findMany({
          where: { schoolId: school.id, status: "CLOSED", closedAt: { lt: keepCutoff }, flaggedAt: null },
          select: { id: true },
          take: 500,
        });
        const ids = old.map((t) => t.id);
        const oldImages = ids.length
          ? await db.messageImage.findMany({ where: { schoolId: school.id, message: { threadId: { in: ids } } }, select: { id: true, ext: true } })
          : [];
        const stale = await db.messageImage.findMany({
          where: { schoolId: school.id, messageId: null, createdAt: { lt: stagedCutoff } },
          select: { id: true, ext: true },
          take: 1000,
        });
        return { ids, oldImages, stale };
      });
      // Files first: a row without its file is harmless, a file without its row is lost track of.
      await deleteImageFiles(this.storage, school.id, [...found.oldImages, ...found.stale]);
      await withTenant(school.id, async (db) => {
        if (found.ids.length) await db.messageThread.deleteMany({ where: { schoolId: school.id, id: { in: found.ids }, flaggedAt: null } });
        if (found.stale.length) await db.messageImage.deleteMany({ where: { schoolId: school.id, id: { in: found.stale.map((i) => i.id) }, messageId: null } });
      });
      threads += found.ids.length;
      images += found.stale.length;
    }
    return { threads, images };
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
