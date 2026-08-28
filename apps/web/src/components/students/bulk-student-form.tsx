"use client";

import { AlertCircle, Check, Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import type { CreateStudentInput } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError } from "@/lib/api-client";
import { isTerminalAuthFailure, partialSaveNotice } from "@/lib/students/bulk-create";
import { createStudent } from "@/lib/students/students-api";

// /students/new/bulk — spreadsheet-like inline entry for adding several
// students at once. Deliberately NOT a shared abstraction with
// student-form.tsx: same field-validation rules are duplicated here rather
// than extracted, per the same "don't refactor the proven single-add path
// under time pressure" call made in this feature's plan-first. If the two
// forms drift, that's an acceptable cost for not destabilizing the
// highest-traffic student-creation flow same-day.
//
// FIELD SET (narrowed 2026-08-18): admission number, first/middle/last name,
// date of birth, gender, email. Everything else a Student can carry — phone,
// address, blood group, religion, state of origin, nationality, photo,
// medical notes, notes — is deliberately NOT captured here any more. Those
// are the student's or guardian's own details to supply after they activate
// their portal account (Phase 6 / Slice 3), and making a school secretary
// re-key 13 columns per child at intake was the single biggest cost in this
// screen. `nationality` is not sent at all: `students.nationality` carries a
// DB-level `@default("Nigerian")`, so omitting it stores exactly what the
// old always-prefilled column did. The narrowed set is also what makes a
// roster usable on day one — an admission number to key on, a name to
// search, a DOB for age-banding, a gender for reporting.
//
// Still deliberately excludes class arm + guardian info: neither the single-
// add form nor the CSV import bundles those into student creation —
// enrollment is a separate step via /enrollments/bulk, guardians via each
// student's own Guardians tab.
//
// SPEED AFFORDANCES (2026-08-18) — the grid is meant to be driven from the
// keyboard, never the mouse:
//   * Paste a block straight out of Excel/Sheets into any cell: it spreads
//     across columns and down rows, creating rows as needed. Dates written
//     dd/mm/yyyy and genders typed "M"/"F"/"male" are normalised on the way
//     in, because that is what real school spreadsheets actually contain.
//   * Enter moves down the same column (spreadsheet muscle memory) and
//     appends a row when pressed on the last one.
//   * Typing in the last row auto-appends a fresh blank row, so there is
//     never a trip back to "Add row".
//   * Entirely blank rows are ignored on submit rather than failing
//     validation — which is what makes the auto-append safe.
//
// Validation runs by hand in the submit handler rather than through
// zodResolver: the resolver validates every row in the array, and the
// blank-trailing-row rule above is precisely a "don't validate this row"
// decision the resolver has no way to express.
//
// Submission is a sequential loop of the existing POST /students (no new
// bulk endpoint, no BullMQ) — this doesn't have the CSV pipeline's
// large-file/dedupe complexity, just N simultaneous rows. Sequential (not
// parallel) is deliberate: it makes duplicate-admission-number-within-the-
// same-batch handling correct for free (row 2 only fires after row 1's
// response, so if row 1 committed, the server correctly rejects row 2 as
// ADMISSION_NUMBER_TAKEN) without any extra client-side dedupe code.
//
// A row that already succeeded is skipped on a later submit (re-clicking
// "Create students" after fixing a failed row's error only retries rows
// still idle/error) — created rows are never resubmitted or lost.

const GENDER_VALUES = ["MALE", "FEMALE", "OTHER"] as const;

const rowSchema = z.object({
  admissionNumber: z.string().trim().min(1, "Required").max(40, "Too long"),
  firstName: z.string().trim().min(1, "Required").max(60, "Too long"),
  middleName: z.string().trim().max(60, "Too long"),
  lastName: z.string().trim().min(1, "Required").max(60, "Too long"),
  dateOfBirth: z
    .string()
    .min(1, "Required")
    .refine((v) => !Number.isNaN(new Date(v).getTime()), "Invalid date"),
  gender: z.string().min(1, "Required"),
  email: z
    .string()
    .trim()
    .max(254, "Too long")
    .refine(
      (v) => v === "" || z.string().email().safeParse(v).success,
      "Invalid email",
    ),
});

type RowValues = z.infer<typeof rowSchema>;
type RowField = keyof RowValues;
type FormValues = { rows: RowValues[] };

/** Column order — drives paste spreading and Enter navigation. */
const COLUMNS = [
  "admissionNumber",
  "firstName",
  "middleName",
  "lastName",
  "dateOfBirth",
  "gender",
  "email",
] as const satisfies readonly RowField[];

function emptyRow(): RowValues {
  return {
    admissionNumber: "",
    firstName: "",
    middleName: "",
    lastName: "",
    dateOfBirth: "",
    gender: "",
    email: "",
  };
}

function isBlankRow(row: RowValues | undefined): boolean {
  if (!row) return true;
  return COLUMNS.every((c) => (row[c] ?? "").trim() === "");
}

function emptyToUndefined(v: string): string | undefined {
  const t = v.trim();
  return t === "" ? undefined : t;
}

// Real school spreadsheets hold "M", "f", "Male" — not the enum. Anything
// unrecognised passes through untouched so the row shows a visible
// "Required" error rather than being silently coerced to the wrong gender.
function normalizeGender(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (v === "m" || v === "male") return "MALE";
  if (v === "f" || v === "female") return "FEMALE";
  if (v === "o" || v === "other") return "OTHER";
  return raw.trim();
}

// <input type="date"> only accepts YYYY-MM-DD. Nigerian spreadsheets are
// overwhelmingly dd/mm/yyyy, so that is the one alternative translated here;
// anything else is left alone to fail validation loudly rather than being
// guessed at.
function normalizeDate(raw: string): string {
  const v = raw.trim();
  if (v === "") return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(v);
  if (m) {
    const day = m[1]!.padStart(2, "0");
    const month = m[2]!.padStart(2, "0");
    return `${m[3]}-${month}-${day}`;
  }
  return v;
}

function normalizeCell(column: RowField, raw: string): string {
  if (column === "gender") return normalizeGender(raw);
  if (column === "dateOfBirth") return normalizeDate(raw);
  return raw.trim();
}

/**
 * Splits pasted clipboard text into a grid. Tab-delimited when the paste
 * contains tabs (which is how every spreadsheet copies); comma otherwise.
 */
function parseClipboardGrid(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
  const delimiter = text.includes("\t") ? "\t" : ",";
  return lines.map((line) => line.split(delimiter));
}

interface RowStatus {
  state: "idle" | "submitting" | "success" | "error";
  message?: string;
  studentId?: string;
}

const START_ROWS = 5;

export function BulkStudentForm() {
  const form = useForm<FormValues>({
    defaultValues: { rows: Array.from({ length: START_ROWS }, emptyRow) },
    mode: "onSubmit",
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "rows",
  });

  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const createdCount = fields.filter(
    (f) => rowStatus[f.id]?.state === "success",
  ).length;
  // "Done" means every row that still holds data has been created — trailing
  // blank rows (the auto-appended spares) must not hold the state open.
  const allDone =
    createdCount > 0 &&
    fields.every(
      (f, i) =>
        rowStatus[f.id]?.state === "success" ||
        isBlankRow(form.getValues(`rows.${i}`)),
    );

  const focusCell = useCallback((rowIndex: number, colIndex: number) => {
    // Deferred a frame: when Enter appends a row, the target input does not
    // exist until React has flushed the new field array.
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-cell="${rowIndex}:${colIndex}"]`)
        ?.focus();
    });
  }, []);

  // Typing anywhere in the last row means the user is still going, so keep
  // one spare row waiting below them.
  const ensureSpareRow = useCallback(
    (rowIndex: number) => {
      if (rowIndex === fields.length - 1) {
        append(emptyRow(), { shouldFocus: false });
      }
    },
    [append, fields.length],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, rowIndex: number, colIndex: number) => {
      if (e.key !== "Enter") return;
      // A grid of inputs inside a <form>: Enter would otherwise submit.
      e.preventDefault();
      if (rowIndex === fields.length - 1) {
        append(emptyRow(), { shouldFocus: false });
      }
      focusCell(rowIndex + 1, colIndex);
    },
    [append, fields.length, focusCell],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent, rowIndex: number, colIndex: number) => {
      const text = e.clipboardData.getData("text/plain");
      // An ordinary single-value paste keeps the browser's own behaviour.
      if (!text || (!text.includes("\t") && !text.includes("\n"))) return;
      e.preventDefault();

      const grid = parseClipboardGrid(text);
      const rowsNeeded = rowIndex + grid.length - fields.length;
      for (let i = 0; i < rowsNeeded; i++) {
        append(emptyRow(), { shouldFocus: false });
      }

      grid.forEach((cells, r) => {
        cells.forEach((value, c) => {
          const column = COLUMNS[colIndex + c];
          if (!column) return; // pasted wider than the grid — extra columns dropped
          form.setValue(
            `rows.${rowIndex + r}.${column}`,
            normalizeCell(column, value),
            { shouldDirty: true },
          );
        });
      });

      toast.success(
        `Pasted ${grid.length} row${grid.length === 1 ? "" : "s"} — check them, then create.`,
      );
    },
    [append, fields.length, form],
  );

  const onSubmit = form.handleSubmit(async (values) => {
    form.clearErrors();

    // Blank rows are not an error — they are the spares the auto-append
    // leaves behind. Only rows the user actually typed in get validated.
    const liveIndexes = values.rows
      .map((row, i) => ({ row, i }))
      .filter(({ row }) => !isBlankRow(row))
      .map(({ i }) => i);

    if (liveIndexes.length === 0) {
      setSummary("Fill in at least one row first.");
      return;
    }

    let invalid = 0;
    for (const i of liveIndexes) {
      const parsed = rowSchema.safeParse(values.rows[i]);
      if (parsed.success) continue;
      invalid++;
      for (const issue of parsed.error.issues) {
        const column = issue.path[0] as RowField | undefined;
        if (!column) continue;
        form.setError(`rows.${i}.${column}`, {
          type: "manual",
          message: issue.message,
        });
      }
    }
    if (invalid > 0) {
      setSummary(
        `${invalid} row${invalid === 1 ? " needs" : "s need"} fixing — see the highlighted cells.`,
      );
      return;
    }

    setSubmitting(true);
    setSummary(null);
    // Captured once, before this pass's setRowStatus calls — React state
    // updates inside the loop below are async, so reading `rowStatus` again
    // after the loop would race with (and likely miss) this render's own
    // updates. Track this pass's outcome in local variables instead.
    const alreadySucceededBeforeThisPass = liveIndexes.filter((i) => {
      const field = fields[i];
      return field ? rowStatus[field.id]?.state === "success" : false;
    }).length;
    let createdThisPass = 0;
    // Set when a row fails because the session is gone. Every remaining row
    // would fail the same way, so the loop stops instead of firing them.
    let terminalAuthFailure = false;

    for (const i of liveIndexes) {
      const field = fields[i];
      if (!field) continue;
      if (rowStatus[field.id]?.state === "success") continue; // already created — never resubmit

      setRowStatus((prev) => ({ ...prev, [field.id]: { state: "submitting" } }));

      const row = values.rows[i];
      if (!row) continue;
      // `nationality` is omitted deliberately — the column carries a DB
      // default of "Nigerian"; see the field-set note at the top of this file.
      const payload: CreateStudentInput = {
        admissionNumber: row.admissionNumber.trim(),
        firstName: row.firstName.trim(),
        middleName: emptyToUndefined(row.middleName),
        lastName: row.lastName.trim(),
        dateOfBirth: new Date(row.dateOfBirth),
        gender: row.gender as CreateStudentInput["gender"],
        email: emptyToUndefined(row.email),
      };

      try {
        const created = await createStudent(payload);
        setRowStatus((prev) => ({
          ...prev,
          [field.id]: { state: "success", studentId: created.id },
        }));
        createdThisPass++;
      } catch (error) {
        if (error instanceof ApiError && isTerminalAuthFailure(error)) {
          // The session ended mid-pass. Rows before this one are ALREADY
          // CREATED server-side; rows after it have not been attempted.
          //
          // Stop here. Continuing would fire one doomed request per remaining
          // row — reproduced 2026-08-28: a 401 on row 2 of 3 still sent row 3,
          // each one dispatching another unauthorized event at a server that
          // had already refused. Same shape as the class-subject matrix's
          // save loop, which breaks on first failure and reports how far it
          // got rather than pressing on.
          terminalAuthFailure = true;
          setRowStatus((prev) => ({
            ...prev,
            [field.id]: { state: "error", message: "Not saved — you were signed out." },
          }));
          break;
        }
        if (error instanceof ApiError) {
          if (error.code === "ADMISSION_NUMBER_TAKEN") {
            form.setError(`rows.${i}.admissionNumber`, {
              type: "manual",
              message: "Already in use.",
            });
            setRowStatus((prev) => ({
              ...prev,
              [field.id]: {
                state: "error",
                message: "Admission number already in use.",
              },
            }));
          } else {
            setRowStatus((prev) => ({
              ...prev,
              [field.id]: { state: "error", message: error.message },
            }));
          }
        } else {
          setRowStatus((prev) => ({
            ...prev,
            [field.id]: {
              state: "error",
              message: "Could not reach the server.",
            },
          }));
        }
      }
    }

    setSubmitting(false);
    const totalSuccess = alreadySucceededBeforeThisPass + createdThisPass;
    if (createdThisPass > 0) {
      toast.success(
        `Created ${createdThisPass} student${createdThisPass === 1 ? "" : "s"}.`,
      );
    }
    const failedCount = liveIndexes.length - totalSuccess;
    setSummary(
      // The signed-out case gets its own sentence, not the generic "fix the
      // highlighted rows" one. Nothing here needs fixing and re-submitting
      // will not help — the credential is gone. What the user needs is the
      // COUNT that actually landed, because the redirect is about to take
      // this grid away and those students are real.
      terminalAuthFailure
        ? partialSaveNotice(totalSuccess, liveIndexes.length)
        : failedCount > 0
          ? `Created ${totalSuccess} of ${liveIndexes.length}. Fix the highlighted rows and submit again to retry the rest.`
          : `All ${totalSuccess} student${totalSuccess === 1 ? "" : "s"} created.`,
    );
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {summary && (
        <div
          className={
            allDone
              ? "rounded-md border border-emerald-400/40 bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
              : "rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          }
        >
          {summary}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead className="min-w-36">Admission #</TableHead>
              <TableHead className="min-w-32">First name</TableHead>
              <TableHead className="min-w-28">Middle</TableHead>
              <TableHead className="min-w-32">Last name</TableHead>
              <TableHead className="min-w-36">DOB</TableHead>
              <TableHead className="min-w-28">Gender</TableHead>
              <TableHead className="min-w-44">
                Email{" "}
                <span className="font-normal normal-case text-muted-foreground">
                  (optional)
                </span>
              </TableHead>
              <TableHead className="min-w-32">Status</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((field, index) => {
              const status = rowStatus[field.id];
              const isLocked =
                status?.state === "success" || status?.state === "submitting";
              const rowErrors = form.formState.errors.rows?.[index];

              // Wires each cell into the grid behaviours: paste spreading,
              // Enter-moves-down, and auto-append on the last row.
              const cell = (column: RowField) => {
                const colIndex = COLUMNS.indexOf(column);
                return {
                  "data-cell": `${index}:${colIndex}`,
                  disabled: isLocked,
                  "aria-invalid": Boolean(rowErrors?.[column]),
                  onKeyDown: (e: React.KeyboardEvent) =>
                    handleKeyDown(e, index, colIndex),
                  onPaste: (e: React.ClipboardEvent) =>
                    handlePaste(e, index, colIndex),
                  ...form.register(`rows.${index}.${column}`, {
                    onChange: () => ensureSpareRow(index),
                  }),
                };
              };

              const cellError = (column: RowField) =>
                rowErrors?.[column] ? (
                  <p className="mt-0.5 text-xs text-destructive">
                    {rowErrors[column]?.message}
                  </p>
                ) : null;

              return (
                <TableRow key={field.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {index + 1}
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 min-w-32 text-xs"
                      placeholder="2025/JSS1/001"
                      {...cell("admissionNumber")}
                    />
                    {cellError("admissionNumber")}
                  </TableCell>
                  <TableCell>
                    <Input className="h-8 min-w-28 text-xs" {...cell("firstName")} />
                    {cellError("firstName")}
                  </TableCell>
                  <TableCell>
                    <Input className="h-8 min-w-24 text-xs" {...cell("middleName")} />
                    {cellError("middleName")}
                  </TableCell>
                  <TableCell>
                    <Input className="h-8 min-w-28 text-xs" {...cell("lastName")} />
                    {cellError("lastName")}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      className="h-8 min-w-32 text-xs"
                      {...cell("dateOfBirth")}
                    />
                    {cellError("dateOfBirth")}
                  </TableCell>
                  <TableCell>
                    <select
                      className="h-8 min-w-24 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      {...cell("gender")}
                    >
                      <option value="">Select…</option>
                      {GENDER_VALUES.map((g) => (
                        <option key={g} value={g}>
                          {g.charAt(0) + g.slice(1).toLowerCase()}
                        </option>
                      ))}
                    </select>
                    {cellError("gender")}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="email"
                      className="h-8 min-w-40 text-xs"
                      {...cell("email")}
                    />
                    {cellError("email")}
                  </TableCell>
                  <TableCell>
                    {status?.state === "submitting" && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                    {status?.state === "success" && (
                      <div className="flex flex-col gap-0.5">
                        <Badge variant="success">
                          <Check className="mr-1 h-3 w-3" />
                          Created
                        </Badge>
                        {status.studentId && (
                          <Link
                            href={`/students/${status.studentId}`}
                            className="text-xs text-primary underline-offset-2 hover:underline"
                          >
                            View
                          </Link>
                        )}
                      </div>
                    )}
                    {status?.state === "error" && (
                      <div className="flex items-start gap-1 text-xs text-destructive">
                        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>{status.message}</span>
                      </div>
                    )}
                    {(!status || status.state === "idle") && (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      disabled={submitting || fields.length <= 1}
                      onClick={() => remove(index)}
                      title="Remove row"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={submitting}
            onClick={() => append(emptyRow(), { shouldFocus: false })}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add row
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={submitting}
            onClick={() =>
              append(Array.from({ length: 10 }, emptyRow), { shouldFocus: false })
            }
          >
            +10 rows
          </Button>
        </div>

        <div className="flex gap-2">
          {allDone ? (
            <Button asChild>
              <Link href="/students">View roster</Link>
            </Button>
          ) : (
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? "Creating…" : "Create students"}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
