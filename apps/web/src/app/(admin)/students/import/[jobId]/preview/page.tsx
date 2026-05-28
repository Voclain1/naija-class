"use client";

import { AlertTriangle, CheckCircle2, Download, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { ImportJobDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  deleteImportJob,
  downloadBadRowsCsv,
  getImportJob,
} from "@/lib/imports/api";
import { clearUploadResponse } from "@/lib/imports/session";

// /students/import/[jobId]/preview — Slice 6 cp4 step 3.
//
// Mount → GET job. If VALIDATING, poll every 2s until READY or FAILED.
// READY: render two panels (good / bad), offer bad-rows CSV download.
// Commit is slice 7: the button is rendered but disabled with a tooltip.
//
// We track `elapsed` while validating so admins watching a 250-row CSV
// don't think the page is wedged.

const POLL_INTERVAL_MS = 2000;

export default function ImportStudentsPreviewPage() {
  const router = useRouter();
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;

  const [job, setJob] = useState<ImportJobDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Hold the latest status in a ref so the polling effect can re-arm
  // without re-subscribing on every status change.
  const statusRef = useRef<ImportJobDto["status"] | null>(null);
  statusRef.current = job?.status ?? null;

  // Poll loop. setTimeout (not setInterval) so the next request only fires
  // once the previous one resolves — avoids piling up requests if the API
  // briefly stalls.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const next = await getImportJob(jobId);
        if (cancelled) return;
        setJob(next);
        if (next.status === "VALIDATING") {
          timer = setTimeout(tick, POLL_INTERVAL_MS);
        }
        // READY / FAILED / COMPLETED / PENDING / COMMITTING — stop polling.
        // (PENDING means the user landed here too early; we'll show an
        // intermediate panel directing them back to mapping.)
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setError("That import job no longer exists.");
          return;
        }
        setError(
          e instanceof ApiError ? e.message : "Could not load import job.",
        );
        // Keep retrying on transient errors so a flaky network doesn't
        // strand the wizard mid-validation.
        if (statusRef.current === "VALIDATING" || statusRef.current === null) {
          timer = setTimeout(tick, POLL_INTERVAL_MS);
        }
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  // Elapsed timer while validating.
  useEffect(() => {
    if (job?.status !== "VALIDATING") {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const iv = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [job?.status]);

  const onDownloadBadRows = useCallback(async () => {
    setDownloading(true);
    try {
      await downloadBadRowsCsv(jobId);
      toast.success("Bad-rows CSV downloaded.");
    } catch (e) {
      toast.error(
        e instanceof ApiError
          ? e.message
          : "Could not download the bad rows CSV.",
      );
    } finally {
      setDownloading(false);
    }
  }, [jobId]);

  const onAbort = useCallback(async () => {
    if (
      !window.confirm(
        "Discard this import? The uploaded file and validation results will be deleted.",
      )
    ) {
      return;
    }
    setAborting(true);
    try {
      await deleteImportJob(jobId);
      clearUploadResponse(jobId);
      router.push("/students/import");
    } catch (e) {
      toast.error(
        e instanceof ApiError
          ? e.message
          : "Could not cancel the import. Try again.",
      );
      setAborting(false);
    }
  }, [jobId, router]);

  if (error && !job) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
        <Button asChild variant="outline">
          <Link href="/students/import">Back to upload</Link>
        </Button>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="mx-auto flex w-full max-w-5xl items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  // Each status branch picks its own banner + body. Mapping page guards
  // against PENDING but if a user lands here directly we route them back.
  if (job.status === "PENDING") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
          This import is still awaiting column mapping.
        </div>
        <Button asChild>
          <Link href={`/students/import/${jobId}/mapping`}>
            Go to mapping →
          </Link>
        </Button>
      </div>
    );
  }

  if (job.status === "VALIDATING") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Header step={3} title="Validating your rows" />
        <div className="flex flex-col items-center gap-3 rounded-md border bg-muted/20 p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm font-medium">
            Validating {job.totalRows}{" "}
            {job.totalRows === 1 ? "row" : "rows"}…
          </p>
          <p className="text-xs text-muted-foreground">
            Elapsed: {formatElapsed(elapsed)}
          </p>
        </div>
        <div className="flex justify-start">
          <Button
            type="button"
            variant="ghost"
            onClick={onAbort}
            disabled
            title="Wait for validation to finish before cancelling."
          >
            <X className="h-4 w-4" />
            Cancel import
          </Button>
        </div>
      </div>
    );
  }

  if (job.status === "FAILED") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Header step={3} title="Validation failed" />
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">
            We couldn&apos;t finish validating this file.
          </p>
          <p className="mt-1 text-destructive/90">
            {job.failedReason ??
              "An unexpected error happened. Try a fresh upload."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onAbort}
            disabled={aborting}
          >
            {aborting ? "Discarding…" : "Discard and start over"}
          </Button>
        </div>
      </div>
    );
  }

  if (job.status === "COMMITTING" || job.status === "COMPLETED") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Header step={3} title="Import already in progress" />
        <div className="rounded-md border bg-muted/30 p-4 text-sm">
          This import is{" "}
          <strong>{job.status === "COMMITTING" ? "committing" : "complete"}</strong>
          . Commit-time UI lands in the next slice.
        </div>
        <Button asChild variant="outline">
          <Link href="/students">Back to roster</Link>
        </Button>
      </div>
    );
  }

  // READY — render the two panels.
  const goodRows = job.previewSnapshot?.good ?? [];
  const badRows = job.previewSnapshot?.bad ?? [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <Header step={3} title="Review and import" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SummaryCard
          tone="success"
          icon={<CheckCircle2 className="h-5 w-5" />}
          title={`Ready to import (${job.validRows})`}
          subtitle={`${job.totalRows} ${
            job.totalRows === 1 ? "row" : "rows"
          } in your file · showing first ${goodRows.length}`}
        />
        <SummaryCard
          tone="warning"
          icon={<AlertTriangle className="h-5 w-5" />}
          title={`Needs fixing (${job.invalidRows})`}
          subtitle={
            job.invalidRows === 0
              ? "All rows look good."
              : `Showing first ${badRows.length}. Download the bad rows to fix in Excel and re-upload.`
          }
          action={
            job.invalidRows > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onDownloadBadRows}
                disabled={downloading}
              >
                {downloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {downloading ? "Preparing…" : "Download bad rows"}
              </Button>
            ) : null
          }
        />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Ready to import
        </h2>
        {goodRows.length === 0 ? (
          <EmptyPanel>No rows passed validation.</EmptyPanel>
        ) : (
          <GoodRowsTable
            rows={goodRows.map((r) => ({
              rowNumber: r.rowNumber,
              parsedRow: r.parsedRow as Record<string, unknown>,
            }))}
          />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Needs fixing
        </h2>
        {badRows.length === 0 ? (
          <EmptyPanel>No rows need fixing.</EmptyPanel>
        ) : (
          <BadRowsTable rows={badRows} />
        )}
      </section>

      <div className="flex flex-col items-stretch justify-between gap-3 rounded-md border bg-muted/30 p-4 sm:flex-row sm:items-center">
        <div className="text-sm">
          <p className="font-medium">
            Commit {job.validRows}{" "}
            {job.validRows === 1 ? "student" : "students"}?
          </p>
          <p className="text-xs text-muted-foreground">
            Commit lands in the next slice. For now, you can download the
            bad-rows CSV and clean it up in Excel.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onAbort}
            disabled={aborting}
          >
            <X className="h-4 w-4" />
            {aborting ? "Discarding…" : "Discard import"}
          </Button>
          <Button
            type="button"
            disabled
            title="Available in slice 7"
            aria-disabled
          >
            Commit {job.validRows}{" "}
            {job.validRows === 1 ? "student" : "students"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Header({ step, title }: { step: number; title: string }) {
  return (
    <header className="flex flex-col gap-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        Step {step} of 3
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
    </header>
  );
}

function SummaryCard({
  tone,
  icon,
  title,
  subtitle,
  action,
}: {
  tone: "success" | "warning";
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  const toneStyles =
    tone === "success"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : "border-amber-300 bg-amber-50 text-amber-900";
  return (
    <div className={`flex flex-col gap-3 rounded-md border p-4 ${toneStyles}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5">{icon}</span>
        <div className="flex flex-1 flex-col gap-0.5">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs">{subtitle}</p>
        </div>
      </div>
      {action && <div className="flex justify-end">{action}</div>}
    </div>
  );
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

interface GoodRow {
  rowNumber: number;
  parsedRow: Record<string, unknown>;
}

function GoodRowsTable({ rows }: { rows: GoodRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Row</th>
            <th className="px-3 py-2 font-medium">Admission #</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">DOB</th>
            <th className="px-3 py-2 font-medium">Gender</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.rowNumber} className="border-t">
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                {r.rowNumber}
              </td>
              <td className="px-3 py-2 font-mono text-xs">
                {String(r.parsedRow.admissionNumber ?? "")}
              </td>
              <td className="px-3 py-2">
                {String(r.parsedRow.lastName ?? "")},{" "}
                {String(r.parsedRow.firstName ?? "")}
                {r.parsedRow.middleName
                  ? ` ${String(r.parsedRow.middleName).charAt(0)}.`
                  : ""}
              </td>
              <td className="px-3 py-2 text-xs">
                {formatDob(r.parsedRow.dateOfBirth)}
              </td>
              <td className="px-3 py-2 text-xs">
                {String(r.parsedRow.gender ?? "")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface BadRow {
  rowNumber: number;
  csvRow: Record<string, string>;
  errors: { field: string; message: string }[];
}

function BadRowsTable({ rows }: { rows: BadRow[] }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Row</th>
            <th className="px-3 py-2 font-medium">What needs fixing</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.rowNumber} className="border-t align-top">
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                {r.rowNumber}
              </td>
              <td className="px-3 py-2">
                <ul className="flex flex-col gap-1 text-sm">
                  {r.errors.map((err, i) => (
                    <li key={i}>
                      <span className="font-mono text-xs text-muted-foreground">
                        {err.field}
                      </span>
                      : {err.message}
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatElapsed(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

function formatDob(raw: unknown): string {
  // Validate worker stores Date objects in previewSnapshot.parsedRow which
  // JSON-roundtrip to ISO strings. Slice off the time portion for display.
  if (typeof raw === "string") return raw.slice(0, 10);
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return "";
}
