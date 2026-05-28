"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { ImportJobDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { downloadErrorReportCsv, getImportJob } from "@/lib/imports/api";

// /students/import/[jobId]/done — Slice 7 cp2 step 4 (final).
//
// Mount → GET job. If COMMITTING, poll every 2s with elapsed timer (same
// pattern as the preview page during VALIDATING). On COMPLETED render the
// results panel (with optional error-report download); on FAILED render
// the error panel with `failedReason`.
//
// This page is purely jobId-driven — it does NOT read sessionStorage. The
// commit handler runs server-side; everything the wizard needs comes
// back through GET /imports/:jobId.

const POLL_INTERVAL_MS = 2000;

export default function ImportStudentsDonePage() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;

  const [job, setJob] = useState<ImportJobDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Same poll-self-rearming pattern as the preview page: setTimeout, not
  // setInterval, so a slow API doesn't pile up requests. The status ref
  // lets the error handler decide whether to keep retrying after a
  // transient failure.
  const statusRef = useRef<ImportJobDto["status"] | null>(null);
  statusRef.current = job?.status ?? null;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const next = await getImportJob(jobId);
        if (cancelled) return;
        setJob(next);
        if (next.status === "COMMITTING") {
          timer = setTimeout(tick, POLL_INTERVAL_MS);
        }
        // COMPLETED / FAILED — stop polling. PENDING / VALIDATING / READY
        // shouldn't be reachable from /done in normal flow, but we render
        // a "wrong place" panel below rather than re-polling forever.
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
        // strand the wizard mid-commit.
        if (statusRef.current === "COMMITTING" || statusRef.current === null) {
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

  // Elapsed timer while committing — admins watching a 250-row import
  // need to know the page is doing something. Resets when status flips.
  useEffect(() => {
    if (job?.status !== "COMMITTING") {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const iv = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [job?.status]);

  const onDownloadErrorReport = useCallback(async () => {
    setDownloading(true);
    try {
      await downloadErrorReportCsv(jobId);
      toast.success("Error report downloaded.");
    } catch (e) {
      toast.error(
        e instanceof ApiError
          ? e.message
          : "Could not download the error report.",
      );
    } finally {
      setDownloading(false);
    }
  }, [jobId]);

  if (error && !job) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
        <Button asChild variant="outline">
          <Link href="/students/import">Back to import</Link>
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

  // Status branches — each one renders its own panel.

  if (job.status === "COMMITTING") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Header step={4} title="Importing your students" />
        <div className="flex flex-col items-center gap-3 rounded-md border bg-muted/20 p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm font-medium">
            Importing {job.validRows}{" "}
            {job.validRows === 1 ? "student" : "students"}…
          </p>
          <p className="text-xs text-muted-foreground">
            Elapsed: {formatElapsed(elapsed)}
          </p>
        </div>
      </div>
    );
  }

  if (job.status === "FAILED") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Header step={4} title="Import failed" />
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">
            We couldn&apos;t finish this import.
          </p>
          <p className="mt-1 text-destructive/90">
            {job.failedReason ??
              "An unexpected error happened. Try a fresh upload."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/students/import">Back to import</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (job.status !== "COMPLETED") {
    // PENDING / VALIDATING / READY — admin landed here too early
    // (manual URL paste or sessionStorage drift). Point them at the
    // right step rather than spinning.
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Header step={4} title="Import isn't ready yet" />
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
          This import is currently <strong>{job.status.toLowerCase()}</strong>.
          You can&apos;t see results until commit finishes.
        </div>
        <Button asChild variant="outline">
          <Link href={`/students/import/${jobId}/preview`}>
            Back to preview
          </Link>
        </Button>
      </div>
    );
  }

  // COMPLETED — the happy(ish) case. Compute the row arithmetic for the
  // sub-lines. `commitTimeFailures` covers rows that re-validate caught
  // (race-condition collisions) AND any commit-time per-row failures —
  // the difference is invisible to the admin; both ended up in the
  // error report with a per-row reason.
  const commitTimeFailures = Math.max(0, job.validRows - job.committedRows);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Header step={4} title="Import complete" />

      <div className="flex flex-col gap-4 rounded-md border border-emerald-300 bg-emerald-50 p-6 text-emerald-900">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-6 w-6" />
          <div className="flex flex-1 flex-col gap-1">
            <p className="text-lg font-semibold">
              Imported {job.committedRows.toLocaleString()}{" "}
              {job.committedRows === 1 ? "student" : "students"}.
            </p>
            {(commitTimeFailures > 0 || job.invalidRows > 0) && (
              <ul className="flex flex-col gap-0.5 text-sm">
                {commitTimeFailures > 0 && (
                  <li>
                    {commitTimeFailures.toLocaleString()}{" "}
                    {commitTimeFailures === 1 ? "row" : "rows"} failed during
                    commit (likely a duplicate admission number).
                  </li>
                )}
                {job.invalidRows > 0 && (
                  <li>
                    {job.invalidRows.toLocaleString()}{" "}
                    {job.invalidRows === 1 ? "row" : "rows"} listed in the
                    error report.
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      </div>

      {job.hasErrorReport && (
        <div className="flex flex-col items-stretch justify-between gap-3 rounded-md border bg-muted/30 p-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3 text-sm">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
            <div className="flex flex-col">
              <p className="font-medium">Error report ready</p>
              <p className="text-xs text-muted-foreground">
                Lists every row that didn&apos;t make it in, with the reason.
                Fix them in Excel and re-upload.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={onDownloadErrorReport}
            disabled={downloading}
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {downloading ? "Preparing…" : "Download error report"}
          </Button>
        </div>
      )}

      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button asChild variant="outline">
          <Link href="/students/import">Import another file</Link>
        </Button>
        <Button asChild>
          <Link href="/students">
            <Users className="h-4 w-4" />
            View roster
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Header({ step, title }: { step: number; title: string }) {
  return (
    <header className="flex flex-col gap-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        Step {step} of 4
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
    </header>
  );
}

function formatElapsed(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}
