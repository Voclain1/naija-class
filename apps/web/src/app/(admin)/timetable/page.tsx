"use client";

import { CalendarClock, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  ISO_WEEKDAY_LABELS,
  describeTimetableClash,
  formatMinuteOfDay,
  type AssignmentWarningDto,
  type CopyProblemsDto,
  type TimetableClashDto,
  type SubjectDto,
  type TimetableOptionsDto,
  type TimetableViewDto,
} from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { CopyProblemsList, problemsOf } from "@/components/timetable/copy-problems";
import { CopyTimetableDialog } from "@/components/timetable/copy-timetable-dialog";
import { LessonEditorModal, type LessonTarget } from "@/components/timetable/lesson-editor-modal";
import { PublicationPanel } from "@/components/timetable/publication-panel";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { listSubjects } from "@/lib/subjects/subjects-api";
import {
  clashesOf,
  createTimetable,
  deleteTimetable,
  forkTimetable,
  getTimetableOptions,
  getTimetableView,
  getYearClashes,
} from "@/lib/timetable/timetable-api";
import { buildGrid } from "@/lib/timetable/timetable-grid";

// Duplicated per-file rather than a shared hook — same pattern as the settings
// screens. See docs/deferred.md ("Shared usePermissions hook").
function hasPermission(permissions: string[], perm: string): boolean {
  return permissions.includes("*") || permissions.includes(perm);
}

// /timetable — Phase 8 / CP3 timetable builder (docs/modules/phase-8.md §17 D36).
//
// One class, one term at a time. The grid shows the timetable IN FORCE for that
// term (D13): the class's "This term only" timetable if it has one, otherwise its
// "Whole year" timetable. "This term only" starts EMPTY or FROM the whole-year
// timetable (a fork, CP4 D41); switching back deletes it, which the API refuses if
// the whole-year lessons would then add a clash with another class.
//
// CP4 adds: what families see (publish / unpublished changes, D45), a standing
// banner of every clash in force in the year (D43), and copy to another term or
// year (D42).

const SELECT = "h-10 rounded-md border border-input bg-background px-3 text-sm";

export default function TimetablePage() {
  const { permissions } = useAuth();
  const canRead = hasPermission(permissions, "timetable.read");
  const canManage = hasPermission(permissions, "timetable.manage");

  const [options, setOptions] = useState<TimetableOptionsDto | null>(null);
  const [subjects, setSubjects] = useState<SubjectDto[]>([]);
  const [yearId, setYearId] = useState("");
  const [termId, setTermId] = useState("");
  const [classArmId, setClassArmId] = useState("");
  const [view, setView] = useState<TimetableViewDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<AssignmentWarningDto[]>([]);
  const [target, setTarget] = useState<LessonTarget | null>(null);
  const [yearClashes, setYearClashes] = useState<TimetableClashDto[]>([]);
  const [copyOpen, setCopyOpen] = useState(false);
  const [problemsTitle, setProblemsTitle] = useState<string | null>(null);
  const [problems, setProblems] = useState<CopyProblemsDto | null>(null);

  useEffect(() => {
    if (!canRead) return;
    void (async () => {
      try {
        const [o, s] = await Promise.all([getTimetableOptions(), listSubjects().catch(() => [] as SubjectDto[])]);
        setOptions(o);
        setSubjects(s.filter((x) => x.isActive));
        const year = o.academicYears.find((y) => y.isCurrent) ?? o.academicYears[0];
        if (year) {
          setYearId(year.id);
          setTermId((year.terms.find((t) => t.isCurrent) ?? year.terms[0])?.id ?? "");
        }
        setClassArmId(o.classArms[0]?.id ?? "");
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not load the timetable.");
      } finally {
        setLoading(false);
      }
    })();
  }, [canRead]);

  const year = options?.academicYears.find((y) => y.id === yearId);
  const term = year?.terms.find((t) => t.id === termId);
  const className = options?.classArms.find((a) => a.id === classArmId)?.name ?? "";

  const loadView = useCallback(async () => {
    if (!classArmId || !termId) {
      setView(null);
      return;
    }
    try {
      const [v, clashes] = await Promise.all([getTimetableView(classArmId, termId), getYearClashes(yearId)]);
      setView(v);
      setYearClashes(clashes);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the timetable.");
    }
  }, [classArmId, termId, yearId]);

  useEffect(() => {
    setWarnings([]);
    void loadView();
  }, [loadView]);

  const lessonSlots = view?.slots.filter((s) => s.kind === "LESSON") ?? [];
  const grid = useMemo(() => (view ? buildGrid(view.slots, view.schoolWeekDays, view.lessons) : []), [view]);

  async function create(forTerm: boolean) {
    if (!view) return;
    if (forTerm && view.yearWide) {
      const ok = window.confirm(
        `Give ${className} an EMPTY timetable for ${term?.name}? It replaces the whole-year timetable for this term only.`,
      );
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    setProblems(null);
    try {
      await createTimetable({ classArmId, academicYearId: yearId, termId: forTerm ? termId : null });
      await loadView();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create the timetable.");
    } finally {
      setBusy(false);
    }
  }

  // D41 — a term timetable that starts as a copy of the whole-year one.
  async function fork() {
    if (!view?.yearWide) return;
    setBusy(true);
    setError(null);
    setProblems(null);
    try {
      const r = await forkTimetable(view.yearWide.id, termId, false);
      toast.success(`${className} now has its own ${term?.name} timetable, copied from the whole year (${r.lessonsCopied} lessons). Not published yet.`);
      await loadView();
    } catch (e) {
      const p = problemsOf(e);
      if (p) {
        setProblemsTitle(`${className}'s ${term?.name} timetable was not created`);
        setProblems(p);
      } else {
        setError(e instanceof ApiError ? e.message : "Could not create the term timetable.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(which: "term" | "year") {
    const header = which === "term" ? view?.termOnly : view?.yearWide;
    if (!header) return;
    const message =
      which === "term"
        ? `Delete ${className}'s ${term?.name} timetable?${view?.yearWide ? " The whole-year timetable will apply to this term again." : ""}`
        : `Delete ${className}'s whole-year timetable and all its lessons?`;
    if (!window.confirm(message)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTimetable(header.id);
      await loadView();
    } catch (e) {
      const c = clashesOf(e);
      const first = c?.[0];
      setError(
        first
          ? `Can't switch back: ${first.teacherName} would be teaching ${first.classArms.map((a) => a.name).join(" and ")} at the same time on ${ISO_WEEKDAY_LABELS[first.dayOfWeek]}, ${first.slotLabel} (${first.termName}). Nothing was deleted.`
          : e instanceof ApiError
            ? e.message
            : "Could not delete the timetable.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!canRead) {
    return (
      <div className="flex w-full max-w-5xl flex-col gap-4">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Timetable</h1>
        <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          You don&apos;t have access to the timetable.
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Timetable</h1>
        <p className="text-sm text-muted-foreground">
          Build each class&apos;s week. Periods come from the{" "}
          <Link href="/settings/bell-schedule" className="text-primary underline-offset-4 hover:underline">
            bell schedule
          </Link>
          .
        </p>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
        </div>
      ) : !options || options.academicYears.length === 0 || options.classArms.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          Set up your academic years, terms and classes in{" "}
          <Link href="/settings/academic" className="text-primary underline-offset-4 hover:underline">
            Academics
          </Link>{" "}
          first.
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-3 rounded-md border bg-card p-4 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="font-medium">Academic year</span>
              <select
                aria-label="Academic year"
                className={SELECT}
                value={yearId}
                onChange={(e) => {
                  const y = options.academicYears.find((x) => x.id === e.target.value);
                  setYearId(e.target.value);
                  setTermId((y?.terms.find((t) => t.isCurrent) ?? y?.terms[0])?.id ?? "");
                }}
              >
                {options.academicYears.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.label}
                    {y.isCurrent ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="font-medium">Term</span>
              <select aria-label="Term" className={SELECT} value={termId} onChange={(e) => setTermId(e.target.value)} disabled={!year?.terms.length}>
                {!year?.terms.length && <option value="">No terms yet</option>}
                {year?.terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.isCurrent ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="font-medium">Class</span>
              <select aria-label="Class" className={SELECT} value={classArmId} onChange={(e) => setClassArmId(e.target.value)}>
                {options.classArms.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </section>

          {!termId ? (
            <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
              This academic year has no terms yet. Add them in Academics before building a timetable.
            </div>
          ) : view && lessonSlots.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
              No lesson periods yet.{" "}
              <Link href="/settings/bell-schedule" className="text-primary underline-offset-4 hover:underline">
                Set up the bell schedule
              </Link>{" "}
              first.
            </div>
          ) : view ? (
            <>
              <section aria-label="Which timetable applies" className="flex flex-col gap-3 rounded-md border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{className} in {term?.name}:</span>
                  <div role="group" className="inline-flex overflow-hidden rounded-md border">
                    <span
                      className={`px-3 py-1.5 text-sm ${view.inForce && view.inForce.termId === null ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                      aria-current={view.inForce?.termId === null ? "true" : undefined}
                    >
                      Whole year
                    </span>
                    <span
                      className={`border-l px-3 py-1.5 text-sm ${view.termOnly ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                      aria-current={view.termOnly ? "true" : undefined}
                    >
                      This term only
                    </span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {view.termOnly
                      ? `A separate ${term?.name} timetable applies.`
                      : view.yearWide
                        ? "The whole-year timetable applies."
                        : "No timetable yet."}
                  </span>
                </div>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    {!view.yearWide && !view.termOnly && (
                      <>
                        <Button type="button" onClick={() => void create(false)} disabled={busy}>
                          Create whole-year timetable
                        </Button>
                        <Button type="button" variant="outline" onClick={() => void create(true)} disabled={busy}>
                          Create for {term?.name} only
                        </Button>
                      </>
                    )}
                    {view.yearWide && !view.termOnly && (
                      <>
                        <Button type="button" variant="outline" onClick={() => void fork()} disabled={busy}>
                          Separate {term?.name} timetable, starting from the whole year
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => void create(true)} disabled={busy}>
                          …starting empty
                        </Button>
                      </>
                    )}
                    {view.inForce && view.lessons.length > 0 && (
                      <Button type="button" variant="outline" onClick={() => setCopyOpen(true)} disabled={busy}>
                        Copy to another term or year…
                      </Button>
                    )}
                    {view.termOnly && (
                      <Button type="button" variant="outline" onClick={() => void remove("term")} disabled={busy}>
                        Delete the {term?.name} timetable
                      </Button>
                    )}
                    {view.yearWide && !view.termOnly && (
                      <Button type="button" variant="ghost" onClick={() => void remove("year")} disabled={busy}>
                        Delete whole-year timetable
                      </Button>
                    )}
                  </div>
                )}
              </section>

              {problems && (
                <InlineAlert title={problemsTitle ?? "Not done"} tone="warning">
                  <CopyProblemsList problems={problems} />
                </InlineAlert>
              )}

              {yearClashes.length > 0 && (
                <InlineAlert
                  tone="warning"
                  title={`${yearClashes.length} timetable clash${yearClashes.length === 1 ? "" : "es"} in force in ${year?.label}`}
                >
                  <p>A teacher is timetabled in two classes at once. This can happen when a term is added or a class is re-activated.</p>
                  <ul className="mt-1 list-disc pl-4">
                    {yearClashes.map((c) => (
                      <li key={`${c.teacherId}-${c.dayOfWeek}-${c.bellSlotId}-${c.termId}`}>{describeTimetableClash(c)}</li>
                    ))}
                  </ul>
                  <p className="mt-1">
                    Fix it by giving one of the classes its own timetable for that term, or by moving one of the lessons. Edits that don&apos;t add a
                    clash still save.
                  </p>
                </InlineAlert>
              )}

              {view.inForce && (
                <PublicationPanel view={view} className={className} termName={term?.name ?? ""} canManage={canManage} onChanged={loadView} />
              )}

              {warnings.length > 0 && (
                <InlineAlert tone="warning" title="Saved — but check these assignments">
                  <ul className="list-disc pl-4">
                    {warnings.map((w) => (
                      <li key={w.teacherId}>
                        {w.teacherName} is not assigned to this subject in {className} for {w.uncoveredTermNames.join(" and ")}.
                      </li>
                    ))}
                  </ul>
                </InlineAlert>
              )}

              {view.inForce && (
                <div className="overflow-x-auto rounded-md border bg-card">
                  <table className="w-full border-collapse text-sm" aria-label={`${className} timetable`}>
                    <thead>
                      <tr>
                        <th className="w-28 border-b p-2 text-left font-medium text-muted-foreground">Period</th>
                        {view.schoolWeekDays.map((d) => (
                          <th key={d} className="border-b border-l p-2 text-left font-medium">
                            {ISO_WEEKDAY_LABELS[d]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {view.slots.map((slot, si) => (
                        <tr key={slot.id}>
                          <th scope="row" className="border-b p-2 text-left align-top font-normal">
                            <div className="font-medium">{slot.label}</div>
                            <div className="text-xs text-muted-foreground">
                              {formatMinuteOfDay(slot.startMinute)}–{formatMinuteOfDay(slot.endMinute)}
                            </div>
                          </th>
                          {slot.kind !== "LESSON" ? (
                            <td colSpan={view.schoolWeekDays.length} className="border-b border-l bg-muted/40 p-2 text-center text-xs uppercase tracking-wide text-muted-foreground">
                              {slot.label}
                            </td>
                          ) : (
                            view.schoolWeekDays.map((d, di) => {
                              const cell = grid[si]![di]!;
                              if (cell.type === "covered") return null;
                              const dayLabel = ISO_WEEKDAY_LABELS[d];
                              if (cell.type === "lesson") {
                                const l = cell.lesson;
                                return (
                                  <td key={d} rowSpan={cell.rowSpan} className="border-b border-l p-1 align-top">
                                    <button
                                      type="button"
                                      disabled={!canManage}
                                      onClick={() => setTarget({ dayOfWeek: d, bellSlotId: slot.id, lesson: l, span: cell.rowSpan })}
                                      aria-label={`${dayLabel} ${slot.label}: ${l.subjectName}`}
                                      className="flex h-full min-h-[3rem] w-full flex-col items-start rounded bg-primary/10 p-2 text-left hover:bg-primary/15 disabled:cursor-default"
                                    >
                                      <span className="font-medium">{l.subjectName}</span>
                                      <span className="text-xs text-muted-foreground">
                                        {l.teachers.length ? l.teachers.map((t) => t.name).join(", ") : "No teacher"}
                                      </span>
                                    </button>
                                  </td>
                                );
                              }
                              return (
                                <td key={d} className="border-b border-l p-1">
                                  {canManage && (
                                    <button
                                      type="button"
                                      onClick={() => setTarget({ dayOfWeek: d, bellSlotId: slot.id, lesson: null, span: 1 })}
                                      aria-label={`${dayLabel} ${slot.label}: add lesson`}
                                      className="min-h-[3rem] w-full rounded text-xs text-muted-foreground hover:bg-muted"
                                    >
                                      +
                                    </button>
                                  )}
                                </td>
                              );
                            })
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {!view.inForce && (
                <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
                  <CalendarClock className="h-4 w-4" aria-hidden="true" /> {className} has no timetable for {term?.name} yet.
                </div>
              )}

              {options && (
                <CopyTimetableDialog
                  open={copyOpen}
                  source={view.inForce}
                  className={className}
                  options={options}
                  onClose={() => setCopyOpen(false)}
                  onCopied={(dest) => {
                    setCopyOpen(false);
                    const y = options.academicYears.find((x) => x.id === dest.academicYearId);
                    setYearId(dest.academicYearId);
                    setTermId(dest.termId ?? (y?.terms.find((t) => t.isCurrent) ?? y?.terms[0])?.id ?? "");
                  }}
                />
              )}

              {view.inForce && (
                <LessonEditorModal
                  target={target}
                  view={view}
                  className={className}
                  subjects={subjects}
                  onClose={() => setTarget(null)}
                  onSaved={async (w) => {
                    setTarget(null);
                    setWarnings(w);
                    toast.success("Timetable saved.");
                    await loadView();
                  }}
                />
              )}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
