import { randomUUID } from "node:crypto";
import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";

import { Prisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  applyStudentImportMappingSchema,
  type ApplyStudentImportMappingInput,
  type ImportJobDto,
  type ImportJobPreviewSnapshot,
  type ImportMappingAcceptedResponse,
  type ImportUploadResponse,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";
import {
  IMPORTS_JOB_VALIDATE,
  IMPORTS_QUEUE,
  type TenantJobData,
} from "../../common/queue";
import { StorageService, pathFor as storagePathFor } from "../../common/storage";
import { preflightCsv } from "./imports.csv-parser";
import {
  EngineFatalError,
  badRowsToCsv,
  buildBadRowsFromSource,
  parsePersistedMapping,
  runValidationEngine,
} from "./validate.engine";

// Audit actions — singular resource, dotted verb (locked in slice 1).
// `import.bad-rows.download` is a three-segment exception: the middle
// segment is the sub-resource (bad-rows) and the last is the verb. The
// shape stays parseable (resource.subresource.verb) and the action is
// distinct from a future `import.commit` so NDPR audits can filter on it.
const AUDIT = {
  upload: "import.upload",
  mapping: "import.mapping",
  badRowsDownload: "import.bad-rows.download",
} as const;

// Job-data shape passed to the validate worker. Carries `schoolId` so
// tenantWorker can establish withTenant() context BEFORE any DB call —
// see apps/api/src/common/queue/tenant-worker.ts header for the full
// rationale. `userId` is included because the worker writes audit rows
// (cp3) and needs the actor.
export interface ValidateJobData extends TenantJobData {
  jobId: string;
  type: "STUDENTS";
}

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

interface UploadFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly storage: StorageService,
    @InjectQueue(IMPORTS_QUEUE)
    private readonly queue: Queue<ValidateJobData>,
  ) {}

  // ----------------------------------------------------------------------
  // uploadStudents — multipart endpoint.
  //
  // Flow:
  //   1. assertUserActiveAndHasOneOf(["owner", "admin"]) (will become
  //      PermissionsGuard["student.import"] when slice 13 lands).
  //   2. Synchronous CSV preflight: count rows, validate headers, build
  //      the 5-sample-row preview. Throws PayloadTooLargeError /
  //      ValidationError per spec BEFORE any storage write.
  //   3. Insert ImportJob row in PENDING (under withTenant). We do the
  //      insert BEFORE the storage put so the canonical jobId UUID is
  //      what pathFor() uses for the storage path — keeps the layout
  //      "schools/<schoolId>/imports/<jobId>/source.csv" stable across
  //      both backends.
  //   4. Persist source.csv via StorageService. If this fails, the
  //      ImportJob row is rolled back (the put is inside the same
  //      withTenant transaction).
  //   5. Audit + return.
  //
  // Why preflight BEFORE the DB insert: the row caps + header checks are
  // the only "free" rejections we have. Persisting the row first would
  // mean a TOO_MANY_ROWS rejection still wrote (and then orphaned) a
  // pending job. Cheap to fail fast.
  // ----------------------------------------------------------------------
  async uploadStudents(
    authCtx: AuthContext,
    file: UploadFile,
    reqCtx: RequestContext,
  ): Promise<ImportUploadResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    // Multer fileFilter already rejected non-text uploads; we accept any
    // file (the spec doesn't pin a MIME type because Nigerian schools
    // export CSVs from Excel and the type field is unreliable). If the
    // body is empty we surface INVALID_CSV with a clearer message than
    // the parser would emit on a zero-length parse.
    if (!file || file.size === 0) {
      throw new ValidationError(
        "INVALID_CSV",
        "No file uploaded, or the file was empty.",
      );
    }

    // Preflight — synchronous. Throws on caps / header issues. Done
    // BEFORE the withTenant transaction so we never open a DB tx for an
    // upload we're going to reject.
    const preflight = preflightCsv(file.buffer);

    // We need a jobId to derive the storage path; Postgres' uuid()
    // default lives on the column, but doing the insert + put atomically
    // requires the id BEFORE the put. Generate here, pass through.
    const jobId = randomUUID();

    return withTenant(authCtx.schoolId, async (db) => {
      // Persist the source CSV FIRST so an insert failure leaves nothing
      // dangling. Wait — that's wrong: a storage put without the row is
      // an orphan blob. Order: insert row → put → audit, all in the
      // same tenant transaction. If put fails we rollback the row; if
      // audit fails we rollback the row AND need to clean the blob.
      //
      // We accept this small asymmetry: storage cleanup on a tx rollback
      // happens via a deferred deleteImportPrefix() in the catch below.
      // The blob is named after a jobId that no longer exists in the DB,
      // so it is unreachable anyway, but we clean it for hygiene.
      let storagePath: string | null = null;
      try {
        await db.importJob.create({
          data: {
            id: jobId,
            schoolId: authCtx.schoolId,
            type: "STUDENTS",
            status: "PENDING",
            sourceFileUrl: storagePathFor(authCtx.schoolId, {
              kind: "import-source",
              jobId,
            }),
            totalRows: preflight.totalRows,
            createdBy: authCtx.userId,
          },
        });

        storagePath = await this.storage.put(
          authCtx.schoolId,
          { kind: "import-source", jobId },
          file.buffer,
          "text/csv",
        );

        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.upload,
            entityType: "import_job",
            entityId: jobId,
            ipAddress: reqCtx.ipAddress,
            // Audit metadata MUST stay free of identifying PII. Row
            // counts + filename are not PII; the file CONTENTS are, but
            // those live in the storage object (tenant-scoped path) and
            // never enter the audit log.
            metadata: {
              type: "STUDENTS",
              totalRows: preflight.totalRows,
              headerCount: preflight.headers.length,
              fileName: file.originalname,
              fileSize: file.size,
            },
          },
        });

        return {
          jobId,
          status: "PENDING" as const,
          type: "STUDENTS" as const,
          headers: preflight.headers,
          sampleRows: preflight.sampleRows,
          totalRows: preflight.totalRows,
        };
      } catch (e) {
        // If we'd already persisted the blob and the audit insert blew
        // up, clean up the blob best-effort. The tenantWorker / Bull
        // queue never sees this jobId, so the half-state is bounded.
        if (storagePath !== null) {
          this.storage
            .deleteImportPrefix(authCtx.schoolId, jobId)
            .catch((cleanupErr) =>
              this.logger.warn(
                `Failed to clean storage for failed import ${jobId}: ${
                  cleanupErr instanceof Error
                    ? cleanupErr.message
                    : String(cleanupErr)
                }`,
              ),
            );
        }
        throw e;
      }
    });
  }

  // ----------------------------------------------------------------------
  // applyMapping — POST /imports/:jobId/mapping
  //
  // Validates the mapping covers every required Student field, persists
  // columnMapping + options on the row, flips status PENDING → VALIDATING,
  // and enqueues the validate worker job. The enqueue passes schoolId
  // FROM authCtx (NOT from request body) — the tenant-safety invariant
  // established in cp1's tenantWorker comment header.
  //
  // cp2 enqueues the validate job; cp3 replaces the stub processor with
  // the real logic. The endpoint shape doesn't change between cp2 and
  // cp3 — the UI works against this endpoint today.
  // ----------------------------------------------------------------------
  async applyMapping(
    authCtx: AuthContext,
    jobId: string,
    rawInput: unknown,
    reqCtx: RequestContext,
  ): Promise<ImportMappingAcceptedResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    const parsed = applyStudentImportMappingSchema.safeParse(rawInput);
    if (!parsed.success) {
      // The schema's superRefine produces a `missing` array in
      // issue.params (a ZodCustomIssue) when required fields are absent —
      // surface the spec's MISSING_REQUIRED_MAPPING code so the wizard
      // can light up the offending dropdowns without parsing the message.
      const missing = extractMissingFromZodIssues(parsed.error.issues);
      if (missing.length > 0) {
        throw new ValidationError(
          "MISSING_REQUIRED_MAPPING",
          `Required student fields not mapped: ${missing.join(", ")}.`,
          { missing },
        );
      }
      throw new ValidationError(
        "Invalid mapping payload",
        formatZodIssues(parsed.error.issues),
      );
    }
    const input: ApplyStudentImportMappingInput = parsed.data;

    await withTenant(authCtx.schoolId, async (db) => {
      const job = await db.importJob.findUnique({
        where: { id: jobId },
        select: { id: true, status: true, type: true },
      });
      if (!job) throw new NotFoundError("Import job not found.");
      if (job.type !== "STUDENTS") {
        throw new ConflictError(
          "INVALID_JOB_TYPE",
          "This mapping endpoint is for STUDENTS imports.",
        );
      }
      if (job.status !== "PENDING") {
        throw new ConflictError(
          "JOB_NOT_IN_PENDING_STATE",
          `Mapping can only be applied to a PENDING job. Current status: ${job.status}.`,
        );
      }

      await db.importJob.update({
        where: { id: jobId },
        data: {
          columnMapping: {
            // The mapping object is what the validate worker reads.
            // `options` lives alongside it so the cp3 worker can find
            // dateFormat / treatBlankAs in one fetch.
            mapping: input.columnMapping,
            options: input.options ?? {
              dateFormat: "YYYY-MM-DD",
              treatBlankAs: "skip",
            },
          },
          status: "VALIDATING",
        },
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.mapping,
          entityType: "import_job",
          entityId: jobId,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            // Header names ARE allowed in audit metadata — they came
            // from the school's own file (e.g. "Adm No", "DOB") and are
            // not student PII.
            mappedHeaderCount: Object.keys(input.columnMapping).length,
            mappedFieldCount: Object.values(input.columnMapping).filter(
              (v) => v !== null,
            ).length,
          },
        },
      });
    });

    // Enqueue AFTER the DB commit. If the enqueue fails the row sits in
    // VALIDATING forever — that's a known issue (tracked in cp3); cp2
    // accepts it because Redis being down is detected at startup. We
    // pass schoolId from authCtx — never from a body field.
    await this.queue.add(
      IMPORTS_JOB_VALIDATE,
      {
        schoolId: authCtx.schoolId,
        userId: authCtx.userId,
        jobId,
        type: "STUDENTS",
      },
      // Job id mirrors the ImportJob id so BullMQ's dedup catches an
      // accidental double-enqueue (rare, but the column mapping endpoint
      // is idempotent w.r.t. the row — calling it twice would normally
      // enqueue twice).
      { jobId },
    );

    return {
      jobId,
      status: "VALIDATING" as const,
    };
  }

  // ----------------------------------------------------------------------
  // getJob — GET /imports/:jobId
  //
  // The wizard polls this to learn when validation completes. Returns
  // the canonical ImportJobDto shape (lossy projection of the row — no
  // sourceFileUrl exposed, no createdBy exposed; those are server-side
  // concerns).
  // ----------------------------------------------------------------------
  async getJob(authCtx: AuthContext, jobId: string): Promise<ImportJobDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.importJob.findUnique({
        where: { id: jobId },
        select: IMPORT_JOB_SELECT,
      });
      if (!row) throw new NotFoundError("Import job not found.");
      return toImportJobDto(row);
    });
  }

  // ----------------------------------------------------------------------
  // deleteJob — DELETE /imports/:jobId
  //
  // Per spec: only deletable when status is NOT in (VALIDATING,
  // COMMITTING) — those are workers-in-flight states and deleting the
  // row out from under them would leave the worker writing to a missing
  // FK. Returns 409 otherwise. Cleans the storage prefix (source.csv
  // for cp2; cp3+ may also have error-report.csv).
  // ----------------------------------------------------------------------
  async deleteJob(
    authCtx: AuthContext,
    jobId: string,
    reqCtx: RequestContext,
  ): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    await withTenant(authCtx.schoolId, async (db) => {
      const row = await db.importJob.findUnique({
        where: { id: jobId },
        select: { id: true, status: true },
      });
      if (!row) throw new NotFoundError("Import job not found.");
      if (row.status === "VALIDATING" || row.status === "COMMITTING") {
        throw new ConflictError(
          "JOB_IN_PROGRESS",
          `Cannot delete a job while it is ${row.status}. Wait for it to finish or fail, then retry.`,
        );
      }

      await db.importJob.delete({ where: { id: jobId } });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: "import.abort",
          entityType: "import_job",
          entityId: jobId,
          ipAddress: reqCtx.ipAddress,
          metadata: { previousStatus: row.status },
        },
      });
    });

    // Storage cleanup outside the DB tx — the path layout is
    // schools/<schoolId>/imports/<jobId>/ which is tenant-scoped, and
    // deleteImportPrefix is idempotent. Failure here is logged but
    // doesn't fail the request: the DB row is already gone, which is
    // the security-relevant part.
    await this.storage.deleteImportPrefix(authCtx.schoolId, jobId).catch((e) =>
      this.logger.warn(
        `Failed to clean storage for deleted import ${jobId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      ),
    );
  }

  // ----------------------------------------------------------------------
  // generateBadRowsCsv — GET /imports/:jobId/bad-rows.csv
  //
  // Re-streams the source CSV and re-runs the same validation engine the
  // worker ran, then serialises every BAD row to CSV with an `_errors`
  // column. Why re-stream rather than persist a full bad-rows list on
  // the row: previewSnapshot stores only the first 50 of each pile (per
  // spec line 879); a 10k-row file with 8k bad rows would otherwise need
  // a 1–2 MB JSON column. The engine is deterministic against the same
  // source + mapping, so the re-run produces the same bytes as the
  // wizard's poll saw.
  //
  // NDPR-relevant: this is a PII export — bad rows contain student names,
  // DOBs, phone numbers, etc. Spec line 1236 calls for an audit row so
  // compliance reviews show who downloaded what. Action key:
  // `import.bad-rows.download`. The signed-URL TTL (for R2) is owned by
  // the storage layer; here we just emit bytes from a tenant-checked
  // route.
  //
  // Status guards:
  //   - READY            → download allowed
  //   - COMPLETED        → also allowed (post-commit; bad rows still
  //                        useful to the admin)
  //   - FAILED           → 409, no bad-rows to show
  //   - PENDING/VALIDATING/COMMITTING → 409, not yet validated
  // ----------------------------------------------------------------------
  async generateBadRowsCsv(
    authCtx: AuthContext,
    jobId: string,
    reqCtx: RequestContext,
  ): Promise<{ filename: string; content: Buffer }> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    const job = await withTenant(authCtx.schoolId, async (db) => {
      const row = await db.importJob.findUnique({
        where: { id: jobId },
        select: {
          id: true,
          status: true,
          type: true,
          columnMapping: true,
        },
      });
      if (!row) throw new NotFoundError("Import job not found.");
      if (row.type !== "STUDENTS") {
        throw new ConflictError(
          "INVALID_JOB_TYPE",
          "Bad-rows CSV is only available for STUDENTS imports in slice 6.",
        );
      }
      if (row.status !== "READY" && row.status !== "COMPLETED") {
        throw new ConflictError(
          "JOB_NOT_VALIDATED",
          `Bad-rows CSV is only available after validation. Current status: ${row.status}.`,
        );
      }
      return row;
    });

    let mapping;
    try {
      mapping = parsePersistedMapping(job.columnMapping);
    } catch (e) {
      // Mapping should be coherent — the cp2 endpoint validated it. If
      // it's not, the job is unusable; the wizard should never reach
      // this endpoint for such a row, but surface a 409 just in case.
      if (e instanceof EngineFatalError) {
        throw new ConflictError("MAPPING_INCOHERENT", e.message);
      }
      throw e;
    }

    let sourceBytes: Buffer;
    try {
      sourceBytes = await this.storage.get(authCtx.schoolId, {
        kind: "import-source",
        jobId,
      });
    } catch (e) {
      // The source file is gone. The job row is still here but unusable.
      // 409 is more accurate than 500 — the resource state is wrong, not
      // an internal failure.
      throw new ConflictError(
        "SOURCE_MISSING",
        `Source CSV is no longer available for this import: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }

    // Re-run the engine. Caller is responsible for the audit row — we
    // emit it BEFORE returning so the NDPR record is in place even if
    // the response stream fails mid-flight.
    const engineResult = await withTenant(authCtx.schoolId, (db) =>
      runValidationEngine(db, sourceBytes, mapping.mapping, mapping.options),
    );

    const badWithSource = buildBadRowsFromSource(sourceBytes, engineResult.bad);
    const csv = badRowsToCsv(engineResult.headers, badWithSource);

    await withTenant(authCtx.schoolId, async (db) => {
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.badRowsDownload,
          entityType: "import_job",
          entityId: jobId,
          ipAddress: reqCtx.ipAddress,
          // PII-free: row counts are not student data, and the action
          // name itself flags the export. The exported file contents
          // contain PII but live in storage / the response body, NOT in
          // the audit table.
          metadata: {
            badRowCount: badWithSource.length,
            totalRows: engineResult.totalRows,
          },
        },
      });
    });

    return {
      filename: `import-${jobId}-bad-rows.csv`,
      content: csv,
    };
  }
}

// -------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------

const IMPORT_JOB_SELECT = {
  id: true,
  type: true,
  status: true,
  totalRows: true,
  validRows: true,
  invalidRows: true,
  committedRows: true,
  previewSnapshot: true,
  failedReason: true,
  createdAt: true,
  completedAt: true,
} satisfies Prisma.ImportJobSelect;

type ImportJobRow = Prisma.ImportJobGetPayload<{
  select: typeof IMPORT_JOB_SELECT;
}>;

function toImportJobDto(row: ImportJobRow): ImportJobDto {
  return {
    jobId: row.id,
    type: row.type,
    status: row.status,
    totalRows: row.totalRows,
    validRows: row.validRows,
    invalidRows: row.invalidRows,
    committedRows: row.committedRows,
    previewSnapshot: (row.previewSnapshot ?? null) as ImportJobPreviewSnapshot | null,
    failedReason: row.failedReason,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

function formatZodIssues(
  issues: { path: (string | number)[]; message: string }[],
): { issues: { path: string; message: string }[] } {
  return {
    issues: issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  };
}

// Pulls the `missing` array out of a ZodCustomIssue produced by the
// applyStudentImportMappingSchema superRefine. ZodIssue is a union and
// only the custom variant carries `params`; we narrow defensively rather
// than casting at the call site.
function extractMissingFromZodIssues(issues: readonly unknown[]): string[] {
  for (const issue of issues) {
    if (typeof issue !== "object" || issue === null) continue;
    const params = (issue as { params?: unknown }).params;
    if (typeof params !== "object" || params === null) continue;
    const missing = (params as { missing?: unknown }).missing;
    if (Array.isArray(missing) && missing.every((m) => typeof m === "string")) {
      return missing as string[];
    }
  }
  return [];
}
