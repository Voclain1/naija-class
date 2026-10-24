import { Injectable } from "@nestjs/common";

import { basePrisma, withTenant } from "@school-kit/db";
import {
  SCAN_RATINGS,
  SCAN_REVIEW_FIELDS,
  scanReviewStatsSchema,
  type ScanReviewStats,
  type SmartImportBetaDto,
  type SmartImportBetaSchoolDto,
  type SmartImportBetaTotalsDto,
} from "@school-kit/types";

// SchoolKit's view of the Smart Import beta (docs/modules/smart-student-import.md
// §9): per school, how many pages were read and how many cells admins had to
// change, per field. Counts only, from ImportJob.scanReview.
//
// No SECURITY DEFINER function: `schools` has no RLS, so the beta schools are
// listed directly, and each school's scans are then read under that school's
// own GUC, so RLS still bounds every read to one school. The beta is a
// handful of schools, so one read per school is fine.

/** Adds up a set of jobs' stats. Pure, so the arithmetic is tested on its own. */
export function sumScanStats(jobs: readonly ScanReviewStats[]): SmartImportBetaTotalsDto {
  const fields = SCAN_REVIEW_FIELDS.map((field) => ({ field, compared: 0, changed: 0, flagged: 0 }));
  const ratings = Object.fromEntries(SCAN_RATINGS.map((r) => [r, 0])) as SmartImportBetaTotalsDto["ratings"];
  let scansSaved = 0;
  let rowsRead = 0;
  let rowsKept = 0;
  let rowsRemoved = 0;
  let secondsTotal = 0;
  let slowest: number | null = null;
  for (const job of jobs) {
    rowsRead += job.rowsRead;
    secondsTotal += job.readSeconds;
    slowest = slowest === null ? job.readSeconds : Math.max(slowest, job.readSeconds);
    const review = job.review;
    if (!review) continue;
    scansSaved += 1;
    rowsKept += review.rowsKept;
    rowsRemoved += review.rowsRemoved;
    for (const f of fields) {
      f.compared += review.rowsKept;
      f.changed += review.fields[f.field].changed;
      f.flagged += review.fields[f.field].flagged;
    }
    if (review.rating) ratings[review.rating] += 1;
  }
  return {
    scans: jobs.length,
    scansSaved,
    rowsRead,
    rowsKept,
    rowsRemoved,
    fields,
    ratings,
    averageReadSeconds: jobs.length === 0 ? null : Math.round((secondsTotal / jobs.length) * 10) / 10,
    slowestReadSeconds: slowest,
  };
}

@Injectable()
export class SmartImportBetaService {
  async results(): Promise<SmartImportBetaDto> {
    // Every school in the beta: switched on now, or agreed and so scanned
    // before being switched off.
    const schools = await basePrisma.school.findMany({
      where: { OR: [{ smartImportEnabled: true }, { smartImportConsentAt: { not: null } }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true, smartImportEnabled: true, smartImportConsentAt: true },
      take: 200,
    });

    const all: ScanReviewStats[] = [];
    const rows: SmartImportBetaSchoolDto[] = [];
    for (const school of schools) {
      const jobs = await withTenant(school.id, (db) =>
        db.importJob.findMany({
          where: { type: "STUDENTS_SCAN" },
          orderBy: { createdAt: "desc" },
          select: { scanReview: true, createdAt: true },
          take: 1000,
        }),
      );
      // Scans from before the beta carry no counts; they are left out.
      const stats = jobs.flatMap((j) => {
        const parsed = scanReviewStatsSchema.safeParse(j.scanReview);
        return parsed.success ? [parsed.data] : [];
      });
      all.push(...stats);
      rows.push({
        schoolId: school.id,
        name: school.name,
        slug: school.slug,
        smartImportEnabled: school.smartImportEnabled,
        consentAt: school.smartImportConsentAt?.toISOString() ?? null,
        lastScanAt: jobs[0]?.createdAt.toISOString() ?? null,
        ...sumScanStats(stats),
      });
    }
    return { schools: rows, totals: sumScanStats(all) };
  }
}
