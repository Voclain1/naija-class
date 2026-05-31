"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import type {
  AcademicYearDto,
  ClassArmDto,
  CreateTeacherAssignmentInput,
  SubjectDto,
  TeacherAssignmentDto,
  TermDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { ApiError } from "@/lib/api-client";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import {
  createTeacherAssignment,
  deleteTeacherAssignment,
  listTeacherAssignments,
} from "@/lib/staff/staff-api";
import { listSubjects } from "@/lib/subjects/subjects-api";

// Slice 11 cp3 — the "Teaching assignments" section on /staff/[userId].
// Closes the slice-10 deferral ("assigned subjects depends on
// TeacherAssignment, slice 11"). Lists the teacher's TeacherAssignment rows
// (arm · subject · year · term-or-"Whole year"), with an inline add form and
// per-row delete.
//
// FORM-CLASS PROTECTION (slice-10 cp3 lesson, still load-bearing):
//   - Local `assignmentFormSchema` matches FormValues EXACTLY (four strings)
//     — no reuse of the strict API body schema, so NO `as never` cast on
//     zodResolver.
//   - Root error block AND per-field errors render. API field codes map to
//     the right field; TEACHER_ALREADY_ASSIGNED → root.
//   - termId "" means "whole year" (→ null on submit); never trips a
//     min(1) optional.

// Local schema === FormValues (all strings). termId "" = whole year.
const assignmentFormSchema = z.object({
  classArmId: z.string().min(1, "Select a class arm."),
  subjectId: z.string().min(1, "Select a subject."),
  academicYearId: z.string().min(1, "Select an academic year."),
  termId: z.string(),
});

type FormValues = z.infer<typeof assignmentFormSchema>;

interface Props {
  teacherId: string;
}

export function TeacherAssignmentsSection({ teacherId }: Props) {
  const [assignments, setAssignments] = useState<TeacherAssignmentDto[]>([]);
  const [arms, setArms] = useState<ClassArmDto[]>([]);
  const [subjects, setSubjects] = useState<SubjectDto[]>([]);
  const [years, setYears] = useState<AcademicYearDto[]>([]);
  const [terms, setTerms] = useState<TermDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const currentYearId = years.find((y) => y.isCurrent)?.id ?? "";

  const form = useForm<FormValues>({
    resolver: zodResolver(assignmentFormSchema),
    defaultValues: {
      classArmId: "",
      subjectId: "",
      academicYearId: "",
      termId: "",
    },
    mode: "onSubmit",
  });
  const selectedYearId = form.watch("academicYearId");
  const termsForYear = terms.filter((t) => t.academicYearId === selectedYearId);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // includeInactive so an assignment that points at a deactivated arm /
      // subject still resolves to a name in the list.
      const [list, armRows, subjectRows, yearRows] = await Promise.all([
        listTeacherAssignments({ teacherId }),
        listClassArms({ includeInactive: true }),
        listSubjects({ includeInactive: true }),
        listAcademicYears(),
      ]);
      setAssignments(list.data);
      setArms(armRows);
      setSubjects(subjectRows);
      setYears(yearRows);
      // Terms are nested under years; fetch each year's terms (years are few
      // at pilot scale — 1–3). Flatten into one list for client-side filter.
      const termLists = await Promise.all(
        yearRows.map((y) => listTerms(y.id)),
      );
      setTerms(termLists.flat());
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Could not load teaching assignments.",
      );
    } finally {
      setLoading(false);
    }
  }, [teacherId]);

  useEffect(() => {
    void load();
  }, [load]);

  const armName = (id: string) => arms.find((a) => a.id === id)?.name ?? "Unknown arm";
  const subjectName = (id: string) =>
    subjects.find((s) => s.id === id)?.name ?? "Unknown subject";
  const yearLabel = (id: string) => years.find((y) => y.id === id)?.label ?? "—";
  const termName = (id: string | null) =>
    id === null ? "Whole year" : (terms.find((t) => t.id === id)?.name ?? "—");

  function openForm() {
    form.reset({
      classArmId: "",
      subjectId: "",
      academicYearId: currentYearId,
      termId: "",
    });
    setShowForm(true);
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const payload: CreateTeacherAssignmentInput = {
        teacherId,
        classArmId: values.classArmId,
        subjectId: values.subjectId,
        academicYearId: values.academicYearId,
        termId: values.termId === "" ? null : values.termId,
      };
      await createTeacherAssignment(payload);
      setShowForm(false);
      await load();
    } catch (e) {
      if (e instanceof ApiError) {
        switch (e.code) {
          case "TEACHER_ALREADY_ASSIGNED":
            form.setError("root", {
              type: "manual",
              message:
                "This teacher is already assigned to that subject in that arm for the selected period.",
            });
            break;
          case "TERM_YEAR_MISMATCH":
            form.setError("termId", {
              type: "manual",
              message: "That term doesn't belong to the selected academic year.",
            });
            break;
          case "INACTIVE_CLASS_ARM":
            form.setError("classArmId", {
              type: "manual",
              message: "That class arm is inactive.",
            });
            break;
          case "INACTIVE_SUBJECT":
            form.setError("subjectId", {
              type: "manual",
              message: "That subject is inactive.",
            });
            break;
          default:
            form.setError("root", { type: "manual", message: e.message });
        }
      } else {
        form.setError("root", {
          type: "manual",
          message: "Could not reach the server. Try again.",
        });
      }
    }
  });

  async function onDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteTeacherAssignment(id);
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not remove the assignment.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  const selectClass =
    "h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Teaching assignments
        </h2>
        {!showForm && !loading && (
          <Button size="sm" variant="outline" onClick={openForm}>
            <Plus className="h-4 w-4" />
            Add assignment
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <>
          {assignments.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
              No subject assignments yet. Use{" "}
              <span className="font-medium text-foreground">Add assignment</span>{" "}
              to record which subjects this teacher teaches, in which arm.
            </div>
          ) : (
            <ul className="flex flex-col divide-y rounded-md border">
              {assignments.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {armName(a.classArmId)} · {subjectName(a.subjectId)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {yearLabel(a.academicYearId)} · {termName(a.termId)}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-destructive hover:text-destructive"
                    onClick={() => void onDelete(a.id)}
                    disabled={deletingId === a.id}
                    aria-label={`Remove ${subjectName(a.subjectId)} in ${armName(a.classArmId)}`}
                  >
                    {deletingId === a.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {showForm && (
            <form
              onSubmit={onSubmit}
              className="flex flex-col gap-4 rounded-md border bg-card p-4"
              noValidate
            >
              {form.formState.errors.root && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                  {form.formState.errors.root.message}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="ta-arm">Class arm</Label>
                  <select
                    id="ta-arm"
                    className={selectClass}
                    {...form.register("classArmId")}
                    aria-invalid={Boolean(form.formState.errors.classArmId)}
                  >
                    <option value="">Select a class arm</option>
                    {arms
                      .filter((a) => a.isActive)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                  {form.formState.errors.classArmId && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.classArmId.message}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <Label htmlFor="ta-subject">Subject</Label>
                  <select
                    id="ta-subject"
                    className={selectClass}
                    {...form.register("subjectId")}
                    aria-invalid={Boolean(form.formState.errors.subjectId)}
                  >
                    <option value="">Select a subject</option>
                    {subjects
                      .filter((s) => s.isActive)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                  {form.formState.errors.subjectId && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.subjectId.message}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <Label htmlFor="ta-year">Academic year</Label>
                  <select
                    id="ta-year"
                    className={selectClass}
                    {...form.register("academicYearId")}
                    aria-invalid={Boolean(form.formState.errors.academicYearId)}
                  >
                    <option value="">Select a year</option>
                    {years.map((y) => (
                      <option key={y.id} value={y.id}>
                        {y.label}
                        {y.isCurrent ? " (current)" : ""}
                      </option>
                    ))}
                  </select>
                  {form.formState.errors.academicYearId && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.academicYearId.message}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <Label htmlFor="ta-term">Term</Label>
                  <select
                    id="ta-term"
                    className={selectClass}
                    {...form.register("termId")}
                    aria-invalid={Boolean(form.formState.errors.termId)}
                    disabled={!selectedYearId}
                  >
                    <option value="">Whole year</option>
                    {termsForYear.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Leave as “Whole year” unless this is a term-specific cover.
                  </p>
                  {form.formState.errors.termId && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.termId.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowForm(false)}
                  disabled={form.formState.isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {form.formState.isSubmitting ? "Saving…" : "Add assignment"}
                </Button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
