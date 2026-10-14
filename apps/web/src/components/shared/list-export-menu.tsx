"use client";

import { ExportMenu } from "@/components/shared/export-menu";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { exportRowsAsCsv, type CsvColumn } from "@/lib/csv-export";
import { downloadListExcel, fitsOnPdf, getListExport, requestListPdf } from "@/lib/table-export";

interface Props<T> {
  /** Heading of the Excel sheet and the PDF, e.g. "Students". */
  title: string;
  /** e.g. the class or term the list is filtered to. */
  subtitle?: string | null;
  /** The CSV file name, kept exactly as before. */
  csvFilename: string;
  columns: CsvColumn<T>[];
  /**
   * The rows to export: the list as the page shows it. May fetch (a paginated
   * list loops its own endpoint first); a failure downloads nothing.
   */
  getRows: () => T[] | Promise<T[]>;
  disabled?: boolean;
}

// The Export menu for a list (Phase 9 / CP1.3, docs/modules/phase-9.md §8.9):
// CSV as before, built here; Excel and PDF laid out by the API from the same
// columns and rows. One set of columns, so the three files always agree.
// A list too wide for a printed page offers Excel and says why PDF is off.
export function ListExportMenu<T>({ title, subtitle, csvFilename, columns, getRows, disabled }: Props<T>) {
  const { permissions } = useAuth();
  const canFormat = hasPermission(permissions, "export.table");
  const list = async () => ({ title, subtitle, columns, rows: await getRows() });

  return (
    <ExportMenu
      disabled={disabled}
      onCsv={async () => exportRowsAsCsv(csvFilename, await getRows(), columns)}
      onExcel={canFormat ? async () => downloadListExcel(await list()) : undefined}
      onPdf={canFormat ? async () => requestListPdf(await list()) : undefined}
      pdfStatus={getListExport}
      pdfUnavailable={fitsOnPdf(columns.length) ? undefined : "Too many columns for a page — use Excel"}
    />
  );
}
