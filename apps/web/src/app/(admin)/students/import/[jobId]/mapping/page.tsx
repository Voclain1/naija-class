"use client";

import { ArrowRight, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  IMPORT_DATE_FORMATS,
  STUDENT_IMPORT_REQUIRED_FIELDS,
  STUDENT_IMPORT_TARGET_FIELDS,
  type StudentImportBlankHandling,
  type StudentImportDateFormat,
  type StudentImportTargetField,
} from "@school-kit/types";

import { IMPORT_WIZARD_STEPS, WizardStepper } from "@/components/shared/wizard-stepper";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError } from "@/lib/api-client";
import { importMappingErrorMessage } from "@/lib/imports/mapping-error-copy";
import {
  applyStudentsImportMapping,
  deleteImportJob,
  getImportJob,
} from "@/lib/imports/api";
import {
  clearUploadResponse,
  loadUploadResponse,
  type UploadSessionData,
} from "@/lib/imports/session";
import { guessTargetField } from "@/lib/imports/synonyms";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { mapWithConcurrency } from "@/lib/concurrency";

// /students/import/[jobId]/mapping — Slice 6 cp4 step 2.
//
// On mount: GET job → confirm status; load headers/sampleRows from
// sessionStorage (parked by step 1). If sessionStorage is empty, redirect
// to /students/import. Auto-guess via the synonym table; admin can
// override every dropdown. Validate CTA disabled until all required
// fields are mapped.

const TARGET_FIELD_LABELS: Record<StudentImportTargetField, string> = {
  admissionNumber: "Admission number",
  firstName: "First name",
  middleName: "Middle name",
  lastName: "Last name",
  dateOfBirth: "Date of birth",
  gender: "Gender",
  phone: "Phone",
  email: "Email",
  address: "Address",
  photoUrl: "Photo URL",
  bloodGroup: "Blood group",
  religion: "Religion",
  stateOfOrigin: "State of origin",
  classArm: "Class arm (enrols the student)",
};

const REQUIRED_FIELD_SET = new Set<StudentImportTargetField>(
  STUDENT_IMPORT_REQUIRED_FIELDS,
);

interface TermOption {
  id: string;
  label: string;
  isCurrent: boolean;
}

const DATE_FORMAT_LABELS: Record<StudentImportDateFormat, string> = {
  "DD/MM/YYYY": "DD/MM/YYYY (15/09/2012)",
  "MM/DD/YYYY": "MM/DD/YYYY (09/15/2012)",
  "YYYY-MM-DD": "YYYY-MM-DD (2012-09-15)",
};

export default function ImportStudentsMappingPage() {
  const router = useRouter();
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;

  const [session, setSession] = useState<UploadSessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // mapping: csvHeader → target field | null
  const [mapping, setMapping] = useState<
    Record<string, StudentImportTargetField | null>
  >({});
  const [dateFormat, setDateFormat] =
    useState<StudentImportDateFormat>("DD/MM/YYYY");
  const [treatBlankAs, setTreatBlankAs] =
    useState<StudentImportBlankHandling>("skip");

  // Enrollment target for the optional class-arm column (2026-08-09).
  // Starts EMPTY on purpose — no silent default to the current term. See
  // docs/modules/student-import-enrollment.md D3: a default is most
  // dangerous exactly when it is most likely wrong (a school onboarding
  // mid-transition between terms would enrol its whole roster into the
  // wrong one, with nothing downstream to flag it). The server enforces
  // the same rule; this is just the friendlier half of it.
  // Terms are nested under academic years, so the options list is built by
  // fetching years then their terms. Labelled with the year ("2025/2026 —
  // First Term") because a school onboarding mid-session may legitimately
  // be enrolling into a term of a year that isn't the current one, and
  // "First Term" alone would be ambiguous across years.
  const [terms, setTerms] = useState<TermOption[] | null>(null);
  const [targetTermId, setTargetTermId] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);
  const [aborting, setAborting] = useState(false);

  // Initial load: GET job to verify status; pull headers+samples from
  // sessionStorage. If status has moved on (VALIDATING/READY) we route to
  // the preview screen instead of forcing re-mapping.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const job = await getImportJob(jobId);
        if (cancelled) return;
        if (job.status === "VALIDATING" || job.status === "READY") {
          router.replace(`/students/import/${jobId}/preview`);
          return;
        }
        if (job.status === "COMPLETED" || job.status === "FAILED") {
          // The wizard doesn't know what to do here — kick back to roster
          // with a toast. Re-importing means starting a new job.
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
          router.replace("/students/import");
          return;
        }
        if (cancelled) return;
        setSession(upload);
        // Seed mapping by auto-guessing each header.
        const initial: Record<string, StudentImportTargetField | null> = {};
        // Track which target fields we've already claimed so two headers
        // don't auto-guess to the same field (would fail server validation).
        const claimed = new Set<StudentImportTargetField>();
        for (const header of upload.headers) {
          const guess = guessTargetField(header);
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
          router.replace("/students/import");
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

  // Derived: which target fields are currently mapped (to detect duplicates
  // and unmet requirements).
  const usedFields = useMemo(() => {
    const counts = new Map<StudentImportTargetField, number>();
    for (const value of Object.values(mapping)) {
      if (value === null) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
  }, [mapping]);

  const missingRequired = useMemo(
    () => STUDENT_IMPORT_REQUIRED_FIELDS.filter((f) => !usedFields.has(f)),
    [usedFields],
  );

  const duplicates = useMemo(
    () =>
      [...usedFields.entries()]
        .filter(([, count]) => count > 1)
        .map(([f]) => f),
    [usedFields],
  );

  // Is the class-arm column mapped? Drives both the term selector's
  // visibility and whether a term is required before submitting.
  const mapsClassArm = usedFields.has("classArm");

  // Load terms lazily — only once the admin actually maps a class-arm
  // column. Most imports never do, and this screen shouldn't pay for a
  // request it doesn't need.
  useEffect(() => {
    if (!mapsClassArm || terms !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const years = await listAcademicYears();
        // Bounded fan-out, not Promise.all — same reason /enrollments/bulk
        // uses this helper: a burst of simultaneous withTenant transactions
        // can outrun the tenant client's retry budget when Neon is cold.
        const perYear = await mapWithConcurrency(years, 4, async (year) => {
          const yearTerms = await listTerms(year.id);
          return yearTerms.map((term) => ({
            id: term.id,
            label: `${year.label} — ${term.name}`,
            isCurrent: term.isCurrent,
          }));
        });
        if (!cancelled) setTerms(perYear.flat());
      } catch {
        if (!cancelled) {
          setTerms([]);
          toast.error("Could not load terms. Reload the page to try again.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mapsClassArm, terms]);

  // No silent default: mapping the column WITHOUT choosing a term blocks
  // the CTA. The server enforces the same rule (TARGET_TERM_REQUIRED) — this
  // just surfaces it before a round-trip.
  const needsTerm = mapsClassArm && targetTermId === "";

  const canValidate =
    missingRequired.length === 0 &&
    duplicates.length === 0 &&
    !needsTerm &&
    !submitting;

  const handleChange = useCallback(
    (header: string, value: string) => {
      setMapping((prev) => ({
        ...prev,
        [header]: value === "" ? null : (value as StudentImportTargetField),
      }));
    },
    [],
  );

  const onValidate = useCallback(async () => {
    if (!canValidate) return;
    setSubmitting(true);
    try {
      await applyStudentsImportMapping(jobId, {
        columnMapping: mapping,
        options: {
          dateFormat,
          treatBlankAs,
          // Only sent when the class-arm column is actually mapped —
          // otherwise the field stays absent rather than being sent as an
          // empty string, which the server's uuid() check would reject.
          ...(mapsClassArm && targetTermId ? { targetTermId } : {}),
        },
      });
      // Mapping accepted — server enqueued the validate worker. We can
      // safely drop the upload-session bridge; the preview page only
      // needs the job row, which it polls directly.
      clearUploadResponse(jobId);
      router.push(`/students/import/${jobId}/preview`);
    } catch (e) {
      toast.error(importMappingErrorMessage(e));
      setSubmitting(false);
    }
  }, [
    canValidate,
    jobId,
    mapping,
    dateFormat,
    treatBlankAs,
    mapsClassArm,
    targetTermId,
    router,
  ]);

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
          <Link href="/students/import">Back to upload</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <WizardStepper steps={IMPORT_WIZARD_STEPS} currentStep={2} title="Map your columns" />
      <p className="text-sm text-muted-foreground">
        We&apos;ve guessed where we can — review each row, then validate.
        Your file has <strong>{session.totalRows}</strong>{" "}
        {session.totalRows === 1 ? "row" : "rows"}.
      </p>

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
              setDateFormat(e.target.value as StudentImportDateFormat)
            }
          >
            {IMPORT_DATE_FORMATS.map((fmt) => (
              <option key={fmt} value={fmt}>
                {DATE_FORMAT_LABELS[fmt]}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            How dates are written in your CSV. Nigerian schools usually use
            DD/MM/YYYY.
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
              setTreatBlankAs(e.target.value as StudentImportBlankHandling)
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

      {/* Only rendered once a class-arm column is mapped. Deliberately has
          no pre-selected value — see the targetTermId state declaration. */}
      {mapsClassArm && (
        <section className="rounded-md border border-primary/30 bg-primary/5 p-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="targetTermId" className="text-sm font-medium">
              Enrol these students into which term?
            </label>
            <select
              id="targetTermId"
              className="h-10 max-w-md rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={targetTermId}
              onChange={(e) => setTargetTermId(e.target.value)}
              disabled={terms === null}
            >
              <option value="">
                {terms === null ? "Loading terms…" : "Choose a term…"}
              </option>
              {(terms ?? []).map((term) => (
                <option key={term.id} value={term.id}>
                  {term.label}
                  {term.isCurrent ? " (current term)" : ""}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              You mapped a <strong>Class arm</strong> column, so each student
              will also be enrolled into that class. Every student in this
              file goes into the term you pick here.
            </p>
            {terms !== null && terms.length === 0 && (
              <p className="text-xs text-destructive">
                This school has no terms yet. Create one under Settings →
                Academic → Years, or unmap the class arm column to import
                students without enrolling them.
              </p>
            )}
          </div>
        </section>
      )}

      {(missingRequired.length > 0 || duplicates.length > 0 || needsTerm) && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
          {needsTerm && (
            <p>
              <strong>Choose a term</strong> above before continuing — you
              mapped a class arm column, so we need to know which term to
              enrol these students into.
            </p>
          )}
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>CSV column</TableHead>
              <TableHead>First 3 values</TableHead>
              <TableHead>Maps to</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
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
              />
            ))}
          </TableBody>
        </Table>
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
  value: StudentImportTargetField | null;
  onChange: (v: string) => void;
  usedFields: Map<StudentImportTargetField, number>;
}

function MappingRow({
  header,
  samples,
  value,
  onChange,
  usedFields,
}: MappingRowProps) {
  const isDuplicate = value !== null && (usedFields.get(value) ?? 0) > 1;
  return (
    <TableRow>
      <TableCell className="align-top">
        <span className="font-mono text-xs">{header || "(blank)"}</span>
      </TableCell>
      <TableCell className="align-top">
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
      </TableCell>
      <TableCell className="align-top">
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
          {STUDENT_IMPORT_TARGET_FIELDS.map((field) => (
            <option key={field} value={field}>
              {TARGET_FIELD_LABELS[field]}
              {REQUIRED_FIELD_SET.has(field) ? " *" : ""}
            </option>
          ))}
        </select>
      </TableCell>
    </TableRow>
  );
}
