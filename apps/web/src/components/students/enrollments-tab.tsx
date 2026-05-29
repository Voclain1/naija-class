"use client";

import { Loader2, PlusCircle, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type {
  ClassArmDto,
  ClassLevelDto,
  EnrollmentDto,
  EnrollmentStatusDto,
  TermDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { listTerms } from "@/lib/academic-years/academic-years-api";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import { listClassLevels } from "@/lib/class-levels/class-levels-api";
import {
  createEnrollment,
  listEnrollments,
} from "@/lib/enrollments/enrollments-api";

// /students/[id] — Enrollments tab. Phase 1 / Slice 9 cp2.
//
// Replaces the slice-4 placeholder. Fetches all enrollments for this
// student (GET /enrollments?studentId=...), orders by term sequence DESC
// across years (newest term at top, with the current term marked).
//
// Inline "Enroll in current term" CTA when no current-term row exists.
// The form is intentionally minimal — pick an arm, submit — because the
// slice-9 service derives academicYearId from termId on the server.

interface Props {
  studentId: string;
}

interface EnrollmentRowVm {
  enrollment: EnrollmentDto;
  termLabel: string;
  termSequence: number;
  yearLabel: string;
  isCurrent: boolean;
  armLabel: string;
  levelLabel: string;
}

export function EnrollmentsTab({ studentId }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<EnrollmentRowVm[]>([]);
  const [currentTermLookup, setCurrentTermLookup] = useState<TermDto | null>(
    null,
  );
  const [activeArms, setActiveArms] = useState<ClassArmDto[]>([]);
  const [levelLookup, setLevelLookup] = useState<Map<string, ClassLevelDto>>(
    new Map(),
  );
  // armLookup is consumed only inside the row-mapping closure below — we
  // don't need to expose it as state.

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Pull everything we need to render in parallel: this student's
      // enrollments (small set per student), all class arms (small per
      // school), all class levels (≤ ~20 per school).
      const [enrRes, arms, levels] = await Promise.all([
        listEnrollments({ studentId, limit: 100 }),
        listClassArms({ includeInactive: true }),
        listClassLevels({ includeInactive: true }),
      ]);

      // Term + year metadata loading is decoupled into FOUR cases so
      // the "Enroll in current term" inline CTA + the "No current term
      // is set" amber banner each fire when they should:
      //
      //   (1) Enrolled student, current term exists → load enrollment-year
      //       terms (for history labels) AND current-year terms (so the
      //       current-term lookup hits). Both unions in yearIdsToFetch.
      //   (2) Unenrolled student, current term exists → enrRes.data is
      //       empty; the current year still needs its terms loaded so
      //       currentTermLookup resolves and the inline CTA renders.
      //   (3) Any student, no current year/term set → both currentYear
      //       and the subsequent currentTermLookup come back null/undef;
      //       the amber "No current term is set" banner correctly fires.
      //   (4) No academic years at all → yearList is empty, no fetches,
      //       banner fires.
      //
      // Bug avoided here (cp2 first cut had it): gating the entire
      // listAcademicYears + listTerms chain on
      // `enrRes.data.map(e => e.academicYearId).length > 0` skips the
      // current-term lookup for case (2), making the banner fire on
      // every unenrolled student even when a current term IS set.
      // Always fetch years; union enrollment-years + current-year for
      // the per-year term fetch.
      const { listAcademicYears } = await import(
        "@/lib/academic-years/academic-years-api"
      );
      const yearList = await listAcademicYears();
      const yearMap = new Map<string, string>();
      for (const y of yearList) yearMap.set(y.id, y.label);

      const yearIdsToFetch = new Set<string>();
      const currentYear = yearList.find((y) => y.isCurrent);
      if (currentYear) yearIdsToFetch.add(currentYear.id);
      for (const e of enrRes.data) yearIdsToFetch.add(e.academicYearId);

      const termMap = new Map<string, TermDto>();
      await Promise.all(
        [...yearIdsToFetch].map(async (yid) => {
          const terms = await listTerms(yid);
          for (const t of terms) termMap.set(t.id, t);
        }),
      );

      const armM = new Map(arms.map((a) => [a.id, a]));
      const levelM = new Map(levels.map((l) => [l.id, l]));
      setLevelLookup(levelM);
      setActiveArms(arms.filter((a) => a.isActive));

      // Find the current term (could be in any year — if multiple years
      // exist we pick whichever has isCurrent=true).
      const currentTerm =
        [...termMap.values()].find((t) => t.isCurrent) ?? null;
      setCurrentTermLookup(currentTerm);

      const vms: EnrollmentRowVm[] = enrRes.data.map((e) => {
        const term = termMap.get(e.termId);
        const arm = armM.get(e.classArmId);
        const level = arm ? levelM.get(arm.classLevelId) : undefined;
        return {
          enrollment: e,
          termLabel: term?.name ?? "Unknown term",
          termSequence: term?.sequence ?? 0,
          yearLabel: yearMap.get(e.academicYearId) ?? "—",
          isCurrent: term?.isCurrent ?? false,
          armLabel: arm?.name ?? "Unknown arm",
          levelLabel: level?.name ?? "",
        };
      });

      // Order: current term first, then DESC by year label + term sequence.
      // Years lexically sort right for "2025/2026" style labels.
      vms.sort((a, b) => {
        if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
        if (a.yearLabel !== b.yearLabel)
          return a.yearLabel < b.yearLabel ? 1 : -1;
        return b.termSequence - a.termSequence;
      });
      setRows(vms);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not load enrollments.",
      );
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasCurrentTermEnrollment = useMemo(
    () => rows.some((r) => r.isCurrent),
    [rows],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading enrollments…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {!hasCurrentTermEnrollment && currentTermLookup && (
        <EnrollNowPanel
          studentId={studentId}
          term={currentTermLookup}
          activeArms={activeArms}
          levelLookup={levelLookup}
          onEnrolled={load}
        />
      )}

      {!hasCurrentTermEnrollment && !currentTermLookup && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
          No current term is set for any academic year. Set one in{" "}
          <a
            href="/settings/academic/years"
            className="underline-offset-2 hover:underline"
          >
            Settings → Academic
          </a>{" "}
          before enrolling.
        </div>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-md border border-dashed bg-muted/30 p-8 text-center">
          <p className="text-sm font-medium">No enrollments yet</p>
          <p className="text-sm text-muted-foreground">
            This student hasn&apos;t been enrolled in any term.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.enrollment.id}
              className={`flex flex-col gap-1 rounded-md border bg-card p-3 sm:flex-row sm:items-center sm:justify-between ${
                row.isCurrent ? "border-emerald-300 bg-emerald-50/40" : ""
              }`}
            >
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {row.armLabel}{" "}
                    {row.levelLabel && (
                      <span className="text-xs text-muted-foreground">
                        · {row.levelLabel}
                      </span>
                    )}
                  </span>
                  {row.isCurrent && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">
                      <Star className="h-3 w-3 fill-current" />
                      Current term
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {row.termLabel} · {row.yearLabel} · enrolled{" "}
                  {formatDate(row.enrollment.enrolledAt)}
                  {row.enrollment.withdrawnAt && (
                    <>
                      {" "}
                      · withdrew{" "}
                      {formatDate(row.enrollment.withdrawnAt as string)}
                    </>
                  )}
                </div>
              </div>
              <StatusPill status={row.enrollment.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// =========================================================================
// Inline single-enrollment CTA.
// =========================================================================

function EnrollNowPanel({
  studentId,
  term,
  activeArms,
  levelLookup,
  onEnrolled,
}: {
  studentId: string;
  term: TermDto;
  activeArms: ClassArmDto[];
  levelLookup: Map<string, ClassLevelDto>;
  onEnrolled: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [armId, setArmId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const armsByLevel = useMemo(() => {
    const map = new Map<string, ClassArmDto[]>();
    for (const a of activeArms) {
      const bucket = map.get(a.classLevelId) ?? [];
      bucket.push(a);
      map.set(a.classLevelId, bucket);
    }
    return map;
  }, [activeArms]);

  const onSubmit = async () => {
    if (!armId) return;
    setSubmitting(true);
    try {
      await createEnrollment({
        studentId,
        termId: term.id,
        classArmId: armId,
      });
      toast.success("Enrolled.");
      setShowForm(false);
      setArmId("");
      onEnrolled();
    } catch (e) {
      if (e instanceof ApiError && e.code === "ENROLLMENT_ALREADY_EXISTS") {
        toast.error("This student is already enrolled in this term.");
      } else {
        toast.error(
          e instanceof ApiError ? e.message : "Could not enrol.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!showForm) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-dashed bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <p className="font-medium">Not enrolled this term yet</p>
          <p className="text-xs text-muted-foreground">
            Current term: <strong>{term.name}</strong>. Pick a class arm to
            enrol.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowForm(true)}
        >
          <PlusCircle className="h-4 w-4" />
          Enroll in current term
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="enrol-arm" className="text-sm font-medium">
          Class arm
        </label>
        <select
          id="enrol-arm"
          value={armId}
          onChange={(e) => setArmId(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Select an arm…</option>
          {[...armsByLevel.entries()]
            .sort((a, b) => {
              const aLvl = levelLookup.get(a[0]);
              const bLvl = levelLookup.get(b[0]);
              return (aLvl?.orderIndex ?? 0) - (bLvl?.orderIndex ?? 0);
            })
            .map(([levelId, armsAtLevel]) => {
              const level = levelLookup.get(levelId);
              return (
                <optgroup
                  key={levelId}
                  label={level?.name ?? "Unknown level"}
                >
                  {armsAtLevel.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </optgroup>
              );
            })}
        </select>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setShowForm(false);
            setArmId("");
          }}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onSubmit}
          disabled={submitting || !armId}
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting ? "Enrolling…" : "Enrol"}
        </Button>
      </div>
    </div>
  );
}

// =========================================================================
// Helpers — kept module-local; small enough that extraction is overkill.
// =========================================================================

function formatDate(value: string | Date | null): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
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
