"use client";

import {
  ArrowRight,
  Edit2,
  Loader2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type {
  AcademicYearDto,
  ClassArmDto,
  ClassLevelDto,
  EnrollmentDto,
  EnrollmentStatusDto,
  TermDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  listAcademicYears,
  listTerms,
} from "@/lib/academic-years/academic-years-api";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import { listClassLevels } from "@/lib/class-levels/class-levels-api";
import {
  listEnrollments,
  updateEnrollment,
} from "@/lib/enrollments/enrollments-api";
import { listStudents } from "@/lib/students/students-api";

// /enrollments — Phase 1 / Slice 9 cp2.
//
// Current-term roster grouped by class arm. The page reads three axes:
//   - selected academic year (defaults to current)
//   - selected term within that year (defaults to current)
//   - all active class arms (per-arm card)
//
// Per arm card:
//   - if the target term has enrollments → show the enrolled-students table
//     with inline status edit (single PATCH /enrollments/:id)
//   - if target empty AND a previous term in the same year has enrollments
//     for this arm → "Carry over N students from <prev term>" CTA linking to
//     /enrollments/bulk?armId=...&termId=...
//   - if both empty → empty-state copy
//
// Single batched query reads ALL enrollments for the selected term in one
// hit; we group client-side by classArmId. Avoids N+1 across arms.

export default function EnrollmentsPage() {
  const [years, setYears] = useState<AcademicYearDto[]>([]);
  const [terms, setTerms] = useState<TermDto[]>([]);
  const [levels, setLevels] = useState<ClassLevelDto[]>([]);
  const [arms, setArms] = useState<ClassArmDto[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string | null>(null);
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null);
  const [loadingShell, setLoadingShell] = useState(true);
  const [loadingTerms, setLoadingTerms] = useState(false);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Roster state — keyed by classArmId for fast lookup.
  const [enrollmentsByArm, setEnrollmentsByArm] = useState<
    Map<string, EnrollmentRowVm[]>
  >(new Map());
  // Carry-over hint — for each arm, the most recent earlier term in the
  // same year that has any ENROLLED rows for that arm. null = nothing to
  // carry over from.
  const [carryOverHint, setCarryOverHint] = useState<
    Map<string, { termId: string; termLabel: string; count: number }>
  >(new Map());

  // ---------- Initial shell load ----------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [yearList, levelList, armList] = await Promise.all([
          listAcademicYears(),
          listClassLevels(),
          listClassArms(),
        ]);
        if (cancelled) return;
        setYears(yearList);
        setLevels(levelList);
        setArms(armList.filter((a) => a.isActive));
        const currentYear = yearList.find((y) => y.isCurrent);
        if (currentYear) {
          setSelectedYearId(currentYear.id);
        } else if (yearList[0]) {
          setSelectedYearId(yearList[0].id);
        }
        setLoadingShell(false);
      } catch (e) {
        if (cancelled) return;
        setError(
          e instanceof ApiError
            ? e.message
            : "Could not load academic structure.",
        );
        setLoadingShell(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------- Terms load (per year) ----------
  useEffect(() => {
    if (!selectedYearId) return;
    let cancelled = false;
    setLoadingTerms(true);
    void (async () => {
      try {
        const list = await listTerms(selectedYearId);
        if (cancelled) return;
        // Order by sequence ASC for display + carry-over computation.
        const sorted = [...list].sort((a, b) => a.sequence - b.sequence);
        setTerms(sorted);
        const currentTerm = sorted.find((t) => t.isCurrent);
        if (currentTerm) {
          setSelectedTermId(currentTerm.id);
        } else if (sorted[0]) {
          setSelectedTermId(sorted[0].id);
        } else {
          setSelectedTermId(null);
        }
      } catch (e) {
        if (cancelled) return;
        toast.error(
          e instanceof ApiError ? e.message : "Could not load terms.",
        );
      } finally {
        if (!cancelled) setLoadingTerms(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedYearId]);

  // ---------- Roster + carry-over hint load ----------
  //
  // Two queries (current + previous term) so the per-arm card knows
  // whether to render the carry-over CTA. Both are bounded at 500 rows
  // (the listEnrollments default); a school with >500 enrollments per
  // term is well beyond the Phase 1 acceptance bar.
  const reload = useCallback(async () => {
    if (!selectedTermId) {
      setEnrollmentsByArm(new Map());
      setCarryOverHint(new Map());
      return;
    }
    setLoadingRoster(true);
    try {
      const target = await listEnrollments({ termId: selectedTermId });
      const byArm = new Map<string, EnrollmentRowVm[]>();
      // Need student names — fetch the involved students in one batch.
      const studentIds = Array.from(
        new Set(target.data.map((e) => e.studentId)),
      );
      const studentLookup = await batchStudentLookup(studentIds);
      for (const enr of target.data) {
        const s = studentLookup.get(enr.studentId);
        const row: EnrollmentRowVm = {
          enrollment: enr,
          studentLabel: s
            ? `${s.lastName}, ${s.firstName}`
            : `student ${enr.studentId.slice(0, 8)}`,
          admissionNumber: s?.admissionNumber ?? "—",
        };
        const bucket = byArm.get(enr.classArmId) ?? [];
        bucket.push(row);
        byArm.set(enr.classArmId, bucket);
      }
      setEnrollmentsByArm(byArm);

      // Carry-over hint — pick the previous term in the SAME year with
      // any enrollments for each arm. If multiple previous terms exist,
      // use the one immediately before (highest sequence < current).
      const currentTerm = terms.find((t) => t.id === selectedTermId);
      const hints = new Map<
        string,
        { termId: string; termLabel: string; count: number }
      >();
      if (currentTerm) {
        const earlier = terms
          .filter((t) => t.sequence < currentTerm.sequence)
          .sort((a, b) => b.sequence - a.sequence); // newest-earlier first
        // ONE bulk fetch across all earlier terms in this year — server
        // returns up to 500 rows; we count per (arm, term) and pick the
        // newest-earlier term that has any enrollments for each arm.
        if (earlier.length > 0) {
          const earlierEnr = await listEnrollments({
            academicYearId: currentTerm.academicYearId,
            limit: 500,
          });
          // group by armId → termId → count
          const grouped = new Map<string, Map<string, number>>();
          for (const e of earlierEnr.data) {
            if (e.termId === selectedTermId) continue;
            if (e.status === "WITHDRAWN" || e.status === "GRADUATED") continue;
            const byTerm =
              grouped.get(e.classArmId) ?? new Map<string, number>();
            byTerm.set(e.termId, (byTerm.get(e.termId) ?? 0) + 1);
            grouped.set(e.classArmId, byTerm);
          }
          for (const arm of arms) {
            const byTerm = grouped.get(arm.id);
            if (!byTerm) continue;
            // pick the newest earlier term that has > 0 rows
            for (const t of earlier) {
              const count = byTerm.get(t.id) ?? 0;
              if (count > 0) {
                hints.set(arm.id, {
                  termId: t.id,
                  termLabel: t.name,
                  count,
                });
                break;
              }
            }
          }
        }
      }
      setCarryOverHint(hints);
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Could not load enrollments.",
      );
    } finally {
      setLoadingRoster(false);
    }
  }, [selectedTermId, terms, arms]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const armsByLevel = useMemo(() => {
    const map = new Map<string, ClassArmDto[]>();
    for (const a of arms) {
      const bucket = map.get(a.classLevelId) ?? [];
      bucket.push(a);
      map.set(a.classLevelId, bucket);
    }
    return map;
  }, [arms]);

  const sortedLevels = useMemo(
    () => [...levels].sort((a, b) => a.orderIndex - b.orderIndex),
    [levels],
  );

  const onInlineStatusChange = useCallback(
    async (enrollmentId: string, next: EnrollmentStatusDto) => {
      try {
        await updateEnrollment(enrollmentId, { status: next });
        toast.success("Enrollment updated.");
        await reload();
      } catch (e) {
        toast.error(
          e instanceof ApiError
            ? e.message
            : "Could not update enrollment.",
        );
      }
    },
    [reload],
  );

  if (loadingShell) {
    return (
      <div className="mx-auto flex w-full max-w-5xl items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      </div>
    );
  }

  if (years.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
          You haven&apos;t created an academic year yet. Add one in{" "}
          <Link
            href="/settings/academic/years"
            className="underline-offset-2 hover:underline"
          >
            Settings → Academic
          </Link>{" "}
          before enrolling students.
        </div>
      </div>
    );
  }

  const noArms = arms.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Enrollments</h1>
        <p className="text-sm text-muted-foreground">
          Per-term roster by class arm. Pick a year + term to view; use{" "}
          <strong>Carry over</strong> at the start of each term to bring
          forward the previous term&apos;s arm.
        </p>
      </header>

      <section className="flex flex-col gap-3 rounded-md border bg-card p-4 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">Academic year</span>
          <select
            value={selectedYearId ?? ""}
            onChange={(e) => setSelectedYearId(e.target.value || null)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.label}
                {y.isCurrent ? " (current)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">Term</span>
          <select
            value={selectedTermId ?? ""}
            onChange={(e) => setSelectedTermId(e.target.value || null)}
            disabled={loadingTerms || terms.length === 0}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {terms.length === 0 && <option value="">No terms yet</option>}
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.isCurrent ? " (current)" : ""}
              </option>
            ))}
          </select>
        </label>
      </section>

      {noArms ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
          You haven&apos;t created any class arms yet. Add some in{" "}
          <Link
            href="/settings/academic/class-arms"
            className="underline-offset-2 hover:underline"
          >
            Settings → Academic → Class arms
          </Link>{" "}
          before enrolling students.
        </div>
      ) : loadingRoster ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading roster…
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {sortedLevels.map((level) => {
            const levelArms = armsByLevel.get(level.id) ?? [];
            if (levelArms.length === 0) return null;
            return (
              <section key={level.id} className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {level.name}
                </h2>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {levelArms.map((arm) => (
                    <ArmCard
                      key={arm.id}
                      arm={arm}
                      levelName={level.name}
                      enrollments={enrollmentsByArm.get(arm.id) ?? []}
                      carryOverHint={carryOverHint.get(arm.id) ?? null}
                      targetTermId={selectedTermId}
                      onInlineStatusChange={onInlineStatusChange}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// =========================================================================
// Per-arm card.
// =========================================================================

interface EnrollmentRowVm {
  enrollment: EnrollmentDto;
  studentLabel: string;
  admissionNumber: string;
}

function ArmCard({
  arm,
  levelName,
  enrollments,
  carryOverHint,
  targetTermId,
  onInlineStatusChange,
}: {
  arm: ClassArmDto;
  levelName: string;
  enrollments: EnrollmentRowVm[];
  carryOverHint: { termId: string; termLabel: string; count: number } | null;
  targetTermId: string | null;
  onInlineStatusChange: (
    enrollmentId: string,
    next: EnrollmentStatusDto,
  ) => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
      <header className="flex items-baseline justify-between">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-base font-semibold">{arm.name}</h3>
          <p className="text-xs text-muted-foreground">{levelName}</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
          <Users className="h-3 w-3" />
          {enrollments.length}
        </span>
      </header>

      {enrollments.length === 0 ? (
        carryOverHint && targetTermId ? (
          <div className="flex flex-col gap-2 rounded-md border border-dashed bg-muted/20 p-3">
            <p className="text-sm">
              No enrollments yet for this arm this term.
            </p>
            <Button asChild size="sm" variant="outline" className="w-fit">
              <Link
                href={`/enrollments/bulk?armId=${arm.id}&termId=${targetTermId}`}
              >
                Carry over {carryOverHint.count} students from{" "}
                {carryOverHint.termLabel}
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        ) : (
          <p className="rounded-md border border-dashed bg-muted/20 p-3 text-sm text-muted-foreground">
            No enrollments yet. Use single enrollment per student, or wait
            for a previous term to populate so you can carry over.
          </p>
        )
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-1 font-medium">Student</th>
              <th className="px-2 py-1 font-medium">Adm. #</th>
              <th className="px-2 py-1 font-medium">Status</th>
              <th className="px-2 py-1 font-medium" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {enrollments.map((row) => (
              <EnrollmentRow
                key={row.enrollment.id}
                row={row}
                onStatusChange={onInlineStatusChange}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// =========================================================================
// Per-row inline editor.
// =========================================================================

function EnrollmentRow({
  row,
  onStatusChange,
}: {
  row: EnrollmentRowVm;
  onStatusChange: (
    enrollmentId: string,
    next: EnrollmentStatusDto,
  ) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [draft, setDraft] = useState<EnrollmentStatusDto>(
    row.enrollment.status,
  );

  const onSave = async () => {
    if (draft === row.enrollment.status) {
      setEditing(false);
      return;
    }
    setSubmitting(true);
    try {
      await onStatusChange(row.enrollment.id, draft);
      setEditing(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <tr className="border-t">
      <td className="px-2 py-1.5">{row.studentLabel}</td>
      <td className="px-2 py-1.5 font-mono text-xs text-muted-foreground">
        {row.admissionNumber}
      </td>
      <td className="px-2 py-1.5">
        {editing ? (
          <select
            value={draft}
            onChange={(e) =>
              setDraft(e.target.value as EnrollmentStatusDto)
            }
            className="h-7 rounded-md border border-input bg-background px-2 text-xs"
            disabled={submitting}
          >
            <option value="ENROLLED">Enrolled</option>
            <option value="WITHDRAWN">Withdrawn</option>
            <option value="TRANSFERRED">Transferred</option>
            <option value="REPEATED">Repeated</option>
            <option value="PROMOTED">Promoted</option>
            <option value="GRADUATED">Graduated</option>
          </select>
        ) : (
          <StatusPill status={row.enrollment.status} />
        )}
      </td>
      <td className="px-2 py-1.5 text-right">
        {editing ? (
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={onSave}
              disabled={submitting}
              className="h-7"
            >
              {submitting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => {
                setDraft(row.enrollment.status);
                setEditing(false);
              }}
              disabled={submitting}
              className="h-7"
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => setEditing(true)}
            className="h-7"
          >
            <Edit2 className="h-3 w-3" />
          </Button>
        )}
      </td>
    </tr>
  );
}

function StatusPill({ status }: { status: EnrollmentStatusDto }) {
  const tone =
    status === "ENROLLED"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : status === "WITHDRAWN"
        ? "border-rose-300 bg-rose-50 text-rose-900"
        : status === "GRADUATED"
          ? "border-blue-300 bg-blue-50 text-blue-900"
          : "border-amber-300 bg-amber-50 text-amber-900";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {status.toLowerCase()}
    </span>
  );
}

// =========================================================================
// Batched student lookup — the enrollment list endpoint returns ids only,
// so we batch-fetch the involved students in one /students request and
// build a Map for the per-row labels.
//
// The listStudents endpoint doesn't accept an ids[] filter today; we page
// through ACTIVE+WITHDRAWN+GRADUATED rows once. For Phase 1's per-arm view
// (typical roster well under 500) this is fine — slice 9 caps at 500
// enrollments per fetch and the same students appear in the list, so we
// just match by id.
// =========================================================================

async function batchStudentLookup(
  studentIds: string[],
): Promise<
  Map<string, { firstName: string; lastName: string; admissionNumber: string }>
> {
  const map = new Map<
    string,
    { firstName: string; lastName: string; admissionNumber: string }
  >();
  if (studentIds.length === 0) return map;
  // Fetch the first page of students (default 50, max 200 per page) and
  // page through until we've covered all needed ids or hit the end. The
  // typical roster never paginates here because the enrollment list is
  // capped at 500 and most schools have < 500 distinct students.
  const wanted = new Set(studentIds);
  let cursor: string | undefined = undefined;
  let safetyCounter = 0;
  while (wanted.size > 0 && safetyCounter < 20) {
    const res = await listStudents({ cursor, limit: 200 });
    for (const s of res.data) {
      if (wanted.has(s.id)) {
        map.set(s.id, {
          firstName: s.firstName,
          lastName: s.lastName,
          admissionNumber: s.admissionNumber,
        });
        wanted.delete(s.id);
      }
    }
    if (!res.meta.cursor) break;
    cursor = res.meta.cursor;
    safetyCounter += 1;
  }
  return map;
}
