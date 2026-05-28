import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
} from "@school-kit/types";

import { FilesystemStorageDriver } from "../../common/storage/filesystem-storage.driver";
import { StorageService } from "../../common/storage/storage.service";
import { AuthService } from "../auth/auth.service";
import { ImportsService } from "./imports.service";

// Integration spec for ImportsService — real DB + real RLS + real filesystem
// storage driver under a tmp root. The BullMQ queue is mocked so the spec
// runs without Redis: it asserts the producer-side enqueue contract
// (schoolId from authCtx, job name, payload shape) without needing a worker.
//
// The cp2 surface tested here:
//   - uploadStudents: CSV preflight + storage persist + ImportJob insert +
//     audit row, plus all the rejection paths (oversized via row count,
//     malformed CSV, ambiguous headers, no file).
//   - applyMapping: required-field check, status guard, enqueue contract,
//     audit row.
//   - getJob: round-trips the row to ImportJobDto.
//   - deleteJob: 409 on in-progress, cleans both row and storage.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00)
    .toString()
    .padStart(8, "0");
  return `+23477${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

interface MockQueueAddCall {
  name: string;
  data: Record<string, unknown>;
  options: Record<string, unknown>;
}

function makeMockQueue() {
  const calls: MockQueueAddCall[] = [];
  return {
    calls,
    add: vi.fn(async (name: string, data: unknown, options: unknown) => {
      calls.push({
        name,
        data: data as Record<string, unknown>,
        options: (options ?? {}) as Record<string, unknown>,
      });
      return { id: `mock-job-${calls.length}` };
    }),
  };
}

describe("ImportsService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const schoolIdsToCleanup = new Set<string>();
  let storageRoot: string;
  let storage: StorageService;
  let mockQueue: ReturnType<typeof makeMockQueue>;
  let service: ImportsService;

  beforeAll(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "schoolkit-imports-spec-"));
    const driver = new FilesystemStorageDriver(storageRoot);
    storage = new StorageService(driver);
    mockQueue = makeMockQueue();
    service = new ImportsService(storage, mockQueue as never);
  });

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
    rmSync(storageRoot, { force: true, recursive: true });
  });

  async function createActiveSchool(suffix: string) {
    const signed = await authService.signupOwner(
      {
        schoolName: `Imports Spec ${suffix}`,
        schoolSlug: `imp-${suffix}-${runId}`,
        ownerFirstName: "Olu",
        ownerLastName: "Owner",
        ownerEmail: `imports-${suffix}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    schoolIdsToCleanup.add(signed.school.id);
    await basePrisma.school.update({
      where: { id: signed.school.id },
      data: { status: "ACTIVE", onboardingStep: 5 },
    });
    return {
      schoolId: signed.school.id,
      userId: signed.user.id,
      authCtx: {
        sessionId: "sess-placeholder",
        userId: signed.user.id,
        schoolId: signed.school.id,
      },
    };
  }

  async function createUserWithoutRole(schoolId: string, suffix: string) {
    return withTenant(schoolId, async (db) => {
      const u = await db.user.create({
        data: {
          schoolId,
          firstName: "No",
          lastName: "Role",
          email: `norole-imports-${suffix}-${runId}@example.test`,
          phone: randomPhone(),
          passwordHash: "argon2id$placeholder",
        },
        select: { id: true },
      });
      return {
        authCtx: { sessionId: "sess-placeholder", userId: u.id, schoolId },
      };
    });
  }

  function csvBuffer(lines: string[]): Buffer {
    return Buffer.from(lines.join("\n"), "utf-8");
  }

  const goodCsv = csvBuffer([
    "Adm No,First Name,Surname,DOB,Sex,Phone",
    "ADM/001,Ada,Okafor,2014-03-15,Female,+2348012345678",
    "ADM/002,Tunde,Bello,2013-09-01,Male,",
    "ADM/003,Chi,Eze,2015-01-20,F,",
  ]);

  // -----------------------------------------------------------------------
  // uploadStudents
  // -----------------------------------------------------------------------

  describe("uploadStudents", () => {
    it("happy path: persists ImportJob in PENDING, writes file, returns headers+samples+totalRows", async () => {
      const { authCtx, schoolId } = await createActiveSchool("upload-ok");

      const result = await service.uploadStudents(
        authCtx,
        { buffer: goodCsv, originalname: "students.csv", size: goodCsv.length },
        reqCtx,
      );

      expect(result.status).toBe("PENDING");
      expect(result.type).toBe("STUDENTS");
      expect(result.totalRows).toBe(3);
      expect(result.headers).toEqual([
        "Adm No",
        "First Name",
        "Surname",
        "DOB",
        "Sex",
        "Phone",
      ]);
      expect(result.sampleRows).toHaveLength(3);
      expect(result.sampleRows[0]).toMatchObject({
        "Adm No": "ADM/001",
        "First Name": "Ada",
      });

      // Storage object exists at the canonical path
      const expectedFile = join(
        storageRoot,
        "schools",
        schoolId,
        "imports",
        result.jobId,
        "source.csv",
      );
      expect(statSync(expectedFile).size).toBe(goodCsv.length);

      // DB row exists with status PENDING and totalRows set
      const row = await withTenant(schoolId, (db) =>
        db.importJob.findUnique({ where: { id: result.jobId } }),
      );
      expect(row).toMatchObject({
        status: "PENDING",
        type: "STUDENTS",
        totalRows: 3,
        createdBy: authCtx.userId,
      });

      // Audit row exists; metadata is PII-free
      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: {
            schoolId,
            action: "import.upload",
            entityId: result.jobId,
          },
        }),
      );
      expect(audit).toBeTruthy();
      const metadata = audit?.metadata as Record<string, unknown>;
      expect(metadata).toMatchObject({
        type: "STUDENTS",
        totalRows: 3,
        headerCount: 6,
        fileName: "students.csv",
      });
      expect(metadata.firstName).toBeUndefined();
      expect(metadata.dateOfBirth).toBeUndefined();
    });

    it("rejects an empty file with INVALID_CSV", async () => {
      const { authCtx } = await createActiveSchool("upload-empty");
      await expect(
        service.uploadStudents(
          authCtx,
          { buffer: Buffer.alloc(0), originalname: "empty.csv", size: 0 },
          reqCtx,
        ),
      ).rejects.toMatchObject({ code: "INVALID_CSV" });
    });

    it("rejects a CSV with duplicate headers with AMBIGUOUS_HEADERS", async () => {
      const { authCtx } = await createActiveSchool("upload-dup-hdr");
      const dup = csvBuffer([
        "Name,Name,DOB",
        "Ada,Okafor,2014-03-15",
      ]);
      await expect(
        service.uploadStudents(
          authCtx,
          { buffer: dup, originalname: "dup.csv", size: dup.length },
          reqCtx,
        ),
      ).rejects.toMatchObject({ code: "AMBIGUOUS_HEADERS" });
    });

    it("rejects > 10 000 data rows with TOO_MANY_ROWS before storage persist", async () => {
      const { authCtx, schoolId } = await createActiveSchool("upload-toomany");
      const header = "Adm No,First Name,Surname,DOB,Sex";
      const dataRow = "ADM/x,Ada,Okafor,2014-03-15,F";
      const huge = csvBuffer([header, ...Array(10_001).fill(dataRow)]);

      await expect(
        service.uploadStudents(
          authCtx,
          { buffer: huge, originalname: "huge.csv", size: huge.length },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(PayloadTooLargeError);

      // CRITICAL: storage must NOT contain any file for this school's
      // imports directory after the rejection.
      const schoolImports = join(storageRoot, "schools", schoolId, "imports");
      let imports: string[] = [];
      try {
        const { readdirSync } = await import("node:fs");
        imports = readdirSync(schoolImports);
      } catch {
        // missing dir is fine — it confirms zero persisted
      }
      expect(imports).toEqual([]);

      // And no ImportJob row was persisted either
      const rows = await withTenant(schoolId, (db) =>
        db.importJob.findMany({ where: { schoolId } }),
      );
      expect(rows).toEqual([]);
    });

    it("non-owner/admin → ForbiddenError", async () => {
      const { schoolId } = await createActiveSchool("upload-forbid");
      const { authCtx: noRoleCtx } = await createUserWithoutRole(
        schoolId,
        "upload",
      );
      await expect(
        service.uploadStudents(
          noRoleCtx,
          { buffer: goodCsv, originalname: "x.csv", size: goodCsv.length },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  // -----------------------------------------------------------------------
  // applyMapping
  // -----------------------------------------------------------------------

  describe("applyMapping", () => {
    async function uploadHelper(suffix: string) {
      const { authCtx, schoolId } = await createActiveSchool(`map-${suffix}`);
      const r = await service.uploadStudents(
        authCtx,
        { buffer: goodCsv, originalname: "students.csv", size: goodCsv.length },
        reqCtx,
      );
      return { authCtx, schoolId, jobId: r.jobId };
    }

    const validMapping = {
      columnMapping: {
        "Adm No": "admissionNumber",
        "First Name": "firstName",
        Surname: "lastName",
        DOB: "dateOfBirth",
        Sex: "gender",
        Phone: "phone",
      },
      options: { dateFormat: "YYYY-MM-DD", treatBlankAs: "skip" },
    };

    it("happy path: flips status PENDING → VALIDATING, enqueues with schoolId from authCtx, writes audit", async () => {
      const { authCtx, schoolId, jobId } = await uploadHelper("happy");
      mockQueue.calls.length = 0;

      const result = await service.applyMapping(
        authCtx,
        jobId,
        validMapping,
        reqCtx,
      );
      expect(result).toEqual({ jobId, status: "VALIDATING" });

      const row = await withTenant(schoolId, (db) =>
        db.importJob.findUnique({ where: { id: jobId } }),
      );
      expect(row?.status).toBe("VALIDATING");
      expect(row?.columnMapping).toMatchObject({
        mapping: validMapping.columnMapping,
        options: validMapping.options,
      });

      expect(mockQueue.calls).toHaveLength(1);
      expect(mockQueue.calls[0]).toMatchObject({
        name: "validate",
        data: {
          schoolId,
          userId: authCtx.userId,
          jobId,
          type: "STUDENTS",
        },
        options: { jobId },
      });

      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { schoolId, action: "import.mapping", entityId: jobId },
        }),
      );
      expect(audit).toBeTruthy();
    });

    it("rejects a mapping missing required Student fields with MISSING_REQUIRED_MAPPING", async () => {
      const { authCtx, jobId } = await uploadHelper("missing-req");
      const incomplete = {
        columnMapping: {
          "Adm No": "admissionNumber",
          // missing firstName, lastName, dateOfBirth, gender
        },
      };
      await expect(
        service.applyMapping(authCtx, jobId, incomplete, reqCtx),
      ).rejects.toMatchObject({ code: "MISSING_REQUIRED_MAPPING" });
    });

    it("rejects a mapping that maps two CSV headers to the same target field", async () => {
      const { authCtx, jobId } = await uploadHelper("dup-target");
      const duplicate = {
        columnMapping: {
          "Adm No": "admissionNumber",
          "First Name": "firstName",
          Surname: "lastName",
          DOB: "dateOfBirth",
          Sex: "gender",
          Phone: "firstName", // duplicate target field
        },
      };
      await expect(
        service.applyMapping(authCtx, jobId, duplicate, reqCtx),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("rejects an unknown jobId with NotFoundError", async () => {
      const { authCtx } = await uploadHelper("notfound");
      await expect(
        service.applyMapping(
          authCtx,
          "00000000-0000-4000-8000-000000000000",
          validMapping,
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("rejects when the job is no longer in PENDING status (409 JOB_NOT_IN_PENDING_STATE)", async () => {
      const { authCtx, jobId } = await uploadHelper("not-pending");
      mockQueue.calls.length = 0;
      await service.applyMapping(authCtx, jobId, validMapping, reqCtx);
      // second call: status is now VALIDATING
      await expect(
        service.applyMapping(authCtx, jobId, validMapping, reqCtx),
      ).rejects.toMatchObject({ code: "JOB_NOT_IN_PENDING_STATE" });
    });
  });

  // -----------------------------------------------------------------------
  // getJob
  // -----------------------------------------------------------------------

  describe("getJob", () => {
    it("returns the job DTO with counts + null previewSnapshot in PENDING", async () => {
      const { authCtx } = await createActiveSchool("get-pending");
      const up = await service.uploadStudents(
        authCtx,
        { buffer: goodCsv, originalname: "g.csv", size: goodCsv.length },
        reqCtx,
      );
      const job = await service.getJob(authCtx, up.jobId);
      expect(job).toMatchObject({
        jobId: up.jobId,
        type: "STUDENTS",
        status: "PENDING",
        totalRows: 3,
        validRows: 0,
        invalidRows: 0,
        committedRows: 0,
        previewSnapshot: null,
        failedReason: null,
        completedAt: null,
      });
      expect(job.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("unknown id → NotFoundError", async () => {
      const { authCtx } = await createActiveSchool("get-nf");
      await expect(
        service.getJob(authCtx, "00000000-0000-4000-8000-000000000000"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // -----------------------------------------------------------------------
  // deleteJob
  // -----------------------------------------------------------------------

  describe("deleteJob", () => {
    it("deletes the row and removes the storage object", async () => {
      const { authCtx, schoolId } = await createActiveSchool("del-ok");
      const up = await service.uploadStudents(
        authCtx,
        { buffer: goodCsv, originalname: "g.csv", size: goodCsv.length },
        reqCtx,
      );
      const file = join(
        storageRoot,
        "schools",
        schoolId,
        "imports",
        up.jobId,
        "source.csv",
      );
      expect(statSync(file).size).toBeGreaterThan(0);

      await service.deleteJob(authCtx, up.jobId, reqCtx);

      const row = await withTenant(schoolId, (db) =>
        db.importJob.findUnique({ where: { id: up.jobId } }),
      );
      expect(row).toBeNull();
      expect(() => statSync(file)).toThrow();
    });

    it("rejects deletion of a VALIDATING job with 409 JOB_IN_PROGRESS", async () => {
      const { authCtx, schoolId } = await createActiveSchool("del-validating");
      const up = await service.uploadStudents(
        authCtx,
        { buffer: goodCsv, originalname: "g.csv", size: goodCsv.length },
        reqCtx,
      );
      await withTenant(schoolId, (db) =>
        db.importJob.update({
          where: { id: up.jobId },
          data: { status: "VALIDATING" },
        }),
      );
      await expect(
        service.deleteJob(authCtx, up.jobId, reqCtx),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  // -----------------------------------------------------------------------
  // triggerCommit — slice 7 cp1
  //
  // The service-layer state machine + enqueue contract. The worker logic
  // itself is covered in workers/commit.handler.spec.ts.
  // -----------------------------------------------------------------------

  describe("triggerCommit", () => {
    // Helper: land a job in READY with a synthetic snapshot. We bypass
    // the validate worker here because triggerCommit only cares about
    // status === READY; how the job got there is irrelevant to the
    // state-transition contract.
    async function landJobInReady(suffix: string) {
      const { authCtx, schoolId } = await createActiveSchool(`cmt-${suffix}`);
      const up = await service.uploadStudents(
        authCtx,
        { buffer: goodCsv, originalname: "g.csv", size: goodCsv.length },
        reqCtx,
      );
      await withTenant(schoolId, (db) =>
        db.importJob.update({
          where: { id: up.jobId },
          data: {
            status: "READY",
            validRows: 3,
            invalidRows: 0,
          },
        }),
      );
      return { authCtx, schoolId, jobId: up.jobId };
    }

    it("happy path: flips READY → COMMITTING, enqueues with schoolId from authCtx, writes audit", async () => {
      const { authCtx, schoolId, jobId } = await landJobInReady("happy");
      mockQueue.calls.length = 0;

      const result = await service.triggerCommit(authCtx, jobId, reqCtx);
      expect(result).toEqual({ jobId, status: "COMMITTING" });

      const row = await withTenant(schoolId, (db) =>
        db.importJob.findUnique({ where: { id: jobId } }),
      );
      expect(row?.status).toBe("COMMITTING");

      expect(mockQueue.calls).toHaveLength(1);
      expect(mockQueue.calls[0]).toMatchObject({
        name: "commit",
        data: {
          schoolId,
          userId: authCtx.userId,
          jobId,
          type: "STUDENTS",
        },
        // BullMQ id includes the "commit-" prefix to distinguish from the
        // validate enqueue (same ImportJob id is used for both jobs).
        options: { jobId: `commit-${jobId}` },
      });

      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { schoolId, action: "import.commit", entityId: jobId },
        }),
      );
      expect(audit).toBeTruthy();
      const meta = audit?.metadata as Record<string, unknown>;
      expect(meta).toMatchObject({ validRowsAtTrigger: 3 });
    });

    // User-specified edge case #1 — duplicate POST /commit back-to-back.
    // The first flips READY → COMMITTING; the second sees status =
    // COMMITTING and 409s. This is the SERVICE-layer guard; the worker
    // has its own status guard (tested in commit.handler.spec.ts) as a
    // second line of defence.
    it("duplicate commit returns 409 JOB_NOT_IN_READY_STATE on the second call", async () => {
      const { authCtx, jobId } = await landJobInReady("dup");
      mockQueue.calls.length = 0;

      await service.triggerCommit(authCtx, jobId, reqCtx);
      await expect(
        service.triggerCommit(authCtx, jobId, reqCtx),
      ).rejects.toMatchObject({ code: "JOB_NOT_IN_READY_STATE" });

      // Only the first enqueue went through
      expect(mockQueue.calls).toHaveLength(1);
    });

    it("rejects commit on a PENDING job with 409 JOB_NOT_IN_READY_STATE", async () => {
      const { authCtx } = await createActiveSchool("cmt-pending");
      const up = await service.uploadStudents(
        authCtx,
        { buffer: goodCsv, originalname: "g.csv", size: goodCsv.length },
        reqCtx,
      );
      // Job is in PENDING straight after upload
      await expect(
        service.triggerCommit(authCtx, up.jobId, reqCtx),
      ).rejects.toMatchObject({ code: "JOB_NOT_IN_READY_STATE" });
    });

    it("rejects an unknown jobId with NotFoundError", async () => {
      const { authCtx } = await createActiveSchool("cmt-nf");
      await expect(
        service.triggerCommit(
          authCtx,
          "00000000-0000-4000-8000-000000000000",
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("non-owner/admin → ForbiddenError", async () => {
      const { schoolId, jobId } = await landJobInReady("cmt-forbid");
      const { authCtx: noRoleCtx } = await createUserWithoutRole(
        schoolId,
        "cmt",
      );
      await expect(
        service.triggerCommit(noRoleCtx, jobId, reqCtx),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  // -----------------------------------------------------------------------
  // generateErrorReportCsv — slice 7 cp1
  // -----------------------------------------------------------------------

  describe("generateErrorReportCsv", () => {
    // Helper: land a job in COMPLETED with a persisted error report. We
    // bypass the commit worker for the simpler error-report tests since
    // we just need the row + the bytes — the worker is covered in
    // commit.handler.spec.ts.
    async function landJobInCompletedWithReport(suffix: string) {
      const { authCtx, schoolId } = await createActiveSchool(`err-${suffix}`);
      const up = await service.uploadStudents(
        authCtx,
        { buffer: goodCsv, originalname: "g.csv", size: goodCsv.length },
        reqCtx,
      );
      const reportBytes = Buffer.from(
        "Adm No,First Name,_errors\r\nADM/x,Ada,\"admissionNumber: collide\"\r\n",
        "utf-8",
      );
      const reportPath = await storage.put(
        schoolId,
        { kind: "import-error-report", jobId: up.jobId },
        reportBytes,
        "text/csv",
      );
      await withTenant(schoolId, (db) =>
        db.importJob.update({
          where: { id: up.jobId },
          data: {
            status: "COMPLETED",
            committedRows: 2,
            validRows: 3,
            invalidRows: 1,
            errorReportUrl: reportPath,
            completedAt: new Date(),
          },
        }),
      );
      return { authCtx, schoolId, jobId: up.jobId, reportBytes };
    }

    it("happy path: returns persisted bytes + filename + writes audit row", async () => {
      const { authCtx, schoolId, jobId, reportBytes } =
        await landJobInCompletedWithReport("happy");

      const { filename, content } = await service.generateErrorReportCsv(
        authCtx,
        jobId,
        reqCtx,
      );
      expect(filename).toBe(`import-${jobId}-error-report.csv`);
      expect(content.equals(reportBytes)).toBe(true);

      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: {
            schoolId,
            action: "import.error-report.download",
            entityId: jobId,
          },
        }),
      );
      expect(audit).toBeTruthy();
      const meta = audit?.metadata as Record<string, unknown>;
      expect(meta).toMatchObject({ sizeBytes: reportBytes.length });
    });

    it("rejects with 409 JOB_NOT_COMPLETED when status is not COMPLETED", async () => {
      const { authCtx } = await createActiveSchool("err-not-completed");
      const up = await service.uploadStudents(
        authCtx,
        { buffer: goodCsv, originalname: "g.csv", size: goodCsv.length },
        reqCtx,
      );
      // Job is in PENDING straight after upload
      await expect(
        service.generateErrorReportCsv(authCtx, up.jobId, reqCtx),
      ).rejects.toMatchObject({ code: "JOB_NOT_COMPLETED" });
    });

    it("rejects with 409 NO_ERROR_REPORT when the import completed cleanly", async () => {
      const { authCtx, schoolId } = await createActiveSchool("err-no-report");
      const up = await service.uploadStudents(
        authCtx,
        { buffer: goodCsv, originalname: "g.csv", size: goodCsv.length },
        reqCtx,
      );
      await withTenant(schoolId, (db) =>
        db.importJob.update({
          where: { id: up.jobId },
          data: {
            status: "COMPLETED",
            committedRows: 3,
            validRows: 3,
            invalidRows: 0,
            errorReportUrl: null, // clean import — no report
            completedAt: new Date(),
          },
        }),
      );
      await expect(
        service.generateErrorReportCsv(authCtx, up.jobId, reqCtx),
      ).rejects.toMatchObject({ code: "NO_ERROR_REPORT" });
    });

    it("rejects with 409 ERROR_REPORT_MISSING when the storage object is gone", async () => {
      const { authCtx, schoolId, jobId } =
        await landJobInCompletedWithReport("err-gone");
      // Delete the report bytes out from under the row.
      await storage.delete(schoolId, { kind: "import-error-report", jobId });
      await expect(
        service.generateErrorReportCsv(authCtx, jobId, reqCtx),
      ).rejects.toMatchObject({ code: "ERROR_REPORT_MISSING" });
    });

    it("rejects an unknown jobId with NotFoundError", async () => {
      const { authCtx } = await createActiveSchool("err-nf");
      await expect(
        service.generateErrorReportCsv(
          authCtx,
          "00000000-0000-4000-8000-000000000000",
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // -----------------------------------------------------------------------
  // getJob — hasErrorReport projection (slice 7 cp1)
  // -----------------------------------------------------------------------

  describe("getJob hasErrorReport projection", () => {
    it("hasErrorReport is false when errorReportUrl is null", async () => {
      const { authCtx } = await createActiveSchool("hasrep-false");
      const up = await service.uploadStudents(
        authCtx,
        { buffer: goodCsv, originalname: "g.csv", size: goodCsv.length },
        reqCtx,
      );
      const job = await service.getJob(authCtx, up.jobId);
      expect(job.hasErrorReport).toBe(false);
    });

    it("hasErrorReport is true after the row gains an errorReportUrl", async () => {
      const { authCtx, schoolId } = await createActiveSchool("hasrep-true");
      const up = await service.uploadStudents(
        authCtx,
        { buffer: goodCsv, originalname: "g.csv", size: goodCsv.length },
        reqCtx,
      );
      await withTenant(schoolId, (db) =>
        db.importJob.update({
          where: { id: up.jobId },
          data: {
            status: "COMPLETED",
            errorReportUrl: `schools/${schoolId}/imports/${up.jobId}/error-report.csv`,
            completedAt: new Date(),
          },
        }),
      );
      const job = await service.getJob(authCtx, up.jobId);
      expect(job.hasErrorReport).toBe(true);
      // The path itself is NOT exposed in the DTO; only the boolean is.
      expect((job as unknown as Record<string, unknown>).errorReportUrl).toBeUndefined();
    });
  });
});
