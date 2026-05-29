"use client";

import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { uploadGuardiansCsv } from "@/lib/imports/api";
import { saveUploadResponse } from "@/lib/imports/session";

// /guardians/import — Slice 8 cp2 step 1.
//
// File picker + drag-drop. On success navigates to the mapping step.
// Same shape as the slice 6 students upload page (apps/web/src/app/
// (admin)/students/import/page.tsx); the URL + the API wrapper +
// the navigation target are the only differences.
//
// We rely on the same sessionStorage bridge as students for headers
// + sampleRows hand-off — the GET DTO doesn't expose them (PII
// concern + lossy projection on the server). Mapping page detects an
// empty session and routes back here. Refresh-resume across browser
// tabs doesn't work today; tracked in deferred.md.

export default function ImportGuardiansUploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setErrorCode(null);
      setErrorMessage(null);
      setFileName(file.name);
      try {
        const res = await uploadGuardiansCsv(file);
        saveUploadResponse(res);
        router.push(`/guardians/import/${res.jobId}/mapping`);
      } catch (e) {
        if (e instanceof ApiError) {
          setErrorCode(e.code);
          setErrorMessage(e.message);
        } else {
          setErrorCode("NETWORK_ERROR");
          setErrorMessage(
            "Could not reach the server. Check your connection and try again.",
          );
        }
        setBusy(false);
      }
    },
    [router],
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
      e.target.value = "";
    },
    [handleFile],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Step 1 of 4
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Import guardians from CSV
        </h1>
        <p className="text-sm text-muted-foreground">
          Upload a CSV that lists each parent or guardian and the student
          they&apos;re responsible for. We&apos;ll dedup parents who appear
          on multiple rows (one row per child is fine).
        </p>
      </header>

      <div className="flex items-center justify-between rounded-md border bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
          <div className="flex flex-col text-sm">
            <span className="font-medium">Not sure where to start?</span>
            <span className="text-xs text-muted-foreground">
              Download the template, fill in your guardians (use the
              student&apos;s admission number to link), then upload it here.
            </span>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href="/guardians-import-template.csv" download>
            <Download className="mr-1 h-4 w-4" />
            Template CSV
          </a>
        </Button>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed p-12 text-center transition-colors ${
          dragOver
            ? "border-primary bg-primary/5"
            : "border-input bg-muted/20"
        }`}
      >
        <Upload className="h-8 w-8 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">
            Drag &amp; drop a CSV here, or click to browse
          </p>
          <p className="text-xs text-muted-foreground">
            Up to 5&nbsp;MB · 10,000 rows max
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={onPick}
          className="hidden"
          aria-label="Choose CSV file"
        />
        <Button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? "Uploading…" : "Choose file"}
        </Button>
        {fileName && busy && (
          <p className="text-xs text-muted-foreground">{fileName}</p>
        )}
      </div>

      {errorCode && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">
            {humanizeErrorCode(errorCode)}
          </p>
          <p className="mt-1 text-sm text-destructive/90">{errorMessage}</p>
          {fileName && (
            <p className="mt-1 text-xs text-muted-foreground">
              File: <span className="font-mono">{fileName}</span>
            </p>
          )}
        </div>
      )}

      <div className="flex justify-start">
        <Button variant="ghost" asChild>
          <Link href="/students">Cancel</Link>
        </Button>
      </div>
    </div>
  );
}

function humanizeErrorCode(code: string): string {
  switch (code) {
    case "FILE_TOO_LARGE":
      return "File is too large";
    case "TOO_MANY_ROWS":
      return "Too many rows in this file";
    case "INVALID_CSV":
      return "We couldn't read this as a CSV";
    case "AMBIGUOUS_HEADERS":
      return "Duplicate column headers in your CSV";
    case "INVALID_UPLOAD":
      return "We couldn't read the uploaded file";
    case "NETWORK_ERROR":
      return "Couldn't reach the server";
    default:
      return "Upload failed";
  }
}
