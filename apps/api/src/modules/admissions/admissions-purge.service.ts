import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { basePrisma, withTenant } from "@school-kit/db";

import { StorageService } from "../../common/storage/storage.service.js";
import type { PrivateFileExt } from "../../common/storage/storage.types.js";
import { ADMISSION_CLOSED, ADMISSION_PURGE_DAYS } from "./admissions.shared.js";

// Phase 9 / CP7.1 — NDPR keeping and deleting (docs/modules/phase-9.md §16
// CP7-D7, §16.8 answer 5). Every night, a rejected or withdrawn application is
// deleted 90 days after it closed: its files first, then the row (documents
// go with it). Admitted applications stay, with the student. Each school is
// swept under its own GUC, as the report-export sweeper does.

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AdmissionsPurgeService {
  private readonly logger = new Logger(AdmissionsPurgeService.name);

  constructor(private readonly storage: StorageService) {}

  @Cron("35 2 * * *")
  async nightly(): Promise<void> {
    try {
      const n = await this.purge(new Date());
      if (n > 0) this.logger.log(`Deleted ${n} closed admission applications past ${ADMISSION_PURGE_DAYS} days.`);
    } catch (err) {
      this.logger.error(`Admission purge failed: ${String(err)}`);
    }
  }

  /** Deletes closed applications older than 90 days at `now`. Returns how many. */
  async purge(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - ADMISSION_PURGE_DAYS * DAY_MS);
    const schools = await basePrisma.school.findMany({ select: { id: true } });
    let total = 0;
    for (const school of schools) {
      const due = await withTenant(school.id, (db) =>
        db.admissionApplication.findMany({
          where: { schoolId: school.id, status: { in: [...ADMISSION_CLOSED] }, statusChangedAt: { lt: cutoff } },
          select: { id: true, documents: { select: { id: true, ext: true } } },
          take: 500,
        }),
      );
      for (const app of due) {
        for (const d of app.documents) {
          await this.storage.delete(school.id, { kind: "admission-document", documentId: d.id, ext: d.ext as PrivateFileExt });
        }
        await withTenant(school.id, async (db) => {
          await db.admissionApplication.delete({ where: { id: app.id } });
          await db.auditLog.create({
            data: { schoolId: school.id, userId: null, action: "admission.purge", entityType: "admission_application", entityId: app.id, ipAddress: null, metadata: {} },
          });
        });
        total += 1;
      }
    }
    return total;
  }
}
