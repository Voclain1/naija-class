import { z } from "zod";

// Phase 9 / CP1 — report exports (docs/modules/phase-9.md §8).
//
// Excel files are built by the API and downloaded at once. PDFs are queued for
// the render worker (CP1-D3): POST returns an export id, the page polls GET
// until it is GENERATED, then opens the short-lived URL.
//
// Each report has its own export routes, so each route can require both
// `reports.export` AND that report's own read permission (the guard checks
// all of a handler's permissions): exporting never reaches a report the
// person cannot open.
//
//   GET  /reports/completeness/export      ?section=&termId=&format=xlsx
//   POST /reports/completeness/pdf          { section, termId? }
//   GET  /reports/teacher-activity/export   ?termId=&format=xlsx
//   POST /reports/teacher-activity/pdf      { termId? }
//   GET  /reports/exports/:exportId         status, then a short-lived link

/** The completeness report's two tables (registers, score entry). */
export const COMPLETENESS_EXPORT_SECTIONS = ["registers", "scores"] as const;
export type CompletenessExportSection = (typeof COMPLETENESS_EXPORT_SECTIONS)[number];

/** File formats the API builds. CSV stays in the browser (csv-export.ts). */
export const REPORT_FILE_FORMATS = ["xlsx"] as const;
export type ReportFileFormat = (typeof REPORT_FILE_FORMATS)[number];

const termIdField = z.string().uuid().optional();

export const completenessExportQuerySchema = z.object({
  section: z.enum(COMPLETENESS_EXPORT_SECTIONS),
  // Optional: omitted → the school's current term, as on the report itself.
  termId: termIdField,
  format: z.enum(REPORT_FILE_FORMATS).default("xlsx"),
});
export type CompletenessExportQuery = z.infer<typeof completenessExportQuerySchema>;

export const completenessPdfRequestSchema = z.object({
  section: z.enum(COMPLETENESS_EXPORT_SECTIONS),
  termId: termIdField,
});
export type CompletenessPdfRequest = z.infer<typeof completenessPdfRequestSchema>;

export const teacherActivityExportQuerySchema = z.object({
  termId: termIdField,
  format: z.enum(REPORT_FILE_FORMATS).default("xlsx"),
});
export type TeacherActivityExportQuery = z.infer<typeof teacherActivityExportQuerySchema>;

export const teacherActivityPdfRequestSchema = z.object({ termId: termIdField });
export type TeacherActivityPdfRequest = z.infer<typeof teacherActivityPdfRequestSchema>;

/** What a stored export row says it was a copy of; written to the row and the audit log. */
export const REPORT_EXPORT_KEYS = ["completeness-registers", "completeness-scores", "teacher-activity"] as const;
export type ReportExportKey = (typeof REPORT_EXPORT_KEYS)[number];

export const REPORT_EXPORT_STATUSES = ["PENDING", "GENERATED", "FAILED"] as const;
export type ReportExportStatus = (typeof REPORT_EXPORT_STATUSES)[number];

export interface ReportPdfAcceptedDto {
  exportId: string;
}

export interface ReportExportStatusDto {
  exportId: string;
  status: ReportExportStatus;
  /** The name to save the file under, e.g. "registers-first-term-2026-27.pdf". */
  filename: string;
  /** A short-lived link, set only when status is GENERATED. */
  url: string | null;
}

/** How long a finished PDF stays downloadable before the daily clean-up removes it. */
export const REPORT_EXPORT_RETENTION_HOURS = 24;
