"use client";

import { AlertTriangle, ArrowRight, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  GUARDIAN_IMPORT_REQUIRED_FIELDS,
  GUARDIAN_IMPORT_TARGET_FIELDS,
  IMPORT_DATE_FORMATS,
  type GuardianImportTargetField,
  type ImportBlankHandling,
  type ImportDateFormat,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  applyGuardiansImportMapping,
  deleteImportJob,
  getImportJob,
} from "@/lib/imports/api";
import {
  clearUploadResponse,
  loadUploadResponse,
  type UploadSessionData,
} from "@/lib/imports/session";
import {
  detectMissingNameSplit,
  guessGuardianTargetField,
} from "@/lib/imports/guardian-synonyms";

// /guardians/import/[jobId]/mapping — Slice 8 cp2 step 2.
//
// Same shape as the students mapping page (sessionStorage bridge,
// auto-guess + manual override, required-field guard before validate),
// but with a guardian-specific synonym table and ONE extra UX
// guardrail: combined-name detection. When the file has a single
// "Parent Name" / "Guardian Name" / "Name" / "Full Name" header AND
// no separate first/lastName columns can be derived, an inline amber
// note appears next to that column's dropdown explaining to split it
// into separate columns and re-upload.

const TARGET_FIELD_LABELS: Record<GuardianImportTargetField, string> = {
  studentAdmissionNumber: "Student admission number",
  firstName: "First name",
  lastName: "Last name",
  relationship: "Relationship",
  phone: "Phone",
  email: "Email",
  occupation: "Occupation",
  employer: "Employer",
  address: "Address",
  notes: "Notes",
  isPrimary: "Is primary",
  canPickup: "Can pickup",
};

const REQUIRED_FIELD_SET = new Set<GuardianImportTargetField>(
  GUARDIAN_IMPORT_REQUIRED_FIELDS,
);

const DATE_FORMAT_LABELS: Record<ImportDateFormat, string> = {
  "DD/MM/YYYY": "DD/MM/YYYY (15/09/2012)",
  "MM/DD/YYYY": "MM/DD/YYYY (09/15/2012)",
  "YYYY-MM-DD": "YYYY-MM-DD (2012-09-15)",
};

export default function ImportGuardiansMappingPage() {
  const router = useRouter();
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;

  const [session, setSession] = useState<UploadSessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mapping, setMapping] = useState<
    Record<string, GuardianImportTargetField | null>
  >({});
  // dateFormat is irrelevant for guardian imports (no date columns in
  // GUARDIAN_IMPORT_TARGET_FIELDS today), but the shared importOptionsSchema
  // still carries the field. We default to the Nigerian common case and
  // render the radio for symmetry with the student wizard; the validate
  // engine ignores it for guardians.
  const [dateFormat, setDateFormat] =
    useState<ImportDateFormat>("DD/MM/YYYY");
  const [treatBlankAs, setTreatBlankAs] =
    useState<ImportBlankHandling>("skip");

  const [submitting, setSubmitting] = useState(false);
  const [aborting, setAborting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const job = await getImportJob(jobId);
        if (cancelled) return;
        if (job.status === "VALIDATING" || job.status === "READY") {
          router.replace(`/guardians/import/${jobId}/preview`);
          return;
        }
        if (job.status === "COMPLETED" || job.status === "FAILED") {
          toast.message(
            `This import is already ${job.status.toLowerCase()}. Start a new import to continue.`,
          );
          router.replace("/students");
          return;
        }
        // status === "PENDING"
        const upload = loadUploadResponse(jobId);
        if (!upload) {
          toast.error(
            "Your upload session has expired. Please upload the file again.",
          );
          router.replace("/guardians/import");
          return;
        }
        if (cancelled) return;
        setSession(upload);
        const initial: Record<string, GuardianImportTargetField | null> = {};
        const claimed = new Set<GuardianImportTargetField>();
        for (const header of upload.headers) {
          const guess = guessGuardianTargetField(header);
          if (guess && !claimed.has(guess)) {
            initial[header] = guess;
            claimed.add(guess);
          } else {
            initial[header] = null;
          }
        }
        setMapping(initial);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          toast.error("That import job no longer exists.");
          router.replace("/guardians/import");
          return;
        }
        setError(
          e instanceof ApiError
            ? e.message
            : "Could not load the import job. Try again.",
        );
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, router]);

  const usedFields = useMemo(() => {
    const counts = new Map<GuardianImportTargetField, number>();
    for (const value of Object.values(mapping)) {
      if (value === null) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
  }, [mapping]);

  const missingRequired = useMemo(
    () => GUARDIAN_IMPORT_REQUIRED_FIELDS.filter((f) => !usedFields.has(f)),
    [usedFields],
  );

  const duplicates = useMemo(
    () =>
      [...usedFields.entries()]
        .filter(([, count]) => count > 1)
        .map(([f]) => f),
    [usedFields],
  );

  // Combined-name detection — fires once the session is loaded. The
  // {combinedHeader, needsSplit} tuple drives an inline note next to
  // the matching column dropdown in the mapping table below.
  const combinedNameWarning = useMemo(
    () => (session ? detectMissingNameSplit(session.headers) : null),
    [session],
  );

  const canValidate =
    missingRequired.length === 0 && duplicates.length === 0 && !submitting;

  const handleChange = useCallback(
    (header: string, value: string) => {
      setMapping((prev) => ({
        ...prev,
        [header]: value === "" ? null : (value as GuardianImportTargetField),
      }));
    },
    [],
  );

  const onValidate = useCallback(async () => {
    if (!canValidate) return;
    setSubmitting(true);
    try {
      await applyGuardiansImportMapping(jobId, {
        columnMapping: mapping,
        options: { dateFormat, treatBlankAs },
      });
      clearUploadResponse(jobId);
      router.push(`/guardians/import/${jobId}/preview`);
    } catch (e) {
      if (e instanceof ApiError) {
        toast.error(e.message);
      } else {
        toast.error("Could not submit mapping. Try again.");
      }
      setSubmitting(false);
    }
  }, [canValidate, jobId, mapping, dateFormat, treatBlankAs, router]);

  const onAbort = useCallback(async () => {
    if (
      !window.confirm(
        "Cancel this import? The uploaded file will be discarded.",
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

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-5xl items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading mapping…
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error ?? "Mapping is not available for this job."}
        </div>
        <Button asChild variant="outline">
          <Link href="/guardians/import">Back to upload</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Step 2 of 4
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Map your columns
        </h1>
        <p className="text-sm text-muted-foreground">
          We&apos;ve guessed where we can — review each row, then validate.
          Your file has <strong>{session.totalRows}</strong>{" "}
          {session.totalRows === 1 ? "row" : "rows"}.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="dateFormat"
            className="text-sm font-medium"
          >
            Date format
          </label>
          <select
            id="dateFormat"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={dateFormat}
            onChange={(e) =>
              setDateFormat(e.target.value as ImportDateFormat)
            }
          >
            {IMPORT_DATE_FORMATS.map((fmt) => (
              <option key={fmt} value={fmt}>
                {DATE_FORMAT_LABELS[fmt]}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Guardian imports don&apos;t currently have a date column —
            kept for symmetry with other imports.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="treatBlankAs"
            className="text-sm font-medium"
          >
            Blank values
          </label>
          <select
            id="treatBlankAs"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={treatBlankAs}
            onChange={(e) =>
              setTreatBlankAs(e.target.value as ImportBlankHandling)
            }
          >
            <option value="skip">Skip (leave optional fields empty)</option>
            <option value="error">
              Reject (treat any blank as a row error)
            </option>
          </select>
          <p className="text-xs text-muted-foreground">
            How to handle empty cells in optional columns. Required fields
            are always errors when blank.
          </p>
        </div>
      </section>

      {(missingRequired.length > 0 || duplicates.length > 0) && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
          {missingRequired.length > 0 && (
            <p>
              <strong>Required fields not yet mapped:</strong>{" "}
              {missingRequired.map((f) => TARGET_FIELD_LABELS[f]).join(", ")}.
            </p>
          )}
          {duplicates.length > 0 && (
            <p className="mt-1">
              <strong>Same target chosen twice:</strong>{" "}
              {duplicates.map((f) => TARGET_FIELD_LABELS[f]).join(", ")}.
            </p>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">CSV column</th>
              <th className="px-3 py-2 font-medium">First 3 values</th>
              <th className="px-3 py-2 font-medium">Maps to</th>
            </tr>
          </thead>
          <tbody>
            {session.headers.map((header) => (
              <MappingRow
                key={header}
                header={header}
                samples={session.sampleRows
                  .slice(0, 3)
                  .map((row) => row[header] ?? "")}
                value={mapping[header] ?? null}
                onChange={(v) => handleChange(header, v)}
                usedFields={usedFields}
                showCombinedNameNote={
                  combinedNameWarning?.needsSplit === true &&
                  combinedNameWarning.combinedHeader === header
                }
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
        <Button
          type="button"
          variant="ghost"
          onClick={onAbort}
          disabled={aborting || submitting}
        >
          <X className="h-4 w-4" />
          {aborting ? "Cancelling…" : "Cancel import"}
        </Button>
        <Button
          type="button"
          onClick={onValidate}
          disabled={!canValidate}
          title={
            !canValidate && missingRequired.length > 0
              ? "Map every required field before validating."
              : !canValidate && duplicates.length > 0
                ? "Each target field can only be mapped once."
                : undefined
          }
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting ? "Validating…" : "Validate"}
          {!submitting && <ArrowRight className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

interface MappingRowProps {
  header: string;
  samples: string[];
  value: GuardianImportTargetField | null;
  onChange: (v: string) => void;
  usedFields: Map<GuardianImportTargetField, number>;
  showCombinedNameNote: boolean;
}

function MappingRow({
  header,
  samples,
  value,
  onChange,
  usedFields,
  showCombinedNameNote,
}: MappingRowProps) {
  const isDuplicate = value !== null && (usedFields.get(value) ?? 0) > 1;
  return (
    <tr className="border-t">
      <td className="px-3 py-2 align-top">
        <span className="font-mono text-xs">{header || "(blank)"}</span>
      </td>
      <td className="px-3 py-2 align-top">
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {samples.map((s, i) => (
            <li key={i} className="truncate">
              {s || <span className="italic">(empty)</span>}
            </li>
          ))}
          {samples.length === 0 && (
            <li className="italic">(no sample rows)</li>
          )}
        </ul>
      </td>
      <td className="px-3 py-2 align-top">
        <select
          className={`h-9 w-full max-w-xs rounded-md border bg-background px-3 text-sm ${
            isDuplicate
              ? "border-amber-400 ring-1 ring-amber-300"
              : "border-input"
          }`}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— Don&apos;t import —</option>
          {GUARDIAN_IMPORT_TARGET_FIELDS.map((field) => (
            <option key={field} value={field}>
              {TARGET_FIELD_LABELS[field]}
              {REQUIRED_FIELD_SET.has(field) ? " *" : ""}
            </option>
          ))}
        </select>
        {showCombinedNameNote && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              This looks like a combined name. Please add separate{" "}
              <strong>First Name</strong> and <strong>Surname</strong>{" "}
              columns to your CSV and re-upload.
            </p>
          </div>
        )}
      </td>
    </tr>
  );
}
