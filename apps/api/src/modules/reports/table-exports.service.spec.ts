import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ExcelJS from "exceljs";
import type { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { NotFoundError, ValidationError, type TableExportInput } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { FilesystemStorageDriver } from "../../common/storage/filesystem-storage.driver";
import { StorageService } from "../../common/storage/storage.service";
import { AuthService } from "../auth/auth.service";
import { TableExportsService } from "./table-exports.service";

// Phase 9 / CP1.3 — Excel and PDF of a list already on screen, against a REAL
// Postgres (docs/modules/phase-9.md §8.9). The rows come from the page; what
// is pinned here is that they are laid out faithfully, refused when malformed,
// audited, and that a PDF belongs to the person who asked for it.

let phone = 0;
const randomPhone = () =>
  `+23486${String(++phone % 100).padStart(2, "0")}${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

const fileOf = (v: unknown) => Buffer.from(JSON.stringify(v), "utf8");

const STUDENTS: TableExportInput = {
  title: "Students",
  subtitle: "JSS 1 Blue",
  columns: [{ header: "Name" }, { header: "Admission no." }, { header: "Balance (₦)", numeric: true, decimals: 2 }],
  rows: [
    ["Ada Obi", "A/1", 12500.5],
    ["=cmd|' /C calc'!A0", "A/2", null],
  ],
};

describe("TableExportsService.parse", () => {
  it("accepts a well-formed table", () => {
    expect(TableExportsService.parse(fileOf(STUDENTS)).rows).toHaveLength(2);
  });

  it("refuses no file, unreadable JSON, a short row, and too many columns", () => {
    expect(() => TableExportsService.parse(undefined)).toThrow(ValidationError);
    expect(() => TableExportsService.parse(Buffer.from("{not json"))).toThrow(ValidationError);
    expect(() => TableExportsService.parse(fileOf({ ...STUDENTS, rows: [["only one"]] }))).toThrow(ValidationError);
    const wide = { title: "Wide", subtitle: null, columns: Array.from({ length: 61 }, (_, i) => ({ header: `C${i}` })), rows: [] };
    expect(() => TableExportsService.parse(fileOf(wide))).toThrow(ValidationError);
  });
});

describe("TableExportsService — real database", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1" };
  const schoolIds: string[] = [];
  let storageRoot: string;
  let storage: StorageService;
  let owner: AuthContext;
  let bursar: AuthContext;
  const added: Array<Record<string, unknown>> = [];
  const queue = { add: async (_n: string, data: Record<string, unknown>) => void added.push(data) } as unknown as Queue;

  const service = () => {
    const s = new TableExportsService(storage, queue);
    s.todayFn = () => "2026-10-16";
    return s;
  };

  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "table-exports-"));
    storage = new StorageService(new FilesystemStorageDriver(storageRoot));
    const signed = await new AuthService().signupOwner(
      {
        schoolName: `Lists ${runId}`,
        schoolSlug: `lists-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `lists-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    schoolIds.push(signed.school.id);
    owner = { sessionId: "s", userId: signed.user.id, schoolId: signed.school.id };
    bursar = await withTenant(owner.schoolId, async (db) => {
      const u = await db.user.create({
        data: { schoolId: owner.schoolId, firstName: "Bisi", lastName: "Bursar", email: `lists-b-${runId}@example.test`, phone: randomPhone(), passwordHash: "x" },
        select: { id: true },
      });
      const role = await db.role.findFirst({ where: { schoolId: null, key: "bursar", isSystem: true }, select: { id: true } });
      await db.userRole.create({ data: { userId: u.id, roleId: role!.id } });
      return { sessionId: "s", userId: u.id, schoolId: owner.schoolId };
    });
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.$executeRaw`DELETE FROM schools WHERE id = ${id}`.catch(() => undefined);
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("Excel: the rows as sent, numbers as numbers, a formula-looking name kept as text; audited", async () => {
    const file = await service().xlsx(bursar, STUDENTS, reqCtx);
    expect(file.filename).toBe("students-jss-1-blue.xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.body as unknown as ExcelJS.Buffer);
    const sheet = wb.getWorksheet("Students")!;
    let header = 0;
    sheet.eachRow((r, n) => {
      if (r.getCell(1).value === "Name") header = n;
    });
    expect(sheet.getRow(header + 1).getCell(3).value).toBe(12500.5);
    expect(sheet.getRow(header + 1).getCell(3).numFmt).toBe("0.00");
    const injected = sheet.getRow(header + 2).getCell(1);
    expect(injected.type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getRow(header + 2).getCell(3).value).toBeNull();

    const audits = await withTenant(owner.schoolId, (db) =>
      db.auditLog.findMany({ where: { action: "export.table", userId: bursar.userId } }),
    );
    expect(audits.map((a) => a.metadata)).toEqual([{ title: "Students", format: "xlsx", rows: 2 }]);
  });

  it("PDF: a list too wide for a page is refused with the reason", async () => {
    const wide: TableExportInput = { ...STUDENTS, columns: Array.from({ length: 15 }, (_, i) => ({ header: `C${i}` })), rows: [] };
    await expect(service().pdf(owner, wide, reqCtx)).rejects.toMatchObject({ code: "TABLE_TOO_WIDE" });
  });

  it("PDF: queued with ids only, audited, and only its requester can see it", async () => {
    const { exportId } = await service().pdf(bursar, STUDENTS, reqCtx);
    expect(added.at(-1)).toEqual({ schoolId: owner.schoolId, userId: bursar.userId, exportId });
    const row = await withTenant(owner.schoolId, (db) => db.reportExport.findUniqueOrThrow({ where: { id: exportId } }));
    expect(row.report).toBe("table");
    expect(row.html).toContain("Ada Obi");
    expect(row.html).toContain("12500.50");

    expect((await service().status(bursar, exportId)).status).toBe("PENDING");
    // Even the owner cannot fetch another person's list copy through this route.
    await expect(service().status(owner, exportId)).rejects.toBeInstanceOf(NotFoundError);

    const audit = await withTenant(owner.schoolId, (db) =>
      db.auditLog.findFirst({ where: { action: "export.table", entityId: exportId } }),
    );
    expect(audit?.metadata).toEqual({ title: "Students", format: "pdf", rows: 2 });
  });
});
