import { z } from "zod";

// Phase 9 / CP1.3 — Excel and PDF for the lists that already export CSV
// (students, staff, invoices, debtors, expenses, PINs, exam papers, the
// gradebook; docs/modules/phase-9.md §8.9 CP1-D10).
//
// The page sends the rows it is already showing — the same rows its CSV
// button writes — and the server only lays them out. It reads nothing from
// the database, so it adds no data-access path: what a person can export is
// exactly what their own list showed them, under that list's own permission.
// That is why one endpoint serves every role that has a list to export.
//
// Sent as a small JSON FILE (multipart), not a JSON body: a school's student
// list can pass the API's 100 KB body limit, and a per-route file size cap is
// narrower than raising that limit for every route.
//
//   POST /exports/table/xlsx   multipart file "table" → the workbook
//   POST /exports/table/pdf    multipart file "table" → { exportId }
//   GET  /exports/:exportId    the requester's own PDF: status, then a link

export const TABLE_EXPORT_MAX_ROWS = 10_000;
export const TABLE_EXPORT_MAX_COLUMNS = 60;
export const TABLE_EXPORT_MAX_FILE_BYTES = 3 * 1024 * 1024;
/** Wider than this does not fit a landscape A4 page; the page offers Excel only. */
export const TABLE_EXPORT_PDF_MAX_COLUMNS = 14;

const cell = z.union([z.string().max(2_000), z.number().finite(), z.null()]);

export const tableExportSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    subtitle: z.string().trim().max(200).nullable().default(null),
    columns: z
      .array(
        z.object({
          header: z.string().max(100),
          numeric: z.boolean().optional(),
          decimals: z.number().int().min(0).max(4).optional(),
        }),
      )
      .min(1)
      .max(TABLE_EXPORT_MAX_COLUMNS),
    rows: z.array(z.array(cell)).max(TABLE_EXPORT_MAX_ROWS),
  })
  .refine((t) => t.rows.every((r) => r.length === t.columns.length), {
    message: "every row must have one value per column",
    path: ["rows"],
  });
export type TableExportInput = z.infer<typeof tableExportSchema>;
