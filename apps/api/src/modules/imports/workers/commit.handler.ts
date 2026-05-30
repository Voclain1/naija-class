import { Logger } from "@nestjs/common";
import { UnrecoverableError } from "bullmq";

import { Prisma, withTenant } from "@school-kit/db";
import type {
  GuardianImportRow,
  ImportRowError,
  StudentImportRow,
  TeacherImportRow,
} from "@school-kit/types";

import { StorageService } from "../../../common/storage";
import { runGuardianValidationEngine } from "../validate-guardians.engine";
import { runStudentValidationEngine } from "../validate-students.engine";
import { runTeacherValidationEngine } from "../validate-teachers.engine";
import {
  EngineFatalError,
  badRowsToCsv,
  buildBadRowsFromSource,
  parsePersistedMapping,
  type EngineResult,
} from "../validate.engine";
import { commitGuardianRow, CommitRowError } from "./commit-guardians.row";
import { commitStudentRow } from "./commit-students.row";
import { commitTeacherRow } from "./commit-teachers.row";

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

// runCommitHandler — orchestrates the commit pipeline for STUDENTS,
// GUARDIANS (slice 8), and TEACHERS (slice 10 cp2). The per-type bits
// (which engine to call, which per-row commit function to invoke, which
// audit action to write) are extracted into small modules; this file owns
// the shared orchestration: status guard, source.csv re-read, per-row loop,
// error-report write, final job-row update, audit row.
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
//   4. Re-run the type-specific validation engine. This is what makes
//      per-row retries and partial-success semantics work:
//        - in-file dedup re-applied (per-type semantics — students
//          reject duplicate admission numbers; guardians reject only
//          duplicate full link tuples)
//        - external check re-applied (students: admission number not
//          already taken; guardians: studentAdmissionNumber resolves
//          to a real Student; teachers: email not already a User)
//   5. For each row in result.good, open a per-row withTenant() tx and
//      invoke the per-type commit row function. CommitRowError
//      (recoverable per-row failure: student lookup missing, guardian
//      link already exists) → push to commitErrors with the typed
//      field+message. Other Prisma errors → push with the generic
//      describeCommitFailure() message. One bad row never fails the
//      whole import.
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
//   9. Write one audit row with action='<resource>.import.commit' and
//      counts in metadata. PII-free. Action is type-dispatched:
//      'student.import.commit' for STUDENTS, 'guardian.import.commit'
//      for GUARDIANS, 'teacher.import.commit' for TEACHERS.

export async function runCommitHandler(
  args: CommitHandlerArgs,
): Promise<CommitHandlerResult> {
  const { jobId, schoolId, userId, storage, logger } = args;

  // Step 1 — load + guard.
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
    logger.warn(
      `commit: import ${jobId} is ${existing.status}, not COMMITTING; skipping`,
    );
    return { status: "skipped", reason: "wrong-status" };
  }
  // All three import types are handled (STUDENTS + GUARDIANS slice 8;
  // TEACHERS slice 10 cp2). The dispatch below is exhaustive over
  // ImportJobType — a new enum member would fail the per-type switches at
  // typecheck time.
  const type = existing.type;

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

  // Step 4 — re-validate. Per-type engine; result is a discriminated
  // union over Row.
  type EngineResultEither =
    | EngineResult<StudentImportRow>
    | EngineResult<GuardianImportRow>
    | EngineResult<TeacherImportRow>;
  let engineResult: EngineResultEither;
  try {
    engineResult = await withTenant(
      schoolId,
      async (db): Promise<EngineResultEither> => {
        if (type === "STUDENTS") {
          return runStudentValidationEngine(
            db,
            sourceBytes,
            mapping.mapping,
            mapping.options,
          );
        }
        if (type === "GUARDIANS") {
          return runGuardianValidationEngine(
            db,
            sourceBytes,
            mapping.mapping,
            mapping.options,
          );
        }
        return runTeacherValidationEngine(
          db,
          sourceBytes,
          mapping.mapping,
          mapping.options,
        );
      },
    );
  } catch (e) {
    if (e instanceof EngineFatalError) {
      throw new UnrecoverableError(
        `commit: import ${jobId} ${e.kind}: ${e.message}`,
      );
    }
    throw e;
  }

  // Step 5 — per-row commit. Each row gets its own withTenant tx so a
  // failure on one row doesn't roll back others. Per-row throughput:
  // ~10ms (students, single insert) / ~20-30ms (guardians, three
  // operations). Within Phase 1's 10k cap.
  let committedRows = 0;
  const commitErrors: ImportRowError[] = [];

  for (const good of engineResult.good) {
    try {
      await withTenant(schoolId, (rowDb) => {
        if (type === "STUDENTS") {
          return commitStudentRow(
            good.parsedRow as StudentImportRow,
            schoolId,
            rowDb,
          );
        }
        if (type === "GUARDIANS") {
          return commitGuardianRow(
            good.parsedRow as GuardianImportRow,
            schoolId,
            rowDb,
          );
        }
        // TEACHERS — each good row becomes one Invitation. Needs userId
        // for invitation.invitedBy (the admin who triggered the commit).
        return commitTeacherRow(
          good.parsedRow as TeacherImportRow,
          schoolId,
          userId,
          rowDb,
        );
      });
      committedRows += 1;
    } catch (e) {
      let field: string;
      let message: string;
      if (e instanceof CommitRowError) {
        // Typed per-row failure (student not found, link already
        // exists, invitation already exists, etc.). Use the carried
        // field+message verbatim.
        field = e.field;
        message = e.message;
      } else {
        // Generic Prisma / unexpected error. Use describeCommitFailure
        // to produce a safe (PII-free) message; the field label is the
        // resource's "primary identifier" column.
        field =
          type === "STUDENTS"
            ? "admissionNumber"
            : type === "GUARDIANS"
              ? "studentAdmissionNumber"
              : "email";
        message = describeCommitFailure(e);
      }
      commitErrors.push({
        rowNumber: good.rowNumber,
        // csvRow gets overwritten in step 7 by buildBadRowsFromSource
        // (it has the verbatim source row content keyed by rowNumber).
        csvRow: {},
        errors: [{ field, message }],
      });
    }
  }

  // Step 6 — merge + sort.
  const allBad: ImportRowError[] = [
    ...engineResult.bad,
    ...commitErrors,
  ].sort((a, b) => a.rowNumber - b.rowNumber);

  // Step 7 — error report.
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

  // Step 8 + 9 — finalise row + audit.
  const auditAction =
    type === "STUDENTS"
      ? "student.import.commit"
      : type === "GUARDIANS"
        ? "guardian.import.commit"
        : "teacher.import.commit";
  await withTenant(schoolId, async (db) => {
    await db.importJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        committedRows,
        invalidRows: allBad.length,
        errorReportUrl,
        completedAt: new Date(),
      },
    });

    await db.auditLog.create({
      data: {
        schoolId,
        userId,
        action: auditAction,
        entityType: "import_job",
        entityId: jobId,
        ipAddress: null,
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
    `commit: ${type.toLowerCase()} import ${jobId} COMPLETED — committed=${committedRows} commitErrors=${commitErrors.length} validateBad=${engineResult.bad.length}`,
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

// Map a per-row Prisma error to the message that lands in error-report.csv.
// Exported for unit testing — the spy-based "actual P2002 from per-row
// create" integration test is too fragile to wire across Prisma's tx
// boundary, so the mapping is verified directly.
//
// For STUDENTS, the only unique constraint is admission_number, so P2002
// is unambiguously a race. For GUARDIANS, the typed CommitRowError path
// catches the StudentGuardian P2002 case BEFORE this falls through, so
// any P2002 reaching here is an unexpected uniqueness violation on
// Guardian itself (which has no unique columns per slice 5's schema
// design) — should not happen, but the generic message keeps the import
// alive if it does.
export function describeCommitFailure(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return "Could not commit: admission number already exists in roster (race).";
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    return `Could not commit: database error (${e.code}).`;
  }
  return "Could not commit: unexpected error during insert.";
}
