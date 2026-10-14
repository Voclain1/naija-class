import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";

import { withTenant } from "@school-kit/db";
import {
  lagosTodayIso,
  tableExportSchema,
  TABLE_EXPORT_PDF_MAX_COLUMNS,
  ValidationError,
  type ReportExportStatusDto,
  type ReportPdfAcceptedDto,
  type TableExportInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import {
  exportFilename,
  toXlsx,
  XLSX_CONTENT_TYPE,
  type ExportCell,
  type ExportDocument,
} from "../../common/export/tabular-export.js";
import { REPORT_CARDS_QUEUE } from "../../common/queue/index.js";
import { StorageService } from "../../common/storage/index.js";
import { PdfExportQueue, schoolNameOf } from "./pdf-export-queue.js";
import type { ExportFile, RequestContext } from "./report-exports.service.js";

// Phase 9 / CP1.3 — Excel and PDF for the lists that already export CSV
// (docs/modules/phase-9.md §8.9 CP1-D10).
//
// The page sends the rows it is already showing; this only lays them out.
// It reads no table, so it adds no data-access path: a person can export
// exactly what their own list showed them, under that list's permission —
// the same reasoning as the browser's csv-export.ts, moved server-side only
// because Excel and PDF are built here. What it does add is a record: every
// copy is audited (`export.table`, with its title, format and row count), and
// the PDF names the school and the date it was printed.

const STAFF_ROLES = ["owner", "admin", "teacher", "bursar"] as const;
const AUDIT_TABLE_EXPORT = "export.table";
/** The report_exports.report value for a list copy; the title is in the audit row. */
const TABLE_REPORT_KEY = "table";

@Injectable()
export class TableExportsService {
  constructor(
    private readonly storage: StorageService,
    @InjectQueue(REPORT_CARDS_QUEUE) private readonly queue: Queue,
  ) {}

  /** Lagos day printed on a PDF. A property so specs can pin it. */
  todayFn: () => string = lagosTodayIso;

  /** Reads and checks the uploaded table file. Exported for the controller and specs. */
  static parse(buffer: Buffer | undefined): TableExportInput {
    if (!buffer) {
      throw new ValidationError("INVALID_UPLOAD", "No table was sent. Use multipart/form-data with a 'table' file.");
    }
    let json: unknown;
    try {
      json = JSON.parse(buffer.toString("utf8"));
    } catch {
      throw new ValidationError("INVALID_TABLE", "The table could not be read.");
    }
    const parsed = tableExportSchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("INVALID_TABLE", "The table could not be read.", parsed.error.flatten());
    }
    return parsed.data;
  }

  async xlsx(authCtx: AuthContext, table: TableExportInput, reqCtx: RequestContext): Promise<ExportFile> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const doc = await this.document(authCtx, table);
    const body = await toXlsx(doc);
    await withTenant(authCtx.schoolId, (db) =>
      db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT_TABLE_EXPORT,
          entityType: "table",
          entityId: null,
          ipAddress: reqCtx.ipAddress,
          metadata: { title: table.title, format: "xlsx", rows: table.rows.length },
        },
      }),
    );
    return { filename: exportFilename(doc.title, doc.subtitle, "xlsx"), contentType: XLSX_CONTENT_TYPE, body };
  }

  async pdf(authCtx: AuthContext, table: TableExportInput, reqCtx: RequestContext): Promise<ReportPdfAcceptedDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    if (table.columns.length > TABLE_EXPORT_PDF_MAX_COLUMNS) {
      throw new ValidationError(
        "TABLE_TOO_WIDE",
        `This list has ${table.columns.length} columns, too many for a printed page. Download it as Excel instead.`,
      );
    }
    const doc = await this.document(authCtx, table);
    return this.pdfQueue().queuePdf(
      authCtx,
      TABLE_REPORT_KEY,
      doc,
      null,
      { action: AUDIT_TABLE_EXPORT, metadata: { title: table.title } },
      reqCtx.ipAddress,
    );
  }

  /** A person's own PDF only: another person's export id reads as not found. */
  async status(authCtx: AuthContext, exportId: string): Promise<ReportExportStatusDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    return this.pdfQueue().status(authCtx, exportId, authCtx.userId);
  }

  private async document(authCtx: AuthContext, table: TableExportInput): Promise<ExportDocument> {
    return {
      title: table.title,
      subtitle: table.subtitle,
      schoolName: await schoolNameOf(authCtx.schoolId),
      tables: [
        {
          title: table.title,
          columns: table.columns.map((c, i) => ({
            header: c.header,
            numeric: c.numeric,
            decimals: c.decimals,
            value: (row: ExportCell[]) => row[i] ?? null,
          })),
          rows: table.rows,
        },
      ],
    };
  }

  private pdfQueue(): PdfExportQueue {
    return new PdfExportQueue(this.storage, this.queue, this.todayFn);
  }
}
