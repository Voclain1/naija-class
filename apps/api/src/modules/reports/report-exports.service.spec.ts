import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ExcelJS from "exceljs";
import type { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { NotFoundError, type CompletenessReportDto, type TeacherActivityReportDto } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { REPORT_CARDS_JOB_EXPORT_PDF } from "../../common/queue";
import { FilesystemStorageDriver } from "../../common/storage/filesystem-storage.driver";
import { StorageService } from "../../common/storage/storage.service";
import { AuthService } from "../auth/auth.service";
import type { BrowserPool } from "../report-cards/render/browser-pool";
import { ExportPdfService } from "../report-cards/render/export-pdf.service";
import type { CompletenessService } from "./completeness.service";
import { ReportExportSweeperService } from "./report-export-sweeper.service";
import { ReportExportsService } from "./report-exports.service";

// Phase 9 / CP1.1 — report exports against a REAL Postgres
// (docs/modules/phase-9.md §8.5).
//
// The completeness report itself is pinned by completeness.service.spec.ts;
// here it is a stub returning fixed rows, so every cell asserted below is
// known. Everything else is real: the audit rows, the report_exports rows
// under RLS, the filesystem storage, and the clean-up.

let phone = 0;
const randomPhone = () =>
  `+23488${String(++phone % 100).padStart(2, "0")}${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

const TERM = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "First Term",
  academicYearLabel: "2026/2027",
  startDate: "2026-09-14",
  endDate: "2026-12-11",
  isCurrent: true,
};

const COMPLETENESS: CompletenessReportDto = {
  term: TERM,
  health: [],
  schoolDays: null,
  attendance: {
    rows: [
      {
        groupId: "a1",
        label: "JSS 1 Blue",
        classLevelName: "JSS 1",
        enrolledCount: 30,
        registersExpected: 20,
        registersTaken: 18,
        registersOnNonSchoolDays: 1,
        lastRegisterDate: "2026-10-09",
      },
      {
        groupId: "a2",
        label: "<b>JSS 1 Red</b>",
        classLevelName: "JSS 1",
        enrolledCount: 28,
        registersExpected: 20,
        registersTaken: 20,
        registersOnNonSchoolDays: 0,
        lastRegisterDate: null,
      },
    ],
    totals: { registersExpected: 40, registersTaken: 38, registersOnNonSchoolDays: 1 },
  },
  scores: { rows: [], unassigned: [], totals: { slotsExpected: 0, slotsEntered: 0 } },
  reportCards: null,
};

const TEACHERS: TeacherActivityReportDto = {
  term: TERM,
  schoolDays: null,
  rows: [
    {
      userId: "u1",
      name: "Ada Teacher",
      formArms: ["JSS 1 Blue", "JSS 2 Gold"],
      formArmRegistersExpected: 40,
      formArmRegistersTaken: 37,
      registersMarkedByThisPerson: 35,
      assignmentCount: 3,
      assignedSlotsExpected: 270,
      assignedSlotsEntered: 250,
      assignedSlotsEnteredByThisPerson: 240,
      lastRegisterMarkedAt: "2026-10-09T07:40:00.000Z",
      lastScoreEnteredAt: null,
    },
  ],
};

const stubCompleteness = {
  getCompleteness: async () => COMPLETENESS,
  getTeacherActivity: async () => TEACHERS,
} as unknown as CompletenessService;

interface AddedJob {
  name: string;
  data: Record<string, unknown>;
}

function fakeQueue(fail = false): { queue: Queue; added: AddedJob[] } {
  const added: AddedJob[] = [];
  const queue = {
    add: async (name: string, data: Record<string, unknown>) => {
      if (fail) throw new Error("redis is down");
      added.push({ name, data });
      return { id: String(added.length) };
    },
  } as unknown as Queue;
  return { queue, added };
}

const PDF_BYTES = Buffer.from("%PDF-1.4 fake");
const fakeBrowserPool = {
  withPage: async <T>(fn: (page: unknown) => Promise<T>): Promise<T> =>
    fn({ setContent: async () => undefined, pdf: async () => PDF_BYTES }),
} as unknown as BrowserPool;

describe("ReportExportsService (Phase 9 CP1.1) — real database", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1" };
  const schoolIds: string[] = [];
  let storageRoot: string;
  let storage: StorageService;
  let ownerA: AuthContext;
  let ownerB: AuthContext;

  const service = (queue: Queue) => {
    const s = new ReportExportsService(stubCompleteness, storage, queue);
    s.todayFn = () => "2026-10-16";
    return s;
  };

  async function createSchool(tag: string): Promise<AuthContext> {
    const signed = await new AuthService().signupOwner(
      {
        schoolName: `Exports ${tag}`,
        schoolSlug: `exp-${tag}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `exp-${tag}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    schoolIds.push(signed.school.id);
    return { sessionId: "s", userId: signed.user.id, schoolId: signed.school.id };
  }

  const auditRows = (schoolId: string) =>
    withTenant(schoolId, (db) =>
      db.auditLog.findMany({ where: { action: "reports.export" }, orderBy: { createdAt: "asc" } }),
    );

  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "report-exports-"));
    storage = new StorageService(new FilesystemStorageDriver(storageRoot));
    ownerA = await createSchool("a");
    ownerB = await createSchool("b");
  });

  afterAll(async () => {
    for (const id of schoolIds) {
      await basePrisma.$executeRaw`DELETE FROM schools WHERE id = ${id}`.catch(() => undefined);
    }
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("Excel: the registers sheet holds the report's rows, numbers as numbers, and the export is audited", async () => {
    const file = await service(fakeQueue().queue).completenessFile(ownerA, "registers", undefined, reqCtx);
    expect(file.filename).toBe("registers-first-term-2026-2027.xlsx");
    expect(file.contentType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.body as unknown as ExcelJS.Buffer);
    const rows: unknown[][] = [];
    wb.getWorksheet("Registers")!.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
    const header = rows.findIndex((r) => r[0] === "Class");
    expect(rows[header]).toEqual([
      "Class",
      "Level",
      "Students enrolled",
      "Registers taken",
      "Registers expected",
      "Registers on non-school days",
      "Last register",
    ]);
    expect(rows[header + 1]).toEqual(["JSS 1 Blue", "JSS 1", 30, 18, 20, 1, "2026-10-09"]);
    // A blank "last register" stays blank, and markup stays text.
    expect(rows[header + 2]!.slice(0, 6)).toEqual(["<b>JSS 1 Red</b>", "JSS 1", 28, 20, 20, 0]);
    expect(rows[header + 2]![6]).toBeUndefined();
    expect(rows[0]).toEqual(["Registers"]);
    expect(rows[1]).toEqual([`Exports a · First Term 2026/2027`]);

    const audits = await auditRows(ownerA.schoolId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.userId).toBe(ownerA.userId);
    expect(audits[0]!.metadata).toEqual({ report: "completeness-registers", format: "xlsx", rows: 2 });
  });

  it("Excel: teacher activity shows recording counts and dates, never marks", async () => {
    const file = await service(fakeQueue().queue).teacherActivityFile(ownerA, undefined, reqCtx);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.body as unknown as ExcelJS.Buffer);
    const rows: unknown[][] = [];
    wb.getWorksheet("Teacher activity")!.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
    const header = rows.findIndex((r) => r[0] === "Teacher");
    expect(rows[header + 1]).toEqual(["Ada Teacher", "JSS 1 Blue, JSS 2 Gold", 37, 40, 35, 3, 250, 270, 240, "2026-10-09"]);
  });

  it("PDF: the request stores the laid-out page, queues a job carrying ids only, and is audited", async () => {
    const { queue, added } = fakeQueue();
    const { exportId } = await service(queue).requestCompletenessPdf(ownerA, "registers", undefined, reqCtx);

    expect(added).toEqual([
      { name: REPORT_CARDS_JOB_EXPORT_PDF, data: { schoolId: ownerA.schoolId, userId: ownerA.userId, exportId } },
    ]);
    const row = await withTenant(ownerA.schoolId, (db) => db.reportExport.findUniqueOrThrow({ where: { id: exportId } }));
    expect(row.status).toBe("PENDING");
    expect(row.filename).toBe("registers-first-term-2026-2027.pdf");
    expect(row.report).toBe("completeness-registers");
    expect(row.requestedBy).toBe(ownerA.userId);
    expect(row.html).toContain("JSS 1 Blue");
    expect(row.html).toContain("&lt;b&gt;JSS 1 Red&lt;/b&gt;");
    expect(row.html).toContain("Printed 2026-10-16");

    const audit = (await auditRows(ownerA.schoolId)).find((a) => a.entityId === exportId);
    expect(audit?.metadata).toEqual({ report: "completeness-registers", format: "pdf", rows: 2 });

    const status = await service(queue).getPdfStatus(ownerA, exportId);
    expect(status).toEqual({ exportId, status: "PENDING", filename: row.filename, url: null });
  });

  it("PDF: another school's export id is not found", async () => {
    const { queue } = fakeQueue();
    const { exportId } = await service(queue).requestTeacherActivityPdf(ownerA, undefined, reqCtx);
    await expect(service(queue).getPdfStatus(ownerB, exportId)).rejects.toBeInstanceOf(NotFoundError);
    const seenByB = await withTenant(ownerB.schoolId, (db) => db.reportExport.findMany({ where: { id: exportId } }));
    expect(seenByB).toEqual([]);
  });

  it("PDF: when the job cannot be queued the export is FAILED at once, not left waiting", async () => {
    await expect(
      service(fakeQueue(true).queue).requestCompletenessPdf(ownerB, "scores", undefined, reqCtx),
    ).rejects.toThrow("redis is down");
    const rows = await withTenant(ownerB.schoolId, (db) => db.reportExport.findMany({ where: { report: "completeness-scores" } }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("FAILED");
    expect(rows[0]!.html).toBeNull();
  });

  it("worker: prints the page, stores the file, clears the HTML; the status then carries a link", async () => {
    const { queue } = fakeQueue();
    const { exportId } = await service(queue).requestCompletenessPdf(ownerA, "registers", undefined, reqCtx);
    const worker = new ExportPdfService(storage, fakeBrowserPool);
    await worker.renderExport({ schoolId: ownerA.schoolId, userId: ownerA.userId, exportId });

    const row = await withTenant(ownerA.schoolId, (db) => db.reportExport.findUniqueOrThrow({ where: { id: exportId } }));
    expect(row.status).toBe("GENERATED");
    expect(row.html).toBeNull();
    expect(row.storagePath).toBe(`schools/${ownerA.schoolId}/report-exports/${exportId}.pdf`);
    expect(row.finishedAt).not.toBeNull();
    expect(await storage.get(ownerA.schoolId, { kind: "report-export", exportId })).toEqual(PDF_BYTES);

    const status = await service(queue).getPdfStatus(ownerA, exportId);
    expect(status.status).toBe("GENERATED");
    expect(status.url).toEqual(expect.any(String));

    // A second delivery of the same job finds it finished and does nothing.
    await expect(worker.renderExport({ schoolId: ownerA.schoolId, userId: ownerA.userId, exportId })).resolves.toBeUndefined();
  });

  it("worker: a job whose export was cleaned up is skipped, and markFailed clears the HTML", async () => {
    const worker = new ExportPdfService(storage, fakeBrowserPool);
    await expect(
      worker.renderExport({ schoolId: ownerA.schoolId, userId: ownerA.userId, exportId: "00000000-0000-4000-8000-0000000000ff" }),
    ).resolves.toBeUndefined();

    const { exportId } = await service(fakeQueue().queue).requestTeacherActivityPdf(ownerB, undefined, reqCtx);
    await worker.markFailed({ schoolId: ownerB.schoolId, userId: ownerB.userId, exportId });
    const row = await withTenant(ownerB.schoolId, (db) => db.reportExport.findUniqueOrThrow({ where: { id: exportId } }));
    expect(row.status).toBe("FAILED");
    expect(row.html).toBeNull();
  });

  it("RLS: a row naming another school is refused, and with no school set nothing is visible", async () => {
    await expect(
      withTenant(ownerA.schoolId, (db) =>
        db.reportExport.create({
          data: { schoolId: ownerB.schoolId, requestedBy: ownerA.userId, report: "teacher-activity", filename: "x.pdf" },
        }),
      ),
    ).rejects.toThrow();
    // A control insert under the right school succeeds, so the refusal above
    // is the policy's WITH CHECK and not some other failure.
    await withTenant(ownerA.schoolId, (db) =>
      db.reportExport.create({
        data: { schoolId: ownerA.schoolId, requestedBy: ownerA.userId, report: "teacher-activity", filename: "x.pdf" },
      }),
    );
    const unscoped = await basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_school_id', '', true)`;
      return tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM report_exports`;
    });
    expect(Number(unscoped[0]!.n)).toBe(0);
  });

  it("clean-up: deletes exports and their files after 24 hours, keeps newer ones", async () => {
    const { queue } = fakeQueue();
    const worker = new ExportPdfService(storage, fakeBrowserPool);
    const oldOne = (await service(queue).requestCompletenessPdf(ownerA, "registers", undefined, reqCtx)).exportId;
    await worker.renderExport({ schoolId: ownerA.schoolId, userId: ownerA.userId, exportId: oldOne });
    const fresh = (await service(queue).requestCompletenessPdf(ownerA, "registers", undefined, reqCtx)).exportId;

    const now = new Date();
    await withTenant(ownerA.schoolId, (db) =>
      db.reportExport.update({ where: { id: oldOne }, data: { createdAt: new Date(now.getTime() - 25 * 3600_000) } }),
    );

    await new ReportExportSweeperService(storage).purgeExpiredExports(now);

    const left = await withTenant(ownerA.schoolId, (db) =>
      db.reportExport.findMany({ where: { id: { in: [oldOne, fresh] } }, select: { id: true } }),
    );
    expect(left.map((r) => r.id)).toEqual([fresh]);
    await expect(storage.get(ownerA.schoolId, { kind: "report-export", exportId: oldOne })).rejects.toThrow();
  });
});
