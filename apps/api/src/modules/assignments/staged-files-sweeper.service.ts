import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { basePrisma, withTenant } from "@school-kit/db";

import type { PrivateFileExt } from "../../common/storage/storage.types.js";
import { StorageService } from "../../common/storage/storage.service.js";

// A photo or PDF a student attached but never handed in stays "staged" with
// no submission. These are deleted 30 days after they were attached, files
// first, each school under its own GUC (the pattern of MessagesCloseService).

const DAY_MS = 24 * 60 * 60 * 1000;
export const STAGED_FILE_KEEP_DAYS = 30;

@Injectable()
export class StagedFilesSweeperService {
  private readonly logger = new Logger(StagedFilesSweeperService.name);

  constructor(private readonly storage: StorageService) {}

  @Cron("55 2 * * *")
  async nightly(): Promise<void> {
    try {
      const n = await this.sweep(new Date());
      if (n > 0) this.logger.log(`Deleted ${n} homework files attached but never handed in.`);
    } catch (err) {
      this.logger.error(`Deleting unsent homework files failed: ${String(err)}`);
    }
  }

  /** Deletes staged files attached more than 30 days before `now`. Returns how many. */
  async sweep(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - STAGED_FILE_KEEP_DAYS * DAY_MS);
    const schools = await basePrisma.school.findMany({ select: { id: true } });
    let total = 0;
    for (const school of schools) {
      const stale = await withTenant(school.id, (db) =>
        db.assignmentSubmissionFile.findMany({
          where: { schoolId: school.id, submissionId: null, createdAt: { lt: cutoff } },
          select: { id: true, ext: true },
          take: 1000,
        }),
      );
      if (stale.length === 0) continue;
      // Files first: a row without its file is harmless, a file without its row is lost track of.
      for (const f of stale) {
        await this.storage.delete(school.id, { kind: "submission-file", fileId: f.id, ext: f.ext as PrivateFileExt }).catch(() => undefined);
      }
      await withTenant(school.id, (db) =>
        db.assignmentSubmissionFile.deleteMany({
          where: { schoolId: school.id, id: { in: stale.map((f) => f.id) }, submissionId: null },
        }),
      );
      total += stale.length;
    }
    return total;
  }
}
