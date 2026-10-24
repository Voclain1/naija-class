"use client";

import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  SCAN_RATINGS,
  SCAN_RATING_LABELS,
  type AdmissionNumberSettingsDto,
  type ExtractedStudentRow,
  type ReviewedStudentRow,
  type ScanConsentDto,
  type ScanRating,
  type ScanUnavailableReason,
} from "@school-kit/types";

import { useAdmissionNumbers } from "@/components/students/admission-numbers";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
  commitScan,
  getScanAvailability,
  recordScanConsent,
  scanStudentRegister,
  type ScanCommitResult,
} from "@/lib/student-scan/api";

// /students/scan — Smart Student Import.
// docs/modules/smart-student-import.md.
//
// ---------------------------------------------------------------------------
// ONE PAGE, THREE PHASES — capture, review, done — rather than the CSV
// wizard's three routes. That is a privacy decision, not a styling one.
//
// The CSV wizard parks its upload response in sessionStorage so the mapping
// route can render without a refetch (see lib/imports/session.ts). Doing the
// same here would write forty children's names, dates of birth and guardian
// phone numbers into browser storage, where they would outlive the task and
// sit readable to anything with access to the machine.
//
// D3 keeps the captured IMAGE out of server storage; parking its transcribed
// contents in sessionStorage would hand the same PII to a different store and
// call it a different decision. So the extracted rows live in React state and
// nowhere else: navigating away loses them, which is the correct trade for
// data this sensitive and a task this short.
// ---------------------------------------------------------------------------

type Phase = "capture" | "review" | "done";

// The beta (2026-10-24): said plainly on every step. Tinted, never an accent
// border. No AI company is named anywhere on this page (owner's decision).
function BetaNotice() {
  return (
    <p className="rounded-md bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" data-testid="scan-beta-notice">
      <strong>Beta:</strong> SchoolKit reads the page with AI and can make mistakes. Check every row against
      the paper before you save.
    </p>
  );
}

// A row as the admin is editing it. Everything is a string because these are
// form inputs; the commit converts and the server re-validates.
interface EditableRow {
  key: string;
  rowNumber: number;
  admissionNumber: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dateOfBirth: string;
  gender: "MALE" | "FEMALE" | "OTHER" | "";
  classArm: string;
  // Carried through from the extraction so a cell the model could not read
  // stays visibly flagged until the admin actually touches it.
  unreadable: Set<string>;
  guardianName: string;
  guardianPhone: string;
}

function toEditable(row: ExtractedStudentRow, index: number): EditableRow {
  return {
    key: `${index}-${row.admissionNumber ?? "?"}`,
    rowNumber: index + 1,
    admissionNumber: row.admissionNumber ?? "",
    firstName: row.firstName ?? "",
    middleName: row.middleName ?? "",
    lastName: row.lastName ?? "",
    dateOfBirth: row.dateOfBirth ?? "",
    gender: row.gender ?? "",
    classArm: row.classArm ?? "",
    unreadable: new Set(row.unreadableFields),
    guardianName: row.guardianName ?? "",
    guardianPhone: row.guardianPhone ?? "",
  };
}

// Required by the import pipeline. A row missing one of these cannot commit,
// so the button is disabled rather than letting the admin submit and read
// back a list of failures they could have seen up front.
const REQUIRED: (keyof EditableRow)[] = [
  "admissionNumber",
  "firstName",
  "lastName",
  "dateOfBirth",
  "gender",
];

// On automatic numbering a blank admission number is SchoolKit's to give
// (docs/modules/admission-numbers.md slice 2); per class, only with a class.
function rowIsComplete(row: EditableRow, numbering: AdmissionNumberSettingsDto | null): boolean {
  const auto = numbering?.mode === "AUTO";
  const numberOptional = auto && (numbering?.order !== "CLASS" || row.classArm.trim() !== "");
  return (
    REQUIRED.every((f) => (f === "admissionNumber" && numberOptional) || String(row[f]).trim() !== "") &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.dateOfBirth)
  );
}

export default function StudentScanPage() {
  const { settings: numbering } = useAdmissionNumbers();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("capture");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<ScanUnavailableReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [pageNotes, setPageNotes] = useState<string | null>(null);
  const [knownArms, setKnownArms] = useState<string[]>([]);
  const [result, setResult] = useState<ScanCommitResult | null>(null);
  const [consent, setConsent] = useState<ScanConsentDto | null>(null);
  const [agreeing, setAgreeing] = useState(false);
  const [checked, setChecked] = useState(false);
  const [rating, setRating] = useState<ScanRating | null>(null);

  useEffect(() => {
    getScanAvailability()
      .then((r) => {
        setAvailable(r.available);
        setUnavailableReason(r.reason);
        setConsent(r.consent);
      })
      .catch(() => setAvailable(false));
  }, []);

  // Extraction is synchronous and can run 30-60s on a full page (D3 — there
  // is no stored image for a worker to pick up). A spinner alone reads as a
  // hang at that length, so the elapsed count gives the admin evidence that
  // something is still happening.
  useEffect(() => {
    if (!busy || phase !== "capture") return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [busy, phase]);

  const handleFile = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    setElapsed(0);
    try {
      const res = await scanStudentRegister(file);
      setJobId(res.jobId);
      setRows(res.rows.map(toEditable));
      setPageNotes(res.pageNotes);
      setKnownArms(res.knownClassArms);
      setPhase("review");
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Could not reach the server. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, []);

  const update = useCallback((key: string, field: keyof EditableRow, value: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        // Touching a flagged cell clears its flag — the admin has now looked
        // at it, which is exactly what the flag was asking for.
        const unreadable = new Set(r.unreadable);
        unreadable.delete(field as string);
        return { ...r, [field]: value, unreadable };
      }),
    );
  }, []);

  const handleCommit = useCallback(async () => {
    if (!jobId) return;
    setBusy(true);
    setError(null);
    try {
      const payload: ReviewedStudentRow[] = rows.map((r) => ({
        rowNumber: r.rowNumber,
        ...(r.admissionNumber.trim() ? { admissionNumber: r.admissionNumber.trim() } : {}),
        firstName: r.firstName.trim(),
        lastName: r.lastName.trim(),
        dateOfBirth: r.dateOfBirth,
        gender: r.gender as "MALE" | "FEMALE" | "OTHER",
        ...(r.middleName.trim() ? { middleName: r.middleName.trim() } : {}),
        ...(r.classArm.trim() ? { classArm: r.classArm.trim() } : {}),
      }));
      setResult(await commitScan(jobId, { rows: payload, checked: true, ...(rating ? { rating } : {}) }));
      setPhase("done");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }, [jobId, rows, rating]);

  const agree = useCallback(async () => {
    setAgreeing(true);
    setError(null);
    try {
      setConsent(await recordScanConsent());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save your agreement. Try again.");
    } finally {
      setAgreeing(false);
    }
  }, []);

  const incomplete = rows.filter((r) => !rowIsComplete(r, numbering)).length;
  const flagged = rows.filter((r) => r.unreadable.size > 0).length;

  // -------------------------------------------------------------------------
  if (phase === "done" && result) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-8 w-8 text-primary" />
          <h1 className="font-serif text-3xl">
            {result.committedRows} student{result.committedRows === 1 ? "" : "s"} added
          </h1>
        </div>

        {result.notEnrolledRows > 0 && (
          <p className="rounded-md border border-secondary/40 bg-secondary/10 p-4 text-sm">
            {result.notEnrolledRows} of them were created without a class placement, because no
            class arm was recorded for them. You can place them from the student list.
          </p>
        )}

        {result.failedRows.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
            <p className="mb-2 text-sm font-medium">
              {result.failedRows.length} row{result.failedRows.length === 1 ? "" : "s"} could not
              be saved:
            </p>
            <ul className="space-y-1 text-sm">
              {result.failedRows.map((f) => (
                <li key={f.rowNumber}>
                  Row {f.rowNumber}: {f.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-3">
          <Button asChild>
            <Link href="/students">View students</Link>
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Scan another page
          </Button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  if (phase === "review") {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div>
          <h1 className="flex items-center gap-2 font-serif text-3xl">
            Check the details <Badge variant="warning">Beta</Badge>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing is saved until you press Add students. Read every name against the page you
            photographed — a name saved wrong here follows the child through the school.
          </p>
        </div>

        <BetaNotice />

        {pageNotes && (
          <p className="rounded-md border border-secondary/40 bg-secondary/10 p-4 text-sm">
            <strong>Note about this photo:</strong> {pageNotes}
          </p>
        )}

        {flagged > 0 && (
          <p className="flex items-start gap-2 rounded-md border border-secondary/40 bg-secondary/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {flagged} row{flagged === 1 ? " has a cell" : "s have cells"} that could not be read
              from the photo. They are highlighted below — type what the page says.
            </span>
          </p>
        )}

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            {error}
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[70rem] border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-2 font-medium">#</th>
                <th className="p-2 font-medium">Admission no.</th>
                <th className="p-2 font-medium">First name</th>
                <th className="p-2 font-medium">Middle</th>
                <th className="p-2 font-medium">Surname</th>
                <th className="p-2 font-medium">Date of birth</th>
                <th className="p-2 font-medium">Gender</th>
                <th className="p-2 font-medium">Class</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b align-top">
                  <td className="p-2 pt-4 text-muted-foreground">{row.rowNumber}</td>
                  {(
                    [
                      ["admissionNumber", "Admission no."],
                      ["firstName", "First name"],
                      ["middleName", "Middle"],
                      ["lastName", "Surname"],
                    ] as const
                  ).map(([field, label]) => (
                    <td key={field} className="p-2">
                      <Input
                        aria-label={`${label}, row ${row.rowNumber}`}
                        value={row[field]}
                        onChange={(e) => update(row.key, field, e.target.value)}
                        className={row.unreadable.has(field) ? "border-secondary bg-secondary/10" : ""}
                      />
                      {row.unreadable.has(field) && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          couldn&apos;t read — please fill in
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="p-2">
                    <Input
                      aria-label={`Date of birth, row ${row.rowNumber}`}
                      type="date"
                      value={row.dateOfBirth}
                      onChange={(e) => update(row.key, "dateOfBirth", e.target.value)}
                      className={row.unreadable.has("dateOfBirth") ? "border-secondary bg-secondary/10" : ""}
                    />
                    {row.unreadable.has("dateOfBirth") && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        couldn&apos;t read — please fill in
                      </span>
                    )}
                  </td>
                  <td className="p-2">
                    <select
                      aria-label={`Gender, row ${row.rowNumber}`}
                      value={row.gender}
                      onChange={(e) => update(row.key, "gender", e.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">—</option>
                      <option value="MALE">Male</option>
                      <option value="FEMALE">Female</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </td>
                  <td className="p-2">
                    <input
                      aria-label={`Class, row ${row.rowNumber}`}
                      list="known-class-arms"
                      value={row.classArm}
                      onChange={(e) => update(row.key, "classArm", e.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    />
                  </td>
                  <td className="p-2 pt-3">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove row ${row.rowNumber}`}
                      onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="known-class-arms">
            {knownArms.map((arm) => (
              <option key={arm} value={arm} />
            ))}
          </datalist>
        </div>

        {numbering?.mode === "AUTO" && (
          <p className="text-xs text-muted-foreground">
            A blank admission number is filled in by SchoolKit when you add the students
            {numbering.order === "CLASS" ? " (rows with a class only: your school numbers per class)" : ""}.
          </p>
        )}

        <div className="space-y-3 rounded-md bg-muted/50 p-4">
          <label className="flex items-start gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="mt-1"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              data-testid="scan-checked"
            />
            I have checked these rows against the register.
          </label>
          <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <legend className="mb-1 text-muted-foreground">How did the scan do? (optional, helps us improve it)</legend>
            {SCAN_RATINGS.map((r) => (
              <label key={r} className="flex items-center gap-1.5">
                <input type="radio" name="scan-rating" checked={rating === r} onChange={() => setRating(r)} />
                {SCAN_RATING_LABELS[r]}
              </label>
            ))}
          </fieldset>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Button onClick={handleCommit} disabled={busy || rows.length === 0 || incomplete > 0 || !checked}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add {rows.length} student{rows.length === 1 ? "" : "s"}
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()} disabled={busy}>
            Start over
          </Button>
          {incomplete > 0 ? (
            <span className="text-sm text-muted-foreground">
              {incomplete} row{incomplete === 1 ? "" : "s"} still need a required field.
            </span>
          ) : !checked ? (
            <span className="text-sm text-muted-foreground">Tick the box above once you have checked every row.</span>
          ) : null}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <Link
        href="/students"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Students
      </Link>

      <div>
        <h1 className="flex items-center gap-2 font-serif text-3xl">
          Scan a student list <Badge variant="warning">Beta</Badge>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Photograph one page of a class register — handwritten or printed. You will check every
          detail before anything is saved.
        </p>
      </div>

      <BetaNotice />

      {available === true && consent === null && (
        <div className="space-y-3 rounded-md bg-muted/50 p-4 text-sm" data-testid="scan-consent">
          <p className="font-medium">Before your school&apos;s first scan</p>
          <p>
            When you take a photo, SchoolKit sends it to the AI reading service it uses, to read the page.
            The photo is not kept: once the page has been read, it is thrown away, and nothing from it is
            saved except the rows you check and save.
          </p>
          <p>
            A register shows children&apos;s names and dates of birth, so only photograph your own
            school&apos;s registers. Agreeing here covers your whole school, and is recorded with your name.
          </p>
          <Button onClick={() => void agree()} disabled={agreeing}>
            {agreeing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}I agree for my school
          </Button>
        </div>
      )}

      {available === true && consent !== null && (
        <p className="text-xs text-muted-foreground">
          {consent.byName ? `${consent.byName} agreed` : "Your school agreed"} to how register photos are handled on{" "}
          {new Date(consent.at).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}.
        </p>
      )}

      {available === false && (
        <p className="rounded-md border border-secondary/40 bg-secondary/10 p-4 text-sm">
          {unavailableReason === "NOT_ENABLED"
            ? "Reading registers from a photo isn't switched on for your school yet. Ask the SchoolKit team to turn it on. "
            : "Reading registers from a photo needs AI features, which are switched off for your school. "}
          You can still{" "}
          <Link href="/students/import" className="underline">
            import students from a spreadsheet
          </Link>
          .
        </p>
      )}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          {error}
        </p>
      )}

      <div className="rounded-lg border border-dashed p-8 text-center">
        <Camera className="mx-auto h-10 w-10 text-muted-foreground" />
        <ul className="mx-auto mt-3 max-w-sm space-y-1 text-left text-sm text-muted-foreground" data-testid="scan-photo-tips">
          <li>One page at a time.</li>
          <li>Lay the page flat on a table, with good light, not under a ceiling fan&apos;s shadow.</li>
          <li>Fill the frame with the page, edges included, and hold the phone straight above it.</li>
          <li>Check the photo is sharp before you send it. A blurred name is a name read wrong.</li>
        </ul>

        <Label htmlFor="register-photo" className="sr-only">
          Register photo
        </Label>
        <Input
          ref={inputRef}
          id="register-photo"
          type="file"
          // `capture="environment"` opens the rear camera directly on a phone
          // browser. On desktop it is ignored and this stays an ordinary file
          // picker, so one control serves both without a device check.
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="sr-only"
          disabled={busy || available !== true || consent === null}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />

        <Button
          className="mt-5"
          disabled={busy || available !== true || consent === null}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
          {busy ? "Reading the page…" : "Take a photo"}
        </Button>

        {busy && (
          <p className="mt-3 text-xs text-muted-foreground">
            This usually takes under a minute for a full page. {elapsed}s
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        The photo is used to read the page and is not stored — it is not saved to this school&apos;s
        files and cannot be viewed again afterwards. If a page comes out badly, photograph it again.
      </p>
    </div>
  );
}
