import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { basePrisma, withTenant } from "@school-kit/db";
import { REPORT_EXPORT_RETENTION_HOURS } from "@school-kit/types";

import { StorageService } from "../../common/storage/index.js";

// Phase 9 / CP1.1 — daily clean-up of PDF report copies older than
// REPORT_EXPORT_RETENTION_HOURS (docs/modules/phase-9.md §8.4).
//
// A system cron with no tenant, so it lists school ids with basePrisma
// (`schools` has no RLS — the session-sweeper pattern) and does every read and
// delete of report_exports under that school's own GUC, so RLS bounds each
// one. A file is deleted before its row: a failure part-way leaves a row to
// retry from tomorrow, never a file that nothing points at.
@Injectable()
export class ReportExportSweeperService {
  private readonly logger = new Logger(ReportExportSweeperService.name);

  constructor(private readonly storage: StorageService) {}

  @Cron("25 1 * * *")
  async purgeExpiredExports(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - REPORT_EXPORT_RETENTION_HOURS * 3600_000);
    const schools = await basePrisma.school.findMany({ select: { id: true } });
    let purged = 0;
    for (const { id: schoolId } of schools) {
      try {
        const old = await withTenant(schoolId, (db) =>
          db.reportExport.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true, storagePath: true } }),
        );
        if (old.length === 0) continue;
        for (const row of old) {
          if (row.storagePath) await this.storage.delete(schoolId, { kind: "report-export", exportId: row.id });
        }
        const { count } = await withTenant(schoolId, (db) =>
          db.reportExport.deleteMany({ where: { id: { in: old.map((r) => r.id) } } }),
        );
        purged += count;
      } catch (err) {
        this.logger.error(`report export clean-up failed for school ${schoolId}: ${String(err)}`);
      }
    }
    if (purged > 0) this.logger.log(`report export clean-up: removed ${purged}`);
    return purged;
  }
}
