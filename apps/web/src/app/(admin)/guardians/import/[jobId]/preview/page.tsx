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
  triggerImportCommit,
} from "@/lib/imports/api";
import { clearUploadResponse } from "@/lib/imports/session";
import { Wizard } from "@/lib/imports/wizard-ui";

// /guardians/import/[jobId]/preview — Slice 8 cp2 step 3.
//
// Same poll-self-rearming pattern as the slice 6/7 students preview; the
// only differences are the GoodRowsTable schema (guardian fields instead
// of student fields) and the navigation targets (/guardians/import vs
// /students/import).

const POLL_INTERVAL_MS = 2000;

export default function ImportGuardiansPreviewPage() {
  const router = useRouter();
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;

  const [job, setJob] = useState<ImportJobDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [committing, setCommitting] = useState(false);
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
        if (next.status === "VALIDATING") {
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

  const onCommit = useCallback(async () => {
    setCommitting(true);
    try {
      await triggerImportCommit(jobId);
      clearUploadResponse(jobId);
      router.push(`/guardians/import/${jobId}/done`);
    } catch (e) {
      toast.error(
        e instanceof ApiError
          ? e.message
          : "Could not start the import. Try again.",
      );
      setCommitting(false);
    }
  }, [jobId, router]);

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
      router.push("/guardians/import");
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
          <Link href="/guardians/import">Back to upload</Link>
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

  if (job.status === "PENDING") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
          This import is still awaiting column mapping.
        </div>
        <Button asChild>
          <Link href={`/guardians/import/${jobId}/mapping`}>
            Go to mapping →
          </Link>
        </Button>
      </div>
    );
  }

  if (job.status === "VALIDATING") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Wizard.Header step={3} title="Validating your rows" />
        <Wizard.PollingSkeleton
          label={`Validating ${job.totalRows} ${
            job.totalRows === 1 ? "row" : "rows"
          }…`}
          elapsedSeconds={elapsed}
        />
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
        <Wizard.Header step={3} title="Validation failed" />
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
        <Wizard.Header step={3} title="Import already in progress" />
        <div className="rounded-md border bg-muted/30 p-4 text-sm">
          This import is{" "}
          <strong>
            {job.status === "COMMITTING" ? "committing" : "complete"}
          </strong>
          .
        </div>
        <Button asChild>
          <Link href={`/guardians/import/${jobId}/done`}>
            Go to results →
          </Link>
        </Button>
      </div>
    );
  }

  // READY — render the two panels.
  const goodRows = job.previewSnapshot?.good ?? [];
  const badRows = job.previewSnapshot?.bad ?? [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <Wizard.Header step={3} title="Review and import" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Wizard.SummaryCard
          tone="success"
          icon={<CheckCircle2 className="h-5 w-5" />}
          title={`Ready to import (${job.validRows})`}
          subtitle={`${job.totalRows} ${
            job.totalRows === 1 ? "row" : "rows"
          } in your file · showing first ${goodRows.length}`}
        />
        <Wizard.SummaryCard
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
          <Wizard.EmptyPanel>No rows passed validation.</Wizard.EmptyPanel>
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
          <Wizard.EmptyPanel>No rows need fixing.</Wizard.EmptyPanel>
        ) : (
          <Wizard.BadRowsTable rows={badRows} />
        )}
      </section>

      <div className="flex flex-col items-stretch justify-between gap-3 rounded-md border bg-muted/30 p-4 sm:flex-row sm:items-center">
        <div className="text-sm">
          <p className="font-medium">
            Commit {job.validRows}{" "}
            {job.validRows === 1 ? "guardian link" : "guardian links"}?
          </p>
          <p className="text-xs text-muted-foreground">
            {job.invalidRows > 0
              ? "The rows in “Needs fixing” will be skipped. You can still download them and re-import later."
              : "Every row looks good. Commit when you're ready."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onAbort}
            disabled={aborting || committing}
          >
            <X className="h-4 w-4" />
            {aborting ? "Discarding…" : "Discard import"}
          </Button>
          <Button
            type="button"
            onClick={onCommit}
            disabled={committing || aborting || job.validRows === 0}
            title={
              job.validRows === 0
                ? "No rows passed validation — fix the bad rows and re-upload."
                : undefined
            }
          >
            {committing && <Loader2 className="h-4 w-4 animate-spin" />}
            {committing
              ? "Starting import…"
              : `Commit ${job.validRows} ${
                  job.validRows === 1 ? "row" : "rows"
                }`}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Guardian-specific good-rows preview. Columns chosen for at-a-glance
// readability — admins want to verify "the right parent is linked to
// the right child" before committing. Phone and relationship help
// distinguish two parents at the same household.
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
            <th className="px-3 py-2 font-medium">Ward Admission #</th>
            <th className="px-3 py-2 font-medium">Guardian</th>
            <th className="px-3 py-2 font-medium">Relationship</th>
            <th className="px-3 py-2 font-medium">Phone</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.rowNumber} className="border-t">
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                {r.rowNumber}
              </td>
              <td className="px-3 py-2 font-mono text-xs">
                {String(r.parsedRow.studentAdmissionNumber ?? "")}
              </td>
              <td className="px-3 py-2">
                {String(r.parsedRow.lastName ?? "")},{" "}
                {String(r.parsedRow.firstName ?? "")}
              </td>
              <td className="px-3 py-2 text-xs">
                {String(r.parsedRow.relationship ?? "")}
              </td>
              <td className="px-3 py-2 font-mono text-xs">
                {String(r.parsedRow.phone ?? "")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
