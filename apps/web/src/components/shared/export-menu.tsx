"use client";

import { ChevronDown, Download, FileSpreadsheet, FileText, Loader2, Sheet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { ReportPdfAcceptedDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiError } from "@/lib/api-client";
import { waitForPdf } from "@/lib/reports/report-exports-api";

interface Props {
  disabled?: boolean;
  /** Built in the browser from rows the page already holds (csv-export.ts). */
  onCsv?: () => void;
  /** Downloads the API-built workbook. */
  onExcel?: () => Promise<void>;
  /** Queues the API's PDF; the menu waits for it and offers it to open. */
  onPdf?: () => Promise<ReportPdfAcceptedDto>;
}

type Busy = "excel" | "pdf" | null;

// One "Export" menu for a table: CSV, Excel and PDF (Phase 9 / CP1.1,
// docs/modules/phase-9.md §8). A menu rather than three buttons, so a table
// heading keeps one control and nothing spills off a narrow screen.
//
// The finished PDF opens from a button in the toast rather than by itself:
// it lives behind a short-lived link on another origin, and a window opened
// after a wait (not straight from a click) is blocked by most browsers.
export function ExportMenu({ disabled, onCsv, onExcel, onPdf }: Props) {
  const [busy, setBusy] = useState<Busy>(null);

  async function run(kind: Exclude<Busy, null>, fn: () => Promise<void>) {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not export — try again.");
    } finally {
      setBusy(null);
    }
  }

  async function pdf(request: () => Promise<ReportPdfAcceptedDto>) {
    const id = toast.loading("Preparing the PDF… this can take up to a minute.");
    try {
      const { exportId } = await request();
      const done = await waitForPdf(exportId);
      if (done.status === "GENERATED" && done.url) {
        const url = done.url;
        toast.success("Your PDF is ready.", {
          id,
          duration: 60_000,
          action: { label: "Open PDF", onClick: () => window.open(url, "_blank", "noopener") },
        });
      } else if (done.status === "FAILED") {
        toast.error("The PDF could not be made. Try again, or download Excel instead.", { id });
      } else {
        toast.info("The PDF is still being made. Try the PDF button again in a minute.", { id });
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not make the PDF — try again.", { id });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled || busy !== null}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {busy ? "Exporting…" : "Export"}
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onCsv ? (
          <DropdownMenuItem onSelect={() => onCsv()}>
            <Sheet className="mr-2 h-4 w-4" />
            CSV
          </DropdownMenuItem>
        ) : null}
        {onExcel ? (
          <DropdownMenuItem onSelect={() => void run("excel", onExcel)}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Excel
          </DropdownMenuItem>
        ) : null}
        {onPdf ? (
          <DropdownMenuItem onSelect={() => void run("pdf", () => pdf(onPdf))}>
            <FileText className="mr-2 h-4 w-4" />
            PDF
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
