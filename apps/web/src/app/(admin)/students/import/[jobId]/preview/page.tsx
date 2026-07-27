"use client";

import { AlertTriangle, CheckCircle2, Download, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { ImportJobDto } from "@school-kit/types";

import { IMPORT_WIZARD_STEPS, WizardStepper } from "@/components/shared/wizard-stepper";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError } from "@/lib/api-client";
import {
  deleteImportJob,
  downloadBadRowsCsv,
  getImportJob,
  triggerImportCommit,
} from "@/lib/imports/api";
import { clearUploadResponse } from "@/lib/imports/session";
import { Wizard } from "@/lib/imports/wizard-ui";

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
  const [committing, setCommitting] = useState(false);
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

  const onCommit = useCallback(async () => {
    setCommitting(true);
    try {
      await triggerImportCommit(jobId);
      // Step-1's sessionStorage headers/sampleRows are no longer needed
      // — the /done page is jobId-driven. Clear so a refresh of step 2
      // doesn't reuse a stale snapshot for an already-committed job.
      clearUploadResponse(jobId);
      router.push(`/students/import/${jobId}/done`);
    } catch (e) {
      // Defensive — the READY status guard makes this unreachable in
      // normal flow, but if the worker raced ahead (or another tab
      // committed first) the user gets a clear toast and stays on
      // the preview screen rather than seeing an empty /done page.
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
        <WizardStepper steps={IMPORT_WIZARD_STEPS} currentStep={3} title="Validating your rows" />
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
        <WizardStepper steps={IMPORT_WIZARD_STEPS} currentStep={3} title="Validation failed" />
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
    // The job already moved past preview — route the admin to the /done
    // screen which is the canonical home for COMMITTING/COMPLETED state.
    // Renders an intermediate panel in case the redirect hasn't fired yet
    // (Server Components hydration race) or is blocked.
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <WizardStepper steps={IMPORT_WIZARD_STEPS} currentStep={3} title="Import already in progress" />
        <div className="rounded-md border bg-muted/30 p-4 text-sm">
          This import is{" "}
          <strong>
            {job.status === "COMMITTING" ? "committing" : "complete"}
          </strong>
          .
        </div>
        <Button asChild>
          <Link href={`/students/import/${jobId}/done`}>
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
      <WizardStepper steps={IMPORT_WIZARD_STEPS} currentStep={3} title="Review and import" />

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
            {job.validRows === 1 ? "student" : "students"}?
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
                  job.validRows === 1 ? "student" : "students"
                }`}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Header / SummaryCard / EmptyPanel / BadRowsTable / formatElapsed moved
// to `@/lib/imports/wizard-ui` in slice 8 cp2. GoodRowsTable stays local
// because it's student-specific (admission #, name, DOB, gender columns);
// the guardian wizard has its own variant.

interface GoodRow {
  rowNumber: number;
  parsedRow: Record<string, unknown>;
}

function GoodRowsTable({ rows }: { rows: GoodRow[] }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Row</TableHead>
            <TableHead>Admission #</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>DOB</TableHead>
            <TableHead>Gender</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.rowNumber}>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {r.rowNumber}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {String(r.parsedRow.admissionNumber ?? "")}
              </TableCell>
              <TableCell>
                {String(r.parsedRow.lastName ?? "")},{" "}
                {String(r.parsedRow.firstName ?? "")}
                {r.parsedRow.middleName
                  ? ` ${String(r.parsedRow.middleName).charAt(0)}.`
                  : ""}
              </TableCell>
              <TableCell className="text-xs">
                {formatDob(r.parsedRow.dateOfBirth)}
              </TableCell>
              <TableCell className="text-xs">
                {String(r.parsedRow.gender ?? "")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// BadRowsTable + BadRow type + formatElapsed moved to wizard-ui in cp2.

function formatDob(raw: unknown): string {
  // Validate worker stores Date objects in previewSnapshot.parsedRow which
  // JSON-roundtrip to ISO strings. Slice off the time portion for display.
  if (typeof raw === "string") return raw.slice(0, 10);
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return "";
}
