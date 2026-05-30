"use client";

import { AlertTriangle, CheckCircle2, Download, Loader2, Users } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { ImportJobDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { downloadErrorReportCsv, getImportJob } from "@/lib/imports/api";
import { Wizard } from "@/lib/imports/wizard-ui";

// /staff/import/[jobId]/done — Slice 10 cp3 step 4 (final).
//
// Mirrors the students done page (poll while COMMITTING; COMPLETED renders
// the results panel + optional error-report download; FAILED renders the
// error panel). Teacher commit mints one Invitation per good row.
//
// Accept-URL caveat: email delivery via Resend is deferred (Phase 4), so the
// commit worker LOGS each teacher's accept URL to the API console
// (`[INVITATION] <url>`) and we don't store the raw token. For a bulk import
// the operator must currently copy those URLs from the worker logs. We say
// so plainly here rather than imply the teachers were emailed. Tracked in
// docs/deferred.md ("bulk teacher-invite accept-URL delivery").

const POLL_INTERVAL_MS = 2000;

export default function ImportTeachersDonePage() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;

  const [job, setJob] = useState<ImportJobDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [elapsed, setElapsed] = useState(0);

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
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setError("That import job no longer exists.");
          return;
        }
        setError(
          e instanceof ApiError ? e.message : "Could not load import job.",
        );
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
          <Link href="/staff/import">Back to import</Link>
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

  if (job.status === "COMMITTING") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Wizard.Header step={4} title="Sending invitations" />
        <Wizard.PollingSkeleton
          label={`Inviting ${job.validRows} ${
            job.validRows === 1 ? "teacher" : "teachers"
          }…`}
          elapsedSeconds={elapsed}
        />
      </div>
    );
  }

  if (job.status === "FAILED") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Wizard.Header step={4} title="Import failed" />
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
            <Link href="/staff/import">Back to import</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (job.status !== "COMPLETED") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Wizard.Header step={4} title="Import isn't ready yet" />
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
          This import is currently <strong>{job.status.toLowerCase()}</strong>.
          You can&apos;t see results until it finishes.
        </div>
        <Button asChild variant="outline">
          <Link href={`/staff/import/${jobId}/preview`}>Back to preview</Link>
        </Button>
      </div>
    );
  }

  // COMPLETED.
  const commitTimeFailures = Math.max(0, job.validRows - job.committedRows);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Wizard.Header step={4} title="Invitations sent" />

      <div className="flex flex-col gap-4 rounded-md border border-emerald-300 bg-emerald-50 p-6 text-emerald-900">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-6 w-6" />
          <div className="flex flex-1 flex-col gap-1">
            <p className="text-lg font-semibold">
              Invited {job.committedRows.toLocaleString()}{" "}
              {job.committedRows === 1 ? "teacher" : "teachers"}.
            </p>
            {(commitTimeFailures > 0 || job.invalidRows > 0) && (
              <ul className="flex flex-col gap-0.5 text-sm">
                {commitTimeFailures > 0 && (
                  <li>
                    {commitTimeFailures.toLocaleString()}{" "}
                    {commitTimeFailures === 1 ? "row" : "rows"} failed during
                    commit (likely an email that already belongs to someone, or
                    an invitation already pending).
                  </li>
                )}
                {job.invalidRows > 0 && (
                  <li>
                    {job.invalidRows.toLocaleString()}{" "}
                    {job.invalidRows === 1 ? "row" : "rows"} listed in the error
                    report.
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
        <div className="flex flex-col">
          <p className="font-medium">Sharing the invite links</p>
          <p className="text-xs text-muted-foreground">
            Email delivery arrives in a later phase. For now each teacher&apos;s
            accept link is written to the server logs (search for{" "}
            <span className="font-mono">[INVITATION]</span>). Copy each link
            and send it to the teacher so they can set their password.
          </p>
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
          <Link href="/staff/import">Import another file</Link>
        </Button>
        <Button asChild>
          <Link href="/staff">
            <Users className="h-4 w-4" />
            View staff
          </Link>
        </Button>
      </div>
    </div>
  );
}
