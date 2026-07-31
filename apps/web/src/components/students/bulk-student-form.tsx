"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Check, Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
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
import { createStudent } from "@/lib/students/students-api";

// /students/new/bulk — spreadsheet-like inline entry for adding several
// students at once. Deliberately NOT a shared abstraction with
// student-form.tsx: same field-validation rules are duplicated here rather
// than extracted, per the same "don't refactor the proven single-add path
// under time pressure" call made in this feature's plan-first. If the two
// forms drift, that's an acceptable cost for not destabilizing the
// highest-traffic student-creation flow same-day.
//
// Deliberately excludes photoUrl (handled later by the student during full
// registration, per product decision) and medicalNotes/notes (long free-text,
// impractical in a grid cell — same call CSV import already made).
// Deliberately excludes class arm + guardian info: neither the existing
// single-add form nor the CSV import bundle those into student creation —
// enrollment is a separate step via /enrollments/bulk, guardians via each
// student's own Guardians tab. Matching that existing precedent rather than
// inventing new bulk-capture logic under time pressure.
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
const optionalText = (max: number) => z.string().trim().max(max);

const rowSchema = z.object({
  admissionNumber: z
    .string()
    .trim()
    .min(1, "Required")
    .max(40, "Too long"),
  firstName: z.string().trim().min(1, "Required").max(60),
  middleName: optionalText(60),
  lastName: z.string().trim().min(1, "Required").max(60),
  dateOfBirth: z
    .string()
    .min(1, "Required")
    .refine((v) => !Number.isNaN(new Date(v).getTime()), "Invalid date"),
  gender: z.string().min(1, "Required"),
  phone: optionalText(30),
  email: z
    .string()
    .trim()
    .max(254)
    .refine(
      (v) => v === "" || z.string().email().safeParse(v).success,
      "Invalid email",
    ),
  address: optionalText(500),
  bloodGroup: optionalText(10),
  religion: optionalText(40),
  stateOfOrigin: optionalText(40),
  nationality: optionalText(40),
});

const bulkFormSchema = z.object({
  rows: z.array(rowSchema).min(1),
});

type FormValues = z.infer<typeof bulkFormSchema>;
type RowValues = FormValues["rows"][number];

function emptyRow(): RowValues {
  return {
    admissionNumber: "",
    firstName: "",
    middleName: "",
    lastName: "",
    dateOfBirth: "",
    gender: "",
    phone: "",
    email: "",
    address: "",
    bloodGroup: "",
    religion: "",
    stateOfOrigin: "",
    nationality: "Nigerian",
  };
}

function emptyToUndefined(v: string): string | undefined {
  const t = v.trim();
  return t === "" ? undefined : t;
}

interface RowStatus {
  state: "idle" | "submitting" | "success" | "error";
  message?: string;
  studentId?: string;
}

const START_ROWS = 3;

export function BulkStudentForm() {
  const form = useForm<FormValues>({
    resolver: zodResolver(bulkFormSchema),
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

  const successCount = fields.filter(
    (f) => rowStatus[f.id]?.state === "success",
  ).length;
  const allDone = fields.length > 0 && successCount === fields.length;

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    setSummary(null);
    // Captured once, before this pass's setRowStatus calls — React state
    // updates inside the loop below are async, so reading `rowStatus` again
    // after the loop would race with (and likely miss) this render's own
    // updates. Track this pass's outcome in local variables instead.
    const alreadySucceededBeforeThisPass = fields.filter(
      (f) => rowStatus[f.id]?.state === "success",
    ).length;
    let createdThisPass = 0;

    for (let i = 0; i < values.rows.length; i++) {
      const field = fields[i];
      if (!field) continue;
      if (rowStatus[field.id]?.state === "success") continue; // already created — never resubmit

      setRowStatus((prev) => ({ ...prev, [field.id]: { state: "submitting" } }));

      const row = values.rows[i];
      if (!row) continue;
      const payload: CreateStudentInput = {
        admissionNumber: row.admissionNumber.trim(),
        firstName: row.firstName.trim(),
        middleName: emptyToUndefined(row.middleName),
        lastName: row.lastName.trim(),
        dateOfBirth: new Date(row.dateOfBirth),
        gender: row.gender as CreateStudentInput["gender"],
        address: emptyToUndefined(row.address),
        phone: emptyToUndefined(row.phone),
        email: emptyToUndefined(row.email),
        bloodGroup: emptyToUndefined(row.bloodGroup),
        religion: emptyToUndefined(row.religion),
        stateOfOrigin: emptyToUndefined(row.stateOfOrigin),
        nationality: emptyToUndefined(row.nationality) ?? "Nigerian",
      };

      try {
        const created = await createStudent(payload);
        setRowStatus((prev) => ({
          ...prev,
          [field.id]: { state: "success", studentId: created.id },
        }));
        createdThisPass++;
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.code === "ADMISSION_NUMBER_TAKEN") {
            form.setError(`rows.${i}.admissionNumber`, {
              type: "manual",
              message: "Already in use.",
            });
            setRowStatus((prev) => ({
              ...prev,
              [field.id]: { state: "error", message: "Admission number already in use." },
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
            [field.id]: { state: "error", message: "Could not reach the server." },
          }));
        }
      }
    }

    setSubmitting(false);
    const totalSuccess = alreadySucceededBeforeThisPass + createdThisPass;
    if (createdThisPass > 0) {
      toast.success(`Created ${createdThisPass} student${createdThisPass === 1 ? "" : "s"}.`);
    }
    const failedCount = values.rows.length - totalSuccess;
    setSummary(
      failedCount > 0
        ? `Created ${totalSuccess} of ${values.rows.length}. Fix the highlighted rows and submit again to retry the rest.`
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
              <TableHead className="min-w-32">Phone</TableHead>
              <TableHead className="min-w-40">Email</TableHead>
              <TableHead className="min-w-40">Address</TableHead>
              <TableHead className="min-w-24">Blood grp</TableHead>
              <TableHead className="min-w-28">Religion</TableHead>
              <TableHead className="min-w-28">State</TableHead>
              <TableHead className="min-w-28">Nationality</TableHead>
              <TableHead className="min-w-32">Status</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((field, index) => {
              const status = rowStatus[field.id];
              const isLocked = status?.state === "success" || status?.state === "submitting";
              const rowErrors = form.formState.errors.rows?.[index];

              return (
                <TableRow key={field.id}>
                  <TableCell className="text-xs text-muted-foreground">{index + 1}</TableCell>
                  <TableCell>
                    <Input
                      className="h-8 min-w-32 text-xs"
                      disabled={isLocked}
                      placeholder="2025/JSS1/001"
                      {...form.register(`rows.${index}.admissionNumber`)}
                      aria-invalid={Boolean(rowErrors?.admissionNumber)}
                    />
                    {rowErrors?.admissionNumber && (
                      <p className="mt-0.5 text-xs text-destructive">
                        {rowErrors.admissionNumber.message}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 min-w-28 text-xs"
                      disabled={isLocked}
                      {...form.register(`rows.${index}.firstName`)}
                      aria-invalid={Boolean(rowErrors?.firstName)}
                    />
                    {rowErrors?.firstName && (
                      <p className="mt-0.5 text-xs text-destructive">
                        {rowErrors.firstName.message}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 min-w-24 text-xs"
                      disabled={isLocked}
                      {...form.register(`rows.${index}.middleName`)}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 min-w-28 text-xs"
                      disabled={isLocked}
                      {...form.register(`rows.${index}.lastName`)}
                      aria-invalid={Boolean(rowErrors?.lastName)}
                    />
                    {rowErrors?.lastName && (
                      <p className="mt-0.5 text-xs text-destructive">
                        {rowErrors.lastName.message}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      className="h-8 min-w-32 text-xs"
                      disabled={isLocked}
                      {...form.register(`rows.${index}.dateOfBirth`)}
                      aria-invalid={Boolean(rowErrors?.dateOfBirth)}
                    />
                    {rowErrors?.dateOfBirth && (
                      <p className="mt-0.5 text-xs text-destructive">
                        {rowErrors.dateOfBirth.message}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <select
                      className="h-8 min-w-24 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      disabled={isLocked}
                      {...form.register(`rows.${index}.gender`)}
                      aria-invalid={Boolean(rowErrors?.gender)}
                    >
                      <option value="">Select…</option>
                      {GENDER_VALUES.map((g) => (
                        <option key={g} value={g}>
                          {g.charAt(0) + g.slice(1).toLowerCase()}
                        </option>
                      ))}
                    </select>
                    {rowErrors?.gender && (
                      <p className="mt-0.5 text-xs text-destructive">{rowErrors.gender.message}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="tel"
                      className="h-8 min-w-28 text-xs"
                      disabled={isLocked}
                      {...form.register(`rows.${index}.phone`)}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="email"
                      className="h-8 min-w-36 text-xs"
                      disabled={isLocked}
                      {...form.register(`rows.${index}.email`)}
                      aria-invalid={Boolean(rowErrors?.email)}
                    />
                    {rowErrors?.email && (
                      <p className="mt-0.5 text-xs text-destructive">{rowErrors.email.message}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 min-w-36 text-xs"
                      disabled={isLocked}
                      {...form.register(`rows.${index}.address`)}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 min-w-20 text-xs"
                      disabled={isLocked}
                      placeholder="O+"
                      {...form.register(`rows.${index}.bloodGroup`)}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 min-w-24 text-xs"
                      disabled={isLocked}
                      {...form.register(`rows.${index}.religion`)}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 min-w-24 text-xs"
                      disabled={isLocked}
                      placeholder="Lagos"
                      {...form.register(`rows.${index}.stateOfOrigin`)}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 min-w-24 text-xs"
                      disabled={isLocked}
                      {...form.register(`rows.${index}.nationality`)}
                    />
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={submitting}
          onClick={() => append(emptyRow())}
        >
          <Plus className="mr-1 h-4 w-4" />
          Add row
        </Button>

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
