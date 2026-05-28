import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Job, UnrecoverableError } from "bullmq";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import { FilesystemStorageDriver } from "../../../common/storage/filesystem-storage.driver";
import { StorageService } from "../../../common/storage/storage.service";
import { AuthService } from "../../auth/auth.service";
import { ImportsService, type ValidateJobData } from "../imports.service";
import { ImportsProcessor } from "./imports.processor";

// Integration spec for the cp3 validate processor.
//
// The worker is constructed directly (not through BullMQ) and `process()`
// is invoked with a synthetic Job. The DB + storage are real. The
// validate-engine logic runs end-to-end against a deliberately messy
// fixture CSV that exercises every rule we care about:
//
//   - valid rows (canonical happy path)
//   - in-file dedup (second occurrence flagged "Duplicate with row N")
//   - external dedup (admission already in roster → flagged)
//   - missing required field
//   - invalid date for the chosen dateFormat
//   - format-dependent date parsed per the configured dateFormat
//   - invalid gender value
//   - blank middle row → skipped, doesn't count, doesn't appear in bad
//   - leading/trailing whitespace → trimmed silently (soft, not error)
//   - UTF-8 BOM at file start → stripped on parse (Excel-saved CSV)
//
// Row numbering is asserted exactly: header is row 0 in our convention,
// first data row is row 1, blank rows STILL occupy a row number (so the
// rowNumber matches each row's position relative to the header).

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00)
    .toString()
    .padStart(8, "0");
  return `+23467${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
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

// Synthetic Job wrapper — only the fields the processor reads.
function fakeJob(data: ValidateJobData): Job<ValidateJobData> {
  return {
    id: `test-${Math.random().toString(36).slice(2, 8)}`,
    name: "validate",
    data,
    queueName: "imports",
    attemptsMade: 0,
    opts: { attempts: 3 },
  } as unknown as Job<ValidateJobData>;
}

describe("ImportsProcessor — validate handler (slice 6 cp3)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const schoolIdsToCleanup = new Set<string>();
  let storageRoot: string;
  let storage: StorageService;
  let mockQueue: ReturnType<typeof makeMockQueue>;
  let importsService: ImportsService;
  let processor: ImportsProcessor;

  beforeAll(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "schoolkit-validate-spec-"));
    const driver = new FilesystemStorageDriver(storageRoot);
    storage = new StorageService(driver);
    mockQueue = makeMockQueue();
    importsService = new ImportsService(storage, mockQueue as never);
    processor = new ImportsProcessor(storage);
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
        schoolName: `Validate Spec ${suffix}`,
        schoolSlug: `val-${suffix}-${runId}`,
        ownerFirstName: "Olu",
        ownerLastName: "Owner",
        ownerEmail: `validate-${suffix}-${runId}@example.test`,
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

  // -----------------------------------------------------------------------
  // The messy fixture.
  //
  // Row numbers (header is row 0, first data row is row 1; blank rows
  // still consume a rowNumber slot but DO NOT contribute to totalRows or
  // to good/bad):
  //   1: valid             ADM/001 Ada Okafor 15/03/2014 Female
  //   2: valid             ADM/002 Tunde Bello 01/09/2013 M
  //   3: dup with row 1    ADM/001 (also a copy)
  //   4: missing lastName  ADM/004 Chi (blank) 20/01/2015 F
  //   5: invalid date      ADM/005 Bola Adeyemi 13/45/2020 M
  //   6: format-dependent  ADM/006 Ifeoma Eze 05/06/2014 F → parses as 5 June (DD/MM)
  //   7: invalid gender    ADM/007 Yusuf Bala 11/11/2014 X
  //   8: blank row         (skipped — does not produce good or bad)
  //   9: whitespace        ADM/009 "  Tomi  " "  Kola  " 02/02/2014 M
  //  10: external dup      ADM/EXISTS Mary Smith 03/03/2014 F → "already exists"
  //
  // evaluatedRowCount (= ImportJob.totalRows after validate) is 9 — the
  // blank row at row 8 is the only one skipped. RowNumber is still 10
  // for the last entry because rowNumbers count source-CSV position
  // (not "Nth non-blank row").
  // -----------------------------------------------------------------------
  const messyCsv = [
    "Adm No,First Name,Surname,DOB,Sex,Phone",
    "ADM/001,Ada,Okafor,15/03/2014,Female,+2348012345678",
    "ADM/002,Tunde,Bello,01/09/2013,M,",
    "ADM/001,AdaCopy,Okafor,15/03/2014,Female,+2348012345678",
    "ADM/004,Chi,,20/01/2015,F,",
    "ADM/005,Bola,Adeyemi,13/45/2020,M,",
    "ADM/006,Ifeoma,Eze,05/06/2014,F,",
    "ADM/007,Yusuf,Bala,11/11/2014,X,",
    "",
    "ADM/009,  Tomi  ,  Kola  ,02/02/2014,M,",
    "ADM/EXISTS,Mary,Smith,03/03/2014,F,",
  ].join("\r\n");

  const mapping = {
    columnMapping: {
      "Adm No": "admissionNumber",
      "First Name": "firstName",
      Surname: "lastName",
      DOB: "dateOfBirth",
      Sex: "gender",
      Phone: "phone",
    },
    options: {
      dateFormat: "DD/MM/YYYY" as const,
      treatBlankAs: "skip" as const,
    },
  };

  async function uploadAndMapMessy(
    suffix: string,
    csvText: string = messyCsv,
  ) {
    const { authCtx, schoolId, userId } = await createActiveSchool(suffix);

    // Pre-seed ADM/EXISTS in the roster so external dedup has something
    // to find. This row is independent of the upload and lives in the
    // students table.
    await withTenant(schoolId, async (db) => {
      await db.student.create({
        data: {
          schoolId,
          admissionNumber: "ADM/EXISTS",
          firstName: "ExistingMary",
          lastName: "Smith",
          dateOfBirth: new Date("2014-03-03"),
          gender: "FEMALE",
        },
      });
    });

    const buffer = Buffer.from(csvText, "utf-8");
    const uploaded = await importsService.uploadStudents(
      authCtx,
      { buffer, originalname: "messy.csv", size: buffer.length },
      reqCtx,
    );
    await importsService.applyMapping(authCtx, uploaded.jobId, mapping, reqCtx);

    return {
      authCtx,
      schoolId,
      userId,
      jobId: uploaded.jobId,
    };
  }

  // -----------------------------------------------------------------------
  // Engine + processor end-to-end on the messy fixture
  // -----------------------------------------------------------------------
  describe("happy + messy run", () => {
    it("flips PENDING → VALIDATING → READY with the expected good/bad split + rowNumbers + errors", async () => {
      const { schoolId, userId, jobId } = await uploadAndMapMessy("messy");

      await processor.process(
        fakeJob({ schoolId, userId, jobId, type: "STUDENTS" }),
      );

      const row = await withTenant(schoolId, (db) =>
        db.importJob.findUnique({ where: { id: jobId } }),
      );
      expect(row?.status).toBe("READY");

      // Expected split for the messy fixture:
      //   good:   row 1 (ADM/001), row 2 (ADM/002), row 6 (ADM/006),
      //           row 9 (ADM/009)        → 4 valid
      //   bad:    row 3 (dup with 1), row 4 (missing lastName),
      //           row 5 (invalid date),  row 7 (invalid gender),
      //           row 10 (ADM/EXISTS already in roster)
      //                                 → 5 invalid
      //   skipped (blank line):       row 8
      //   totalRows: 9 (rows 1–7 + 9 + 10 evaluated; blank row 8 excluded)
      expect(row?.validRows).toBe(4);
      expect(row?.invalidRows).toBe(5);
      expect(row?.totalRows).toBe(9);

      const snapshot = row?.previewSnapshot as {
        good: { rowNumber: number; parsedRow: Record<string, unknown> }[];
        bad: {
          rowNumber: number;
          csvRow: Record<string, string>;
          errors: { field: string; message: string }[];
        }[];
      };

      const goodRowNumbers = snapshot.good.map((g) => g.rowNumber);
      const badRowNumbers = snapshot.bad.map((b) => b.rowNumber);
      expect(goodRowNumbers).toEqual([1, 2, 6, 9]);
      expect(badRowNumbers).toEqual([3, 4, 5, 7, 10]);

      // Row 3 — duplicate admission number with row 1
      const row3 = snapshot.bad.find((b) => b.rowNumber === 3);
      expect(row3?.errors[0]).toMatchObject({
        field: "admissionNumber",
        message: expect.stringMatching(/Duplicate admission number with row 1/i),
      });

      // Row 4 — missing lastName surfaces as Zod's "last name required"
      const row4 = snapshot.bad.find((b) => b.rowNumber === 4);
      expect(row4?.errors.some((e) => e.field === "lastName")).toBe(true);

      // Row 5 — invalid date for DD/MM/YYYY
      const row5 = snapshot.bad.find((b) => b.rowNumber === 5);
      expect(row5?.errors[0]).toMatchObject({
        field: "dateOfBirth",
        message: expect.stringMatching(/could not parse '13\/45\/2020'/i),
      });

      // Row 7 — invalid gender value 'X'
      const row7 = snapshot.bad.find((b) => b.rowNumber === 7);
      expect(row7?.errors[0]).toMatchObject({
        field: "gender",
        message: expect.stringMatching(/not a recognised gender/i),
      });

      // Row 10 — external dedup
      const row10 = snapshot.bad.find((b) => b.rowNumber === 10);
      expect(row10?.errors[0]).toMatchObject({
        field: "admissionNumber",
        message: expect.stringMatching(/already exists/i),
      });

      // Row 6 — format-dependent date "05/06/2014" under DD/MM/YYYY = 5 June
      const row6 = snapshot.good.find((g) => g.rowNumber === 6);
      expect(row6?.parsedRow.dateOfBirth).toBe("2014-06-05");

      // Row 9 — whitespace trimmed silently (not an error)
      const row9 = snapshot.good.find((g) => g.rowNumber === 9);
      expect(row9?.parsedRow.firstName).toBe("Tomi");
      expect(row9?.parsedRow.lastName).toBe("Kola");
    });

    it("strips the UTF-8 BOM at the start of a file (Excel-saved CSV)", async () => {
      const bomCsv =
        "﻿" +
        [
          "Adm No,First Name,Surname,DOB,Sex",
          "ADM/BOM,Ada,Okafor,15/03/2014,F",
        ].join("\r\n");
      const { schoolId, userId, jobId } = await uploadAndMapMessy("bom", bomCsv);

      await processor.process(
        fakeJob({ schoolId, userId, jobId, type: "STUDENTS" }),
      );

      const row = await withTenant(schoolId, (db) =>
        db.importJob.findUnique({ where: { id: jobId } }),
      );
      expect(row?.status).toBe("READY");
      // The BOM in front of "Adm No" must NOT survive — if it had, the
      // mapping would key "﻿Adm No" and the row would be bad.
      expect(row?.validRows).toBe(1);
      expect(row?.invalidRows).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Idempotency + skip cases
  // -----------------------------------------------------------------------
  describe("idempotency", () => {
    it("skips silently when the job is no longer in VALIDATING", async () => {
      const { schoolId, userId, jobId } = await uploadAndMapMessy("idem");
      await processor.process(
        fakeJob({ schoolId, userId, jobId, type: "STUDENTS" }),
      );
      // First pass landed READY. Second pass should be a no-op (status
      // guard), NOT throw.
      await expect(
        processor.process(
          fakeJob({ schoolId, userId, jobId, type: "STUDENTS" }),
        ),
      ).resolves.toBeUndefined();
    });

    it("skips silently if the ImportJob row no longer exists", async () => {
      const { schoolId, userId } = await createActiveSchool("gone");
      await expect(
        processor.process(
          fakeJob({
            schoolId,
            userId,
            jobId: "00000000-0000-4000-8000-000000000000",
            type: "STUDENTS",
          }),
        ),
      ).resolves.toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Retryable vs fatal
  // -----------------------------------------------------------------------
  describe("retryable vs fatal", () => {
    it("source.csv missing → UnrecoverableError (BullMQ skips retries)", async () => {
      const { schoolId, userId, jobId } = await uploadAndMapMessy("fatal");
      // Delete the storage object out from under the worker.
      await storage.deleteImportPrefix(schoolId, jobId);

      await expect(
        processor.process(
          fakeJob({ schoolId, userId, jobId, type: "STUDENTS" }),
        ),
      ).rejects.toBeInstanceOf(UnrecoverableError);
    });
  });

  // -----------------------------------------------------------------------
  // onFailed listener
  // -----------------------------------------------------------------------
  describe("onFailed listener", () => {
    it("writes status=FAILED with a reason on UnrecoverableError", async () => {
      const { schoolId, userId, jobId } = await uploadAndMapMessy("onfail-fatal");
      const job = fakeJob({ schoolId, userId, jobId, type: "STUDENTS" });
      const err = new UnrecoverableError("source missing");
      await processor.onFailed(job, err);

      const row = await withTenant(schoolId, (db) =>
        db.importJob.findUnique({ where: { id: jobId } }),
      );
      expect(row?.status).toBe("FAILED");
      expect(row?.failedReason).toMatch(/Fatal: source missing/);
    });

    it("does NOT write FAILED while retries remain (transient error, attempts < max)", async () => {
      const { schoolId, userId, jobId } = await uploadAndMapMessy("onfail-retry");
      const job = fakeJob({ schoolId, userId, jobId, type: "STUDENTS" });
      // 1 attempt made out of 3 — should NOT mark failed yet.
      (job as unknown as { attemptsMade: number }).attemptsMade = 1;
      const err = new Error("redis blip");
      await processor.onFailed(job, err);

      const row = await withTenant(schoolId, (db) =>
        db.importJob.findUnique({ where: { id: jobId } }),
      );
      // Still VALIDATING — neither the worker nor the listener flipped it.
      expect(row?.status).toBe("VALIDATING");
    });

    it("writes FAILED when retries are exhausted (attemptsMade === max)", async () => {
      const { schoolId, userId, jobId } = await uploadAndMapMessy("onfail-exhausted");
      const job = fakeJob({ schoolId, userId, jobId, type: "STUDENTS" });
      (job as unknown as { attemptsMade: number }).attemptsMade = 3;
      const err = new Error("db unreachable");
      await processor.onFailed(job, err);

      const row = await withTenant(schoolId, (db) =>
        db.importJob.findUnique({ where: { id: jobId } }),
      );
      expect(row?.status).toBe("FAILED");
      expect(row?.failedReason).toMatch(/Retries exhausted: db unreachable/);
    });
  });

  // -----------------------------------------------------------------------
  // bad-rows.csv via the service
  // -----------------------------------------------------------------------
  describe("generateBadRowsCsv", () => {
    it("re-streams, emits original headers + _errors column, writes audit row", async () => {
      const { authCtx, schoolId, userId, jobId } = await uploadAndMapMessy("badrows");
      await processor.process(
        fakeJob({ schoolId, userId, jobId, type: "STUDENTS" }),
      );

      const { filename, content } = await importsService.generateBadRowsCsv(
        authCtx,
        jobId,
        reqCtx,
      );
      expect(filename).toBe(`import-${jobId}-bad-rows.csv`);

      const text = content.toString("utf-8");
      const lines = text.split("\r\n").filter((l) => l.length > 0);
      // header + 5 bad rows
      expect(lines.length).toBe(6);
      expect(lines[0]).toBe("Adm No,First Name,Surname,DOB,Sex,Phone,_errors");

      // Row 3 (duplicate) — source content preserved verbatim
      expect(lines[1]).toMatch(/^ADM\/001,AdaCopy,Okafor,15\/03\/2014,Female/);
      expect(lines[1]).toMatch(/Duplicate admission number with row 1/);

      // Row 4 (missing lastName) — source row has empty lastName cell
      expect(lines[2]).toMatch(/^ADM\/004,Chi,,20\/01\/2015,F/);
      expect(lines[2]).toMatch(/lastName/);

      // Row 5 (invalid date)
      expect(lines[3]).toMatch(/^ADM\/005,Bola,Adeyemi,13\/45\/2020,M/);
      expect(lines[3]).toMatch(/could not parse '13\/45\/2020'/);

      // Row 7 (invalid gender)
      expect(lines[4]).toMatch(/^ADM\/007,Yusuf,Bala,11\/11\/2014,X/);
      expect(lines[4]).toMatch(/not a recognised gender/);

      // Row 10 (external dedup)
      expect(lines[5]).toMatch(/^ADM\/EXISTS,Mary,Smith/);
      expect(lines[5]).toMatch(/Already exists in roster/);

      // Audit row — NDPR PII export
      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: {
            schoolId,
            action: "import.bad-rows.download",
            entityId: jobId,
          },
        }),
      );
      expect(audit).toBeTruthy();
      const meta = audit?.metadata as Record<string, unknown>;
      expect(meta).toMatchObject({ badRowCount: 5, totalRows: 9 });
    });

    it("rejects download while job is VALIDATING (409 JOB_NOT_VALIDATED)", async () => {
      const { authCtx, jobId } = await uploadAndMapMessy("badrows-validating");
      // Don't invoke processor — leave the job in VALIDATING.
      await expect(
        importsService.generateBadRowsCsv(authCtx, jobId, reqCtx),
      ).rejects.toMatchObject({ code: "JOB_NOT_VALIDATED" });
    });
  });
});
