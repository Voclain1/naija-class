import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { Prisma, basePrisma, withTenant } from "@school-kit/db";

// Deletes the rows Smart Import read from a register photo
// (docs/modules/smart-student-import.md, "What is kept"; owner, 2026-11-12).
//
// commitScan clears them the moment an import is saved. This sweep covers the
// rest, each school under its own GUC (the StagedFilesSweeperService pattern):
//   - a scan nobody saved, once it is SCAN_ROWS_KEEP_HOURS old. The scan page
//     keeps its rows in the browser and never reloads a scan from the server,
//     so an older unsaved scan can no longer be saved anyway;
//   - any finished scan that still holds rows: a save whose last write failed,
//     and every scan saved before 2026-11-12, cleared by the first run.
// Only the rows go. The job, its counts (scan_review) and its audit rows stay.

export const SCAN_ROWS_KEEP_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class ScanRowsSweeperService {
  private readonly logger = new Logger(ScanRowsSweeperService.name);

  @Cron("17 * * * *")
  async hourly(): Promise<void> {
    try {
      const n = await this.sweep(new Date());
      if (n > 0) this.logger.log(`Deleted the read rows of ${n} Smart Import scans.`);
    } catch (err) {
      this.logger.error(`Deleting Smart Import read rows failed: ${String(err)}`);
    }
  }

  /** Clears read rows from scans that are finished, or unsaved and older than the limit. Returns how many. */
  async sweep(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - SCAN_ROWS_KEEP_HOURS * HOUR_MS);
    const schools = await basePrisma.school.findMany({ select: { id: true } });
    let total = 0;
    for (const school of schools) {
      const { count } = await withTenant(school.id, (db) =>
        db.importJob.updateMany({
          where: {
            schoolId: school.id,
            type: "STUDENTS_SCAN",
            previewSnapshot: { not: Prisma.DbNull },
            OR: [{ status: { not: "READY" } }, { createdAt: { lt: cutoff } }],
          },
          data: { previewSnapshot: Prisma.DbNull },
        }),
      );
      total += count;
    }
    return total;
  }
}
