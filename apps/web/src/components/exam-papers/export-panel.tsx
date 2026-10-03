"use client";

import { FileDown, Loader2, Printer, Sheet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { versionsOf, type ExamPaperDto, type PaperVersion } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { downloadCsv } from "@/lib/csv-export";
import { getExamPaperExport } from "@/lib/exam-papers/exam-papers-api";
import { buildPaperDocx, paperCsv, paperFilename, paperPrintHtml, type PaperDocumentKind } from "@/lib/exam-papers/paper-export";

// Phase 8c / CP5c — print or export a FINAL paper, one version at a time
// (D63). Every export is fetched fresh from the API, which audits it.
//
// PDF is the browser's own "save as PDF" from a print-ready page — the same
// route receipts and PIN cards take — rather than a server render job.

type Busy = `${PaperDocumentKind}-${"print" | "docx"}` | "csv" | null;

export function ExportPanel({ paper }: { paper: ExamPaperDto }) {
  const versions = versionsOf(paper.versionCount);
  const [version, setVersion] = useState<PaperVersion>("A");
  const [busy, setBusy] = useState<Busy>(null);

  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Couldn't export the paper. Try again.");

  async function onPrint(kind: PaperDocumentKind) {
    // Opened synchronously, inside the click, or the browser blocks it.
    const win = window.open("", "_blank");
    if (!win) {
      toast.error("Your browser blocked the print window. Allow pop-ups for this site, or download the Word file.");
      return;
    }
    win.document.write("<p style='font-family:sans-serif'>Preparing the paper…</p>");
    setBusy(`${kind}-print`);
    try {
      const data = await getExamPaperExport(paper.id, version);
      win.document.open();
      win.document.write(paperPrintHtml(data, kind));
      win.document.close();
    } catch (e) {
      win.close();
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function onDocx(kind: PaperDocumentKind) {
    setBusy(`${kind}-docx`);
    try {
      const [data, docx] = await Promise.all([getExamPaperExport(paper.id, version), import("docx")]);
      const blob = await docx.Packer.toBlob(buildPaperDocx(docx, data, kind));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = paperFilename(data, kind, "docx");
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function onCsv() {
    setBusy("csv");
    try {
      const data = await getExamPaperExport(paper.id, version);
      downloadCsv(paperFilename(data, "paper", "csv"), paperCsv(data));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  const spin = (key: Busy) => (busy === key ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null);

  return (
    <section className="flex flex-col gap-4 rounded-lg border bg-card p-5 shadow-sm" aria-labelledby="export-heading">
      <h2 id="export-heading" className="font-medium">
        Print and export
      </h2>
      {versions.length > 1 ? (
        <div className="flex flex-col gap-1.5 sm:max-w-xs">
          <Label htmlFor="export-version">Version</Label>
          <select
            id="export-version"
            value={version}
            onChange={(e) => setVersion(e.target.value as PaperVersion)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {versions.map((v) => (
              <option key={v} value={v}>
                Version {v}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Each version orders the multiple-choice options differently. Print each version&apos;s own marking scheme.
          </p>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-md bg-muted/30 p-3">
          <span className="text-sm font-medium">Question paper</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy !== null} onClick={() => void onPrint("paper")}>
              {spin("paper-print") ?? <Printer className="mr-1 h-4 w-4" />}
              Print / PDF
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void onDocx("paper")}>
              {spin("paper-docx") ?? <FileDown className="mr-1 h-4 w-4" />}
              Word
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2 rounded-md bg-muted/30 p-3">
          <span className="text-sm font-medium">Marking scheme</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void onPrint("scheme")}>
              {spin("scheme-print") ?? <Printer className="mr-1 h-4 w-4" />}
              Print / PDF
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void onDocx("scheme")}>
              {spin("scheme-docx") ?? <FileDown className="mr-1 h-4 w-4" />}
              Word
            </Button>
          </div>
        </div>
      </div>
      <div>
        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void onCsv()}>
          {spin("csv") ?? <Sheet className="mr-1 h-4 w-4" />}
          Download CSV (for a CBT system or spreadsheet)
        </Button>
      </div>
    </section>
  );
}
