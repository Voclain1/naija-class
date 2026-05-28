import { Logger } from "@nestjs/common";
import { UnrecoverableError } from "bullmq";

import { Prisma, withTenant } from "@school-kit/db";
import type { StudentImportRowError } from "@school-kit/types";

import { StorageService } from "../../../common/storage";
import {
  EngineFatalError,
  badRowsToCsv,
  buildBadRowsFromSource,
  parsePersistedMapping,
  runValidationEngine,
} from "../validate.engine";

// Commit-handler outcome — exposed so the spec can assert on the shape
// without re-reading the DB row. The BullMQ wrapper in imports.processor
// discards the return value (commit is fire-and-forget from BullMQ's POV);
// tests use it directly.
export type CommitHandlerResult =
  | { status: "skipped"; reason: "no-row" | "wrong-status" | "wrong-type" }
  | {
      status: "completed";
      committedRows: number;
      commitErrorCount: number;
      validateBadCount: number;
      totalRows: number;
      errorReportUrl: string | null;
    };

export interface CommitHandlerArgs {
  jobId: string;
  schoolId: string;
  userId: string;
  storage: StorageService;
  logger: Logger;
}

// runCommitHandler — pure (modulo IO) function that does the commit job's
// work. Kept out of the @Processor class so it's testable without a Worker
// harness and so the shape stays one focused function rather than scattered
// methods.
//
// Pipeline (each numbered step is its own withTenant transaction unless
// otherwise noted):
//
//   1. Load ImportJob row. Status MUST be COMMITTING (not READY) — the
//      service flips READY → COMMITTING before enqueuing. On a BullMQ
//      retry the status is still COMMITTING, so the same guard lets the
//      retry resume cleanly.
//   2. Parse columnMapping. Corrupt mapping → UnrecoverableError; BullMQ
//      skips retries and the listener writes status=FAILED.
//   3. Read source.csv from storage. Missing file → UnrecoverableError.
//   4. Re-run the validation engine. This is what makes per-row retries
//      and partial-success semantics work:
//        - in-file dedup re-applied
//        - external dedup re-queries students.admissionNumber — any rows
//          committed by a previous worker attempt (after a crash) OR by
//          another admin between READY and now are excluded from the
//          good pile and surface in the bad pile with "Already exists
//          in roster"
//   5. For each row in result.good, open a per-row withTenant() tx and
//      insert one Student row. P2002 (race-condition admission-number
//      collision that re-validate missed because the OTHER admin's
//      manual create happened in the millisecond gap) is caught and
//      pushed onto commitErrors with "Could not commit: ...". Any other
//      Prisma error is also caught — one bad row never fails the whole
//      import.
//   6. Merge result.bad (validate-time failures) with commitErrors
//      (commit-time failures), sort by rowNumber.
//   7. If the merged list is non-empty, render bad-rows.csv (header +
//      `_errors` column) and persist to storage at
//      schools/<schoolId>/imports/<jobId>/error-report.csv. Path stored
//      on ImportJob.errorReportUrl; the GET /error-report.csv endpoint
//      reads through StorageService.get(), NOT a signed URL — kept
//      symmetric with bad-rows.csv (slice 6).
//   8. Update ImportJob: status=COMPLETED, committedRows, invalidRows
//      (recomputed from merged list), errorReportUrl, completedAt.
//   9. Write one audit row with action='student.import.commit' and
//      counts in metadata. PII-free.

export async function runCommitHandler(
  args: CommitHandlerArgs,
): Promise<CommitHandlerResult> {
  const { jobId, schoolId, userId, storage, logger } = args;

  // Step 1 — load + guard. Single tx; closes before per-row work begins.
  const existing = await withTenant(schoolId, async (db) =>
    db.importJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        columnMapping: true,
        type: true,
      },
    }),
  );
  if (!existing) {
    logger.warn(`commit: import ${jobId} no longer exists; skipping`);
    return { status: "skipped", reason: "no-row" };
  }
  if (existing.status !== "COMMITTING") {
    // READY → admin hasn't clicked Commit (impossible — service flips
    // before enqueue, but defensive). COMPLETED/FAILED → already done.
    // Anything else: idempotent no-op.
    logger.warn(
      `commit: import ${jobId} is ${existing.status}, not COMMITTING; skipping`,
    );
    return { status: "skipped", reason: "wrong-status" };
  }
  if (existing.type !== "STUDENTS") {
    throw new UnrecoverableError(
      `commit: import ${jobId} type ${existing.type} is not handled in slice 7`,
    );
  }

  // Step 2 — parse mapping.
  let mapping;
  try {
    mapping = parsePersistedMapping(existing.columnMapping);
  } catch (e) {
    if (e instanceof EngineFatalError) {
      throw new UnrecoverableError(e.message);
    }
    throw e;
  }

  // Step 3 — read source.csv.
  let sourceBytes: Buffer;
  try {
    sourceBytes = await storage.get(schoolId, { kind: "import-source", jobId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new UnrecoverableError(
      `commit: could not read source.csv for import ${jobId}: ${msg}`,
    );
  }

  // Step 4 — re-validate. Runs in its own withTenant tx (the engine
  // does its external-dedup query against students.admissionNumber).
  let engineResult;
  try {
    engineResult = await withTenant(schoolId, (db) =>
      runValidationEngine(db, sourceBytes, mapping.mapping, mapping.options),
    );
  } catch (e) {
    if (e instanceof EngineFatalError) {
      throw new UnrecoverableError(
        `commit: import ${jobId} ${e.kind}: ${e.message}`,
      );
    }
    throw e;
  }

  // Step 5 — per-row commit. Each row is its own withTenant transaction
  // so a collision on one row doesn't roll back others. We do NOT batch
  // — see CLAUDE.md / slice 7 plan: per-row is the load-bearing choice
  // for partial-success semantics and BullMQ-retry idempotency.
  //
  // Throughput: ~10ms per row at the dev Postgres → 5s for 500 rows,
  // 100s for 10k. Within Phase 1's 10k cap and well within the BullMQ
  // job stall threshold (default 30s — but our re-validate keeps the
  // event loop active across each row, and BullMQ's stall window
  // resets on each await).
  let committedRows = 0;
  const commitErrors: StudentImportRowError[] = [];

  for (const good of engineResult.good) {
    try {
      await withTenant(schoolId, (rowDb) =>
        rowDb.student.create({
          data: {
            schoolId,
            admissionNumber: good.parsedRow.admissionNumber,
            firstName: good.parsedRow.firstName,
            middleName: good.parsedRow.middleName ?? null,
            lastName: good.parsedRow.lastName,
            dateOfBirth: good.parsedRow.dateOfBirth,
            gender: good.parsedRow.gender,
            phone: good.parsedRow.phone ?? null,
            email: good.parsedRow.email ?? null,
            address: good.parsedRow.address ?? null,
            photoUrl: good.parsedRow.photoUrl ?? null,
            bloodGroup: good.parsedRow.bloodGroup ?? null,
            religion: good.parsedRow.religion ?? null,
            stateOfOrigin: good.parsedRow.stateOfOrigin ?? null,
          },
        }),
      );
      committedRows += 1;
    } catch (e) {
      commitErrors.push({
        rowNumber: good.rowNumber,
        // csvRow gets overwritten in step 7 by buildBadRowsFromSource
        // (it has the verbatim source row content keyed by rowNumber).
        // We pass {} here as a placeholder for type-safety.
        csvRow: {},
        errors: [
          {
            field: "admissionNumber",
            message: describeCommitFailure(e),
          },
        ],
      });
    }
  }

  // Step 6 — merge + sort. result.bad is already sorted; commitErrors
  // appends to the end; final sort restores ascending rowNumber.
  const allBad = [...engineResult.bad, ...commitErrors].sort(
    (a, b) => a.rowNumber - b.rowNumber,
  );

  // Step 7 — error report (only if non-empty).
  let errorReportUrl: string | null = null;
  if (allBad.length > 0) {
    const badWithSource = buildBadRowsFromSource(sourceBytes, allBad);
    const csvBytes = badRowsToCsv(engineResult.headers, badWithSource);
    errorReportUrl = await storage.put(
      schoolId,
      { kind: "import-error-report", jobId },
      csvBytes,
      "text/csv",
    );
  }

  // Step 8 + 9 — finalise row + audit, single tx.
  await withTenant(schoolId, async (db) => {
    await db.importJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        committedRows,
        // Recompute invalidRows from the merged bad list. The validate
        // step's invalidRows count may have grown (commit-time errors)
        // or even shrunk (a row that failed external dedup at validate
        // could pass on re-validate if the dup was deleted — unusual
        // but possible).
        invalidRows: allBad.length,
        errorReportUrl,
        completedAt: new Date(),
      },
    });

    await db.auditLog.create({
      data: {
        schoolId,
        userId,
        action: "student.import.commit",
        entityType: "import_job",
        entityId: jobId,
        ipAddress: null, // worker has no HTTP request
        // PII-free: row counts only. The bad rows' contents live in
        // error-report.csv (tenant-scoped storage path) and the audit
        // log NEVER carries import payload data.
        metadata: {
          totalRows: engineResult.totalRows,
          validatedGood: engineResult.good.length,
          validatedBad: engineResult.bad.length,
          committedRows,
          commitErrorCount: commitErrors.length,
          errorReportWritten: errorReportUrl !== null,
        },
      },
    });
  });

  logger.log(
    `commit: import ${jobId} COMPLETED — committed=${committedRows} commitErrors=${commitErrors.length} validateBad=${engineResult.bad.length}`,
  );

  return {
    status: "completed",
    committedRows,
    commitErrorCount: commitErrors.length,
    validateBadCount: engineResult.bad.length,
    totalRows: engineResult.totalRows,
    errorReportUrl,
  };
}

// Map a per-row create error to the message that lands in error-report.csv.
// P2002 (unique violation) at this point is always the admission_number
// uniqueness — that's the only unique-per-school constraint on students.
// Other Prisma errors get a generic message; we never leak raw error text
// (could contain a column value).
//
// Exported for unit testing — the spy-based "actual P2002 from per-row
// create" integration test is too fragile to wire across Prisma's tx
// boundary, so the mapping is verified directly.
export function describeCommitFailure(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return "Could not commit: admission number already exists in roster (race).";
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    return `Could not commit: database error (${e.code}).`;
  }
  return "Could not commit: unexpected error during insert.";
}
