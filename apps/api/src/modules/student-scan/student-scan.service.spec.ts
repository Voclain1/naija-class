import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { AiCallRequest, AiCallResult, AnthropicPort } from "@school-kit/ai";
import { basePrisma, withTenant } from "@school-kit/db";

import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import type { AuthContext } from "../../common/auth/auth-context.js";
import { StudentScanService } from "./student-scan.service.js";

// Integration suite against real Postgres, with the Anthropic side faked.
//
// What this suite is actually for, in priority order:
//   1. THE HUMAN GATE (D4). An extraction must not create a single Student
//      row. That is the feature's central promise and the one a future
//      refactor could most plausibly break while everything still "works".
//   2. THE IMAGE IS NEVER PERSISTED (D3). Asserted structurally, because
//      "we didn't write it anywhere" is otherwise only ever true by
//      inspection.
//   3. Provenance (aiExtracted) and the commit's re-validation of rows the
//      client has been editing.

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

function extraction(rows: unknown[], pageNotes: string | null = null) {
  return JSON.stringify({ rows, pageNotes });
}

function row(over: Record<string, unknown> = {}) {
  return {
    admissionNumber: "SK/2026/001",
    firstName: "Chukwuemeka",
    middleName: null,
    lastName: "Okafor",
    dateOfBirth: "2015-03-04",
    gender: "MALE",
    classArm: null,
    guardianName: null,
    guardianPhone: null,
    unreadableFields: [],
    ...over,
  };
}

class FakePort implements AnthropicPort {
  calls: AiCallRequest[] = [];
  text = extraction([row()]);
  behaviour: "ok" | "throw" | "badJson" = "ok";

  async create(req: AiCallRequest): Promise<AiCallResult> {
    this.calls.push(req);
    if (this.behaviour === "throw") throw new Error("simulated upstream failure");
    return {
      text: this.behaviour === "badJson" ? "Sorry, I can't read that." : this.text,
      inputTokens: 5_600,
      outputTokens: 300,
      stopReason: "end_turn",
    };
  }
}

const configStub = () => ({ get: () => undefined }) as unknown as ConfigService;

const runId = Math.random().toString(36).slice(2, 8);
let schoolId: string;
let userId: string;
let authCtx: AuthContext;
const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };

describe("StudentScanService", () => {
  let port: FakePort;
  let service: StudentScanService;

  beforeEach(async () => {
    port = new FakePort();
    service = new StudentScanService(new AiGenerationService(configStub(), port));

    if (schoolId) {
      // Each test starts from an empty roster so admission-number collisions
      // between tests cannot masquerade as the behaviour under test.
      await withTenant(schoolId, async (db) => {
        await db.enrollment.deleteMany({ where: { schoolId } });
        await db.student.deleteMany({ where: { schoolId } });
        await db.importJob.deleteMany({ where: { schoolId } });
        // The ledger and budget counter reset too, so a test can assert on
        // "the generation this test caused" rather than on a running total
        // that depends on which tests ran before it.
        await db.aIGeneration.deleteMany({ where: { schoolId } });
        await db.aIBudgetPeriod.deleteMany({ where: { schoolId } });
        await db.auditLog.deleteMany({ where: { schoolId } });
      });
      return;
    }

    const school = await basePrisma.school.create({
      data: {
        name: `Scan ${runId}`,
        slug: `scan-${runId}`,
        aiMonthlyTokenBudget: 5_000_000,
        // Explicit: School.aiEnabled defaults FALSE, and every extraction
        // here goes through reserve(), which throws DISABLED_SCHOOL when it
        // is off. AI being on is a precondition of what this suite tests.
        aiEnabled: true,
      },
      select: { id: true },
    });
    schoolId = school.id;

    await withTenant(schoolId, async (db) => {
      const user = await db.user.create({
        data: { schoolId, email: `scan-${runId}@t.test`, firstName: "Scan", lastName: "Admin" },
        select: { id: true },
      });
      userId = user.id;

      // A REAL admin grant, not a stubbed authCtx. assertUserActiveAndHasOneOf
      // re-reads the user and their role rows from the database on every call
      // (CLAUDE.md: "never trust the JWT subject alone for mutations"), so a
      // hand-built context with roles: ["admin"] on it proves nothing — the
      // service never looks at that field. Seeding the grant is what makes
      // these tests exercise the same authorisation path production does.
      const role = await db.role.findFirst({
        where: { key: "admin", isSystem: true },
        select: { id: true },
      });
      if (!role) throw new Error("system `admin` role missing — run `pnpm db:seed`");
      await db.userRole.create({ data: { userId, roleId: role.id } });
    });

    authCtx = { schoolId, userId } as unknown as AuthContext;
  });

  afterAll(async () => {
    if (!schoolId) return;
    await withTenant(schoolId, async (db) => {
      await db.enrollment.deleteMany({ where: { schoolId } });
      await db.student.deleteMany({ where: { schoolId } });
      await db.importJob.deleteMany({ where: { schoolId } });
      await db.auditLog.deleteMany({ where: { schoolId } });
      await db.aIGeneration.deleteMany({ where: { schoolId } });
      await db.aIBudgetPeriod.deleteMany({ where: { schoolId } });
    });
    await basePrisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
  });

  const upload = (buffer = PNG_1x1) => ({
    buffer,
    originalname: "register.png",
    size: buffer.length,
    mimetype: "image/png",
  });

  // -------------------------------------------------------------------------
  // D4 — the human gate.
  // -------------------------------------------------------------------------
  it("creates NO student rows when extracting — only a draft job", async () => {
    port.text = extraction([row(), row({ admissionNumber: "SK/2026/002", firstName: "Adaeze" })]);

    const result = await service.extractFromImage(authCtx, upload(), reqCtx);

    expect(result.rows).toHaveLength(2);

    // The assertion the whole feature rests on. If a future refactor ever
    // "helpfully" commits high-confidence rows automatically, this fails.
    const students = await withTenant(schoolId, (db) => db.student.count({ where: { schoolId } }));
    expect(students).toBe(0);

    const job = await withTenant(schoolId, (db) =>
      db.importJob.findUnique({ where: { id: result.jobId } }),
    );
    expect(job?.type).toBe("STUDENTS_SCAN");
    expect(job?.status).toBe("READY");
    expect(job?.committedRows).toBe(0);
  });

  // -------------------------------------------------------------------------
  // D3 — the image is never persisted.
  // -------------------------------------------------------------------------
  it("stores no reference to the captured image anywhere on the job", async () => {
    const result = await service.extractFromImage(authCtx, upload(), reqCtx);

    const job = await withTenant(schoolId, (db) =>
      db.importJob.findUnique({ where: { id: result.jobId } }),
    );

    // No storage key, no path, no data URI. A CSV import job points at its
    // source object here; a scan has nothing to point at, by design.
    expect(job?.sourceFileUrl).toBe("");
    expect(job?.errorReportUrl).toBeNull();

    // And the base64 payload must not have leaked into the preview snapshot,
    // which IS persisted. Serialising the whole row and searching it catches
    // the payload wherever it might have been tucked.
    const serialised = JSON.stringify(job);
    expect(serialised).not.toContain(PNG_1x1.toString("base64"));
  });

  it("keeps extracted PII out of the audit log", async () => {
    port.text = extraction([row({ firstName: "Chukwuemeka", guardianPhone: "08031234567" })]);
    const result = await service.extractFromImage(authCtx, upload(), reqCtx);

    const audits = await withTenant(schoolId, (db) =>
      db.auditLog.findMany({ where: { schoolId, entityId: result.jobId } }),
    );
    const serialised = JSON.stringify(audits);

    // Audit rows are read by a wider audience than the review screen. Counts
    // answer "who scanned what, when" without copying a page of children's
    // details into a second place.
    expect(serialised).not.toContain("Chukwuemeka");
    expect(serialised).not.toContain("08031234567");
    expect(serialised).not.toContain("SK/2026/001");
    expect(audits.some((a) => a.action === "student.scan")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // The AI call itself.
  // -------------------------------------------------------------------------
  it("sends the image to the model and writes a ledger row", async () => {
    await service.extractFromImage(authCtx, upload(), reqCtx);

    expect(port.calls).toHaveLength(1);
    const call = port.calls[0];
    expect(call.images).toHaveLength(1);
    expect(call.images?.[0].mediaType).toBe("image/png");
    expect(call.images?.[0].base64).toBe(PNG_1x1.toString("base64"));
    // Dimensions must be decoded, not defaulted — they are what the budget
    // reservation prices the image on.
    expect(call.images?.[0].widthPx).toBe(1);
    expect(call.images?.[0].heightPx).toBe(1);

    const ledger = await withTenant(schoolId, (db) =>
      db.aIGeneration.findMany({ where: { schoolId } }),
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0].promptName).toBe("student-list-extraction");
    expect(ledger[0].success).toBe(true);
  });

  it("rejects a payload whose bytes are not an image, before spending anything", async () => {
    const pdf = Buffer.from("%PDF-1.7 not really a photo");
    await expect(
      service.extractFromImage(authCtx, { ...upload(pdf), mimetype: "image/jpeg" }, reqCtx),
    ).rejects.toThrow(/not a JPEG, PNG or WebP/i);

    // The declared Content-Type said image/jpeg. Trusting it would have sent
    // a PDF to a third party and burned the school's budget on a guaranteed
    // failure.
    expect(port.calls).toHaveLength(0);
  });

  it("surfaces an unreadable extraction as an error rather than an empty draft", async () => {
    port.behaviour = "badJson";
    await expect(service.extractFromImage(authCtx, upload(), reqCtx)).rejects.toThrow();

    const jobs = await withTenant(schoolId, (db) => db.importJob.count({ where: { schoolId } }));
    expect(jobs).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Commit — D4's gate in the other direction.
  // -------------------------------------------------------------------------
  it("commits the ADMIN's corrected rows, not the model's extraction", async () => {
    // The model misread the surname; the admin fixed it in the grid. What
    // reaches the database must be the correction.
    port.text = extraction([row({ lastName: "Okafo" })]);
    const { jobId } = await service.extractFromImage(authCtx, upload(), reqCtx);

    const result = await service.commitScan(
      authCtx,
      jobId,
      {
        rows: [
          {
            rowNumber: 1,
            admissionNumber: "SK/2026/001",
            firstName: "Chukwuemeka",
            lastName: "Okafor",
            dateOfBirth: "2015-03-04",
            gender: "MALE",
          },
        ],
      },
      reqCtx,
    );

    expect(result.committedRows).toBe(1);
    const student = await withTenant(schoolId, (db) =>
      db.student.findFirst({ where: { schoolId } }),
    );
    expect(student?.lastName).toBe("Okafor");
    // Provenance: cheap now, impossible to retrofit later.
    expect(student?.aiExtracted).toBe(true);
    // And the calendar date must survive the string -> Date conversion
    // without drifting a day in either direction.
    expect(student?.dateOfBirth.toISOString().slice(0, 10)).toBe("2015-03-04");
  });

  it("refuses a batch with duplicate admission numbers and names both rows", async () => {
    const { jobId } = await service.extractFromImage(authCtx, upload(), reqCtx);

    await expect(
      service.commitScan(
        authCtx,
        jobId,
        {
          rows: [
            { rowNumber: 1, admissionNumber: "SK/2026/009", firstName: "A", lastName: "B", dateOfBirth: "2015-01-01", gender: "MALE" },
            { rowNumber: 5, admissionNumber: "SK/2026/009", firstName: "C", lastName: "D", dateOfBirth: "2015-01-01", gender: "FEMALE" },
          ],
        },
        reqCtx,
      ),
    ).rejects.toThrow(/share an admission number/i);

    // Nothing partially written: the admin fixes the grid and resubmits.
    const students = await withTenant(schoolId, (db) => db.student.count({ where: { schoolId } }));
    expect(students).toBe(0);
  });

  it("commits good rows and reports bad ones rather than losing the page", async () => {
    const { jobId } = await service.extractFromImage(authCtx, upload(), reqCtx);
    await withTenant(schoolId, (db) =>
      db.student.create({
        data: {
          schoolId,
          admissionNumber: "SK/2026/TAKEN",
          firstName: "Existing",
          lastName: "Student",
          dateOfBirth: new Date(Date.UTC(2014, 0, 1)),
          gender: "FEMALE",
        },
      }),
    );

    const result = await service.commitScan(
      authCtx,
      jobId,
      {
        rows: [
          { rowNumber: 1, admissionNumber: "SK/2026/NEW", firstName: "Ngozi", lastName: "Eze", dateOfBirth: "2015-02-02", gender: "FEMALE" },
          { rowNumber: 2, admissionNumber: "SK/2026/TAKEN", firstName: "Clash", lastName: "Row", dateOfBirth: "2015-03-03", gender: "MALE" },
        ],
      },
      reqCtx,
    );

    // An admin who has just reviewed forty rows should not lose thirty-nine
    // of them to one collision.
    expect(result.committedRows).toBe(1);
    expect(result.failedRows).toHaveLength(1);
    expect(result.failedRows[0].rowNumber).toBe(2);
  });

  it("refuses to commit the same scan twice", async () => {
    const { jobId } = await service.extractFromImage(authCtx, upload(), reqCtx);
    const rows = [
      { rowNumber: 1, admissionNumber: "SK/2026/ONCE", firstName: "One", lastName: "Time", dateOfBirth: "2015-04-04", gender: "MALE" as const },
    ];

    await service.commitScan(authCtx, jobId, { rows }, reqCtx);
    await expect(service.commitScan(authCtx, jobId, { rows }, reqCtx)).rejects.toThrow(
      /already been committed/i,
    );

    const students = await withTenant(schoolId, (db) => db.student.count({ where: { schoolId } }));
    expect(students).toBe(1);
  });

  it("refuses to commit a CSV import job through the scan endpoint", async () => {
    // The mirror of the guard added to ImportsService.triggerCommit. Both
    // directions have to be closed: a scan must not commit through the CSV
    // path (that would commit the model's rows, bypassing the human gate),
    // and a CSV job must not commit through this one (that would accept
    // client-supplied rows for a job that has a validated source file).
    const csvJobId = await withTenant(schoolId, async (db) => {
      const job = await db.importJob.create({
        data: {
          schoolId,
          type: "STUDENTS",
          status: "READY",
          sourceFileUrl: "schools/x/imports/y/source.csv",
          createdBy: userId,
        },
        select: { id: true },
      });
      return job.id;
    });

    await expect(
      service.commitScan(
        authCtx,
        csvJobId,
        {
          rows: [
            { rowNumber: 1, admissionNumber: "SK/X", firstName: "A", lastName: "B", dateOfBirth: "2015-01-01", gender: "MALE" },
          ],
        },
        reqCtx,
      ),
    ).rejects.toThrow(/not a scan/i);
  });
});
