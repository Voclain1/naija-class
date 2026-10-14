// Excel and PDF of a list already on screen (Phase 9 / CP1.3,
// docs/modules/phase-9.md §8.9 CP1-D10). The page's own CSV columns and rows
// become a small table file; the API lays it out and reads nothing else.
//
// Sent as a FILE ("table", multipart): a long list can pass the API's 100 KB
// JSON-body limit, and the upload route has its own size cap.

import {
  TABLE_EXPORT_PDF_MAX_COLUMNS,
  type ReportExportStatusDto,
  type ReportPdfAcceptedDto,
  type TableExportInput,
} from "@school-kit/types";

import { apiFetch, apiFetchResponse } from "./api-client";
import type { CsvColumn } from "./csv-export";
import { saveResponseAsFile } from "./file-download";

export interface ListExport<T> {
  title: string;
  subtitle?: string | null;
  columns: CsvColumn<T>[];
  rows: T[];
}

/** The page's columns and rows as the API's table: a column is numeric when every value in it is a number. */
export function toTableInput<T>(list: ListExport<T>): TableExportInput {
  const rows = list.rows.map((r) => list.columns.map((c) => c.accessor(r) ?? null));
  return {
    title: list.title,
    subtitle: list.subtitle ?? null,
    columns: list.columns.map((c, i) => ({
      header: c.header,
      numeric: rows.length > 0 && rows.every((r) => r[i] === null || typeof r[i] === "number") && rows.some((r) => typeof r[i] === "number"),
    })),
    rows,
  };
}

export function fitsOnPdf(columnCount: number): boolean {
  return columnCount <= TABLE_EXPORT_PDF_MAX_COLUMNS;
}

function asForm(table: TableExportInput): FormData {
  const form = new FormData();
  form.append("table", new Blob([JSON.stringify(table)], { type: "application/json" }), "table.json");
  return form;
}

export async function downloadListExcel<T>(list: ListExport<T>): Promise<void> {
  const response = await apiFetchResponse("/exports/table/xlsx", { method: "POST", body: asForm(toTableInput(list)) });
  await saveResponseAsFile(response, `${list.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.xlsx`);
}

export function requestListPdf<T>(list: ListExport<T>): Promise<ReportPdfAcceptedDto> {
  return apiFetch<ReportPdfAcceptedDto>("/exports/table/pdf", { method: "POST", body: asForm(toTableInput(list)) });
}

/** A list PDF's status. Only the person who asked for it can read it. */
export function getListExport(exportId: string): Promise<ReportExportStatusDto> {
  return apiFetch<ReportExportStatusDto>(`/exports/${encodeURIComponent(exportId)}`);
}
