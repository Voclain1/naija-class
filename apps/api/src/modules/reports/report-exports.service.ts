import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";

import { withTenant } from "@school-kit/db";
import {
  lagosTodayIso,
  NotFoundError,
  type AttendanceArmRowDto,
  type CompletenessExportSection,
  type CompletenessTermDto,
  type ReportExportKey,
  type ReportExportStatusDto,
  type ReportPdfAcceptedDto,
  type ScoreEntryRowDto,
  type TeacherActivityRowDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import {
  exportFilename,
  toPrintHtml,
  toXlsx,
  XLSX_CONTENT_TYPE,
  type ExportDocument,
  type ExportTable,
} from "../../common/export/tabular-export.js";
import { REPORT_CARDS_JOB_EXPORT_PDF, REPORT_CARDS_QUEUE } from "../../common/queue/index.js";
import { StorageService } from "../../common/storage/index.js";
import { loadReceiptLogo } from "../payments/receipt.js";
import type { ExportPdfJobData } from "../report-cards/render/export-pdf.service.js";
import { wakeRenderWorker } from "../report-cards/render/wake-render-worker.js";
import { CompletenessService } from "./completeness.service.js";

// Phase 9 / CP1.1 — Excel and PDF copies of the reports (docs/modules/phase-9.md §8).
//
// Each export reads the report through CompletenessService, the same guarded
// read the page uses, so the file always says what the screen says. This file
// only turns those rows into a table (the columns match the page's CSV export
// in apps/web/src/app/(admin)/reports/page.tsx) and records who took a copy.
//
//   Excel → built here and returned at once (CP1-D2).
//   PDF   → the HTML is built here and stored on a report_exports row; the
//           render worker prints it, stores the file and clears the HTML
//           (CP1-D3). The job carries ids only, never a row of the report.
//
// Every export writes a `reports.export` audit row (CP1-D7): a copy takes the
// report's rows out of the system.

export interface RequestContext {
  ipAddress: string | null;
}

export interface ExportFile {
  filename: string;
  contentType: string;
  body: Buffer;
}

const MANAGER_ROLES = ["owner", "admin"] as const;
const AUDIT_REPORT_EXPORT = "reports.export";
/** Signed-link lifetime for a finished PDF, as for receipts. */
const PDF_URL_TTL_SECONDS = 15 * 60;

const subtitleFor = (term: CompletenessTermDto | null): string | null =>
  term ? `${term.name} ${term.academicYearLabel}` : null;

const registersTable = (rows: AttendanceArmRowDto[]): ExportTable<AttendanceArmRowDto> => ({
  title: "Registers",
  note: "A register counts as taken when it is marked on a school day.",
  columns: [
    { header: "Class", value: (r) => r.label },
    { header: "Level", value: (r) => r.classLevelName },
    { header: "Students enrolled", value: (r) => r.enrolledCount, numeric: true },
    { header: "Registers taken", value: (r) => r.registersTaken, numeric: true },
    { header: "Registers expected", value: (r) => r.registersExpected, numeric: true },
    { header: "Registers on non-school days", value: (r) => r.registersOnNonSchoolDays, numeric: true },
    { header: "Last register", value: (r) => r.lastRegisterDate },
  ],
  rows,
});

const scoresTable = (rows: ScoreEntryRowDto[]): ExportTable<ScoreEntryRowDto> => ({
  title: "Score entry",
  columns: [
    { header: "Class", value: (r) => r.label },
    { header: "Subject", value: (r) => r.subjectName },
    { header: "Students enrolled", value: (r) => r.enrolledCount, numeric: true },
    { header: "Components", value: (r) => r.componentCount, numeric: true },
    { header: "Scores entered", value: (r) => r.slotsEntered, numeric: true },
    { header: "Scores expected", value: (r) => r.slotsExpected, numeric: true },
    { header: "Students signed off", value: (r) => r.studentsSignedOff, numeric: true },
    { header: "Students with any score", value: (r) => r.studentsWithScores, numeric: true },
  ],
  rows,
});

const teacherActivityTable = (rows: TeacherActivityRowDto[]): ExportTable<TeacherActivityRowDto> => ({
  title: "Teacher activity",
  note: "What each teacher recorded this term. It says nothing about their pupils' marks.",
  columns: [
    { header: "Teacher", value: (r) => r.name },
    { header: "Form classes", value: (r) => r.formArms.join(", ") },
    { header: "Form-class registers taken", value: (r) => r.formArmRegistersTaken, numeric: true },
    { header: "Form-class registers expected", value: (r) => r.formArmRegistersExpected, numeric: true },
    { header: "Registers keyed themselves", value: (r) => r.registersMarkedByThisPerson, numeric: true },
    { header: "Subjects assigned", value: (r) => r.assignmentCount, numeric: true },
    { header: "Scores entered on their subjects", value: (r) => r.assignedSlotsEntered, numeric: true },
    { header: "Scores expected on their subjects", value: (r) => r.assignedSlotsExpected, numeric: true },
    { header: "Scores keyed themselves", value: (r) => r.assignedSlotsEnteredByThisPerson, numeric: true },
    { header: "Last register", value: (r) => r.lastRegisterMarkedAt?.slice(0, 10) ?? null },
    { header: "Last score", value: (r) => r.lastScoreEnteredAt?.slice(0, 10) ?? null },
  ],
  rows,
});

@Injectable()
export class ReportExportsService {
  constructor(
    private readonly completeness: CompletenessService,
    private readonly storage: StorageService,
    @InjectQueue(REPORT_CARDS_QUEUE) private readonly queue: Queue,
  ) {}

  /** Lagos day printed on a PDF. A property so specs can pin it. */
  todayFn: () => string = lagosTodayIso;

  // ===========================================================================
  // GET /reports/completeness/export and /reports/teacher-activity/export
  // ===========================================================================
  async completenessFile(
    authCtx: AuthContext,
    section: CompletenessExportSection,
    termId: string | undefined,
    reqCtx: RequestContext,
  ): Promise<ExportFile> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGER_ROLES);
    const { key, doc } = await this.completenessDocument(authCtx, section, termId);
    return this.xlsxFile(authCtx, key, doc, reqCtx);
  }

  async teacherActivityFile(authCtx: AuthContext, termId: string | undefined, reqCtx: RequestContext): Promise<ExportFile> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGER_ROLES);
    const { key, doc } = await this.teacherActivityDocument(authCtx, termId, reqCtx);
    return this.xlsxFile(authCtx, key, doc, reqCtx);
  }

  // ===========================================================================
  // POST /reports/completeness/pdf and /reports/teacher-activity/pdf
  // ===========================================================================
  async requestCompletenessPdf(
    authCtx: AuthContext,
    section: CompletenessExportSection,
    termId: string | undefined,
    reqCtx: RequestContext,
  ): Promise<ReportPdfAcceptedDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGER_ROLES);
    const { key, doc, termIdUsed } = await this.completenessDocument(authCtx, section, termId);
    return this.queuePdf(authCtx, key, doc, termIdUsed, reqCtx);
  }

  async requestTeacherActivityPdf(
    authCtx: AuthContext,
    termId: string | undefined,
    reqCtx: RequestContext,
  ): Promise<ReportPdfAcceptedDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGER_ROLES);
    const { key, doc, termIdUsed } = await this.teacherActivityDocument(authCtx, termId, reqCtx);
    return this.queuePdf(authCtx, key, doc, termIdUsed, reqCtx);
  }

  // ===========================================================================
  // GET /reports/exports/:exportId
  // ===========================================================================
  async getPdfStatus(authCtx: AuthContext, exportId: string): Promise<ReportExportStatusDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGER_ROLES);
    // RLS bounds the read to this school: another school's id is simply absent.
    const row = await withTenant(authCtx.schoolId, (db) =>
      db.reportExport.findUnique({ where: { id: exportId }, select: { id: true, status: true, filename: true } }),
    );
    if (!row) throw new NotFoundError("Export not found.");
    const url =
      row.status === "GENERATED"
        ? await this.storage.signUrl(authCtx.schoolId, { kind: "report-export", exportId: row.id }, PDF_URL_TTL_SECONDS)
        : null;
    return { exportId: row.id, status: row.status, filename: row.filename, url };
  }

  // ---------------------------------------------------------------------------

  private async completenessDocument(
    authCtx: AuthContext,
    section: CompletenessExportSection,
    termId: string | undefined,
  ): Promise<{ key: ReportExportKey; doc: ExportDocument; termIdUsed: string | null }> {
    const [report, schoolName] = await Promise.all([
      this.completeness.getCompleteness(authCtx, termId),
      this.schoolName(authCtx.schoolId),
    ]);
    const table = section === "registers" ? registersTable(report.attendance?.rows ?? []) : scoresTable(report.scores?.rows ?? []);
    return {
      key: section === "registers" ? "completeness-registers" : "completeness-scores",
      doc: { title: table.title, schoolName, subtitle: subtitleFor(report.term), tables: [table] },
      termIdUsed: report.term?.id ?? null,
    };
  }

  private async teacherActivityDocument(
    authCtx: AuthContext,
    termId: string | undefined,
    reqCtx: RequestContext,
  ): Promise<{ key: ReportExportKey; doc: ExportDocument; termIdUsed: string | null }> {
    // getTeacherActivity audits its own read (Phase 8 D23); the export audits
    // the copy on top of it.
    const [report, schoolName] = await Promise.all([
      this.completeness.getTeacherActivity(authCtx, termId, reqCtx),
      this.schoolName(authCtx.schoolId),
    ]);
    const table = teacherActivityTable(report.rows);
    return {
      key: "teacher-activity",
      doc: { title: table.title, schoolName, subtitle: subtitleFor(report.term), tables: [table] },
      termIdUsed: report.term?.id ?? null,
    };
  }

  private async xlsxFile(
    authCtx: AuthContext,
    key: ReportExportKey,
    doc: ExportDocument,
    reqCtx: RequestContext,
  ): Promise<ExportFile> {
    const body = await toXlsx(doc);
    const filename = exportFilename(doc.title, doc.subtitle, "xlsx");
    await withTenant(authCtx.schoolId, (db) =>
      db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT_REPORT_EXPORT,
          entityType: "report",
          entityId: null,
          ipAddress: reqCtx.ipAddress,
          metadata: { report: key, format: "xlsx", rows: doc.tables.reduce((n, t) => n + t.rows.length, 0) },
        },
      }),
    );
    return { filename, contentType: XLSX_CONTENT_TYPE, body };
  }

  private async queuePdf(
    authCtx: AuthContext,
    key: ReportExportKey,
    doc: ExportDocument,
    termId: string | null,
    reqCtx: RequestContext,
  ): Promise<ReportPdfAcceptedDto> {
    const logoUrl = await withTenant(authCtx.schoolId, async (db) =>
      (await db.school.findUnique({ where: { id: authCtx.schoolId }, select: { logoUrl: true } }))?.logoUrl ?? null,
    );
    const logoDataUri = await loadReceiptLogo(this.storage, authCtx.schoolId, logoUrl);
    const html = toPrintHtml(doc, { logoDataUri, printedOn: this.todayFn() });
    const filename = exportFilename(doc.title, doc.subtitle, "pdf");

    // The row commits BEFORE the job exists, so the worker can never pick up
    // an id whose row is not yet visible to it.
    const exportId = await withTenant(authCtx.schoolId, async (db) => {
      const row = await db.reportExport.create({
        data: { schoolId: authCtx.schoolId, requestedBy: authCtx.userId, report: key, termId, filename, html },
        select: { id: true },
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT_REPORT_EXPORT,
          entityType: "report_export",
          entityId: row.id,
          ipAddress: reqCtx.ipAddress,
          metadata: { report: key, format: "pdf", rows: doc.tables.reduce((n, t) => n + t.rows.length, 0) },
        },
      });
      return row.id;
    });

    try {
      const data: ExportPdfJobData = { schoolId: authCtx.schoolId, userId: authCtx.userId, exportId };
      await this.queue.add(REPORT_CARDS_JOB_EXPORT_PDF, data);
    } catch (err) {
      // No job means nothing will ever finish this row; say so now rather
      // than leave the page waiting.
      await withTenant(authCtx.schoolId, (db) =>
        db.reportExport.update({ where: { id: exportId }, data: { status: "FAILED", html: null, finishedAt: new Date() } }),
      );
      throw err;
    }
    wakeRenderWorker("report export");
    return { exportId };
  }

  private async schoolName(schoolId: string): Promise<string> {
    const school = await withTenant(schoolId, (db) =>
      db.school.findUnique({ where: { id: schoolId }, select: { name: true } }),
    );
    return school?.name ?? "";
  }
}
