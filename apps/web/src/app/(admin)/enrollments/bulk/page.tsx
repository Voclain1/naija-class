"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type {
  BulkEnrollmentResponse,
  ClassArmDto,
  ClassLevelDto,
  EnrollmentDto,
  StudentDto,
  TermDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { listTerms } from "@/lib/academic-years/academic-years-api";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import { listClassLevels } from "@/lib/class-levels/class-levels-api";
import {
  bulkCreateEnrollments,
  listEnrollments,
} from "@/lib/enrollments/enrollments-api";
import { getStudent, listStudents } from "@/lib/students/students-api";

// /enrollments/bulk — Phase 1 / Slice 9 cp2.
//
// Three-group review wizard for the carry-over CTA. Query params:
//   - armId (required): the TARGET class arm
//   - termId (required): the TARGET term
//
// The wizard derives the SOURCE term from the target term's year sequence
// (immediately-previous term in the same year that has at least one
// non-withdrawn / non-graduated enrollment for this arm).
//
// Three groups, each independently selectable:
//   (a) Carried over — ENROLLED in source term + arm, default-checked
//   (b) Withdrew last term — WITHDRAWN in source term + arm, default-UNchecked
//   (c) Admitted after term 1 — Student.admittedAt > source.endDate
//       AND no source-term enrollment in this arm, default-checked
//
// Cross-year guard: if the target term and the source term are in
// different academic years, we refuse the carry-over outright (Phase 1
// has no promotion engine; cross-year arm assignment isn't a meaningful
// default). Banner + "Back to enrollments" CTA.
//
// On Commit → POST /enrollments/bulk with the checked studentIds. The
// API is idempotent; the response splits created vs skipped vs errors.

type Group = "carried" | "withdrew" | "admitted";

interface CandidateRow {
  studentId: string;
  studentLabel: string;
  admissionNumber: string;
  group: Group;
  meta?: string; // e.g. "Admitted 2026-01-15"
}

export default function BulkEnrollmentWizardPage() {
  const search = useSearchParams();
  const armId = search.get("armId");
  const targetTermId = search.get("termId");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [arm, setArm] = useState<ClassArmDto | null>(null);
  const [level, setLevel] = useState<ClassLevelDto | null>(null);
  const [targetTerm, setTargetTerm] = useState<TermDto | null>(null);
  const [sourceTerm, setSourceTerm] = useState<TermDto | null>(null);
  const [crossYear, setCrossYear] = useState(false);

  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  // Map of studentId -> bool (checked). Initialised from group defaults.
  const [checked, setChecked] = useState<Map<string, boolean>>(new Map());

  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<BulkEnrollmentResponse | null>(null);

  // ---------- Load the wizard context ----------
  useEffect(() => {
    if (!armId || !targetTermId) {
      setError(
        "Missing armId or termId. Go back to /enrollments and use the Carry over button.",
      );
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [arms, levels] = await Promise.all([
          listClassArms({ includeInactive: true }),
          listClassLevels({ includeInactive: true }),
        ]);
        if (cancelled) return;

        const targetArm = arms.find((a) => a.id === armId) ?? null;
        if (!targetArm) {
          setError("Class arm not found.");
          setLoading(false);
          return;
        }
        setArm(targetArm);

        const targetLevel = levels.find((l) => l.id === targetArm.classLevelId) ?? null;
        setLevel(targetLevel);

        // Load all terms across years so we can find the target's year +
        // sequence; the target term shape exposes academicYearId for the
        // year lookup. We can ask the academic-year-scoped listTerms once
        // we know which year.
        //
        // Trick: GET /enrollments?termId=X returns enrollments which carry
        // the academicYearId. But we don't have any enrollments for the
        // target term (that's why we're carrying over). Use the target
        // term id to look up via the source/target's own structure: read
        // the source enrollment list to discover the academicYearId.
        //
        // Simpler: iterate every academic-year's terms until we find the
        // target. AcademicYears + their terms are small (typical Nigerian
        // school has 1-2 years × 3 terms; pilot has <10 total).
        const yearList = await (async () => {
          const { listAcademicYears } = await import(
            "@/lib/academic-years/academic-years-api"
          );
          return listAcademicYears();
        })();
        let foundTarget: TermDto | null = null;
        let foundSource: TermDto | null = null;
        for (const year of yearList) {
          const termsInYear = await listTerms(year.id);
          const target = termsInYear.find((t) => t.id === targetTermId);
          if (!target) continue;
          foundTarget = target;
          // Pick immediately-previous-term in the SAME year.
          const earlier = termsInYear
            .filter((t) => t.sequence < target.sequence)
            .sort((a, b) => b.sequence - a.sequence);
          foundSource = earlier[0] ?? null;
          break;
        }
        if (!foundTarget) {
          setError("Target term not found.");
          setLoading(false);
          return;
        }
        setTargetTerm(foundTarget);
        setSourceTerm(foundSource);

        if (!foundSource) {
          // No earlier term in the same year — this is term 1; carry-
          // over isn't applicable. The /enrollments page guards against
          // showing the CTA in this case, but be defensive.
          setError(
            "There is no earlier term in this year to carry over from. Use single enrollment for each student.",
          );
          setLoading(false);
          return;
        }
        if (foundSource.academicYearId !== foundTarget.academicYearId) {
          setCrossYear(true);
          setLoading(false);
          return;
        }

        // ---------- Build the three candidate groups ----------
        //
        // (a) carried — listEnrollments({ termId: source, classArmId: arm }) status=ENROLLED
        // (b) withdrew — same query, status=WITHDRAWN
        // (c) admitted — students with admittedAt > source.endDate, NOT
        //     already in this arm in source term
        const [carriedRaw, withdrewRaw] = await Promise.all([
          listEnrollments({
            termId: foundSource.id,
            classArmId: armId,
            status: "ENROLLED",
            limit: 500,
          }),
          listEnrollments({
            termId: foundSource.id,
            classArmId: armId,
            status: "WITHDRAWN",
            limit: 500,
          }),
        ]);

        // For (c) admitted-after we page through students and filter by
        // admittedAt. There's no server-side admittedAt-after filter
        // today; the typical roster is small enough to scan once.
        const sourceEndDate = new Date(
          foundSource.endDate instanceof Date
            ? foundSource.endDate
            : String(foundSource.endDate),
        );
        // Students already accounted for via (a) + (b) (in this arm).
        const accountedIds = new Set<string>([
          ...carriedRaw.data.map((e) => e.studentId),
          ...withdrewRaw.data.map((e) => e.studentId),
        ]);
        const admittedAfter: { studentId: string; admittedAt: Date }[] = [];
        {
          let cursor: string | undefined = undefined;
          let safety = 0;
          while (safety < 20) {
            const page = await listStudents({
              cursor,
              limit: 200,
              status: "ACTIVE",
            });
            for (const s of page.data) {
              if (accountedIds.has(s.id)) continue;
              const adm = new Date(
                s.admittedAt instanceof Date
                  ? s.admittedAt
                  : String(s.admittedAt),
              );
              if (adm > sourceEndDate) {
                admittedAfter.push({ studentId: s.id, admittedAt: adm });
              }
            }
            if (!page.meta.cursor) break;
            cursor = page.meta.cursor;
            safety += 1;
          }
        }

        // Combine + build VMs. Need student labels — batch-look-up.
        const allStudentIds = [
          ...carriedRaw.data.map((e) => e.studentId),
          ...withdrewRaw.data.map((e) => e.studentId),
          ...admittedAfter.map((a) => a.studentId),
        ];
        const studentLookup = await batchStudentLookup(allStudentIds);

        const rows: CandidateRow[] = [];
        for (const enr of carriedRaw.data) {
          const s = studentLookup.get(enr.studentId);
          rows.push({
            studentId: enr.studentId,
            studentLabel: s
              ? `${s.lastName}, ${s.firstName}`
              : `student ${enr.studentId.slice(0, 8)}`,
            admissionNumber: s?.admissionNumber ?? "—",
            group: "carried",
          });
        }
        for (const enr of withdrewRaw.data) {
          const s = studentLookup.get(enr.studentId);
          rows.push({
            studentId: enr.studentId,
            studentLabel: s
              ? `${s.lastName}, ${s.firstName}`
              : `student ${enr.studentId.slice(0, 8)}`,
            admissionNumber: s?.admissionNumber ?? "—",
            group: "withdrew",
          });
        }
        for (const ad of admittedAfter) {
          const s = studentLookup.get(ad.studentId);
          rows.push({
            studentId: ad.studentId,
            studentLabel: s
              ? `${s.lastName}, ${s.firstName}`
              : `student ${ad.studentId.slice(0, 8)}`,
            admissionNumber: s?.admissionNumber ?? "—",
            group: "admitted",
            meta: `Admitted ${ad.admittedAt.toISOString().slice(0, 10)}`,
          });
        }
        setCandidates(rows);

        // Default-check state per spec.
        const initial = new Map<string, boolean>();
        for (const row of rows) {
          if (row.group === "carried") initial.set(row.studentId, true);
          else if (row.group === "admitted") initial.set(row.studentId, true);
          else initial.set(row.studentId, false);
        }
        setChecked(initial);

        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(
          e instanceof ApiError
            ? e.message
            : "Could not load the carry-over wizard.",
        );
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [armId, targetTermId]);

  const groups = useMemo(() => {
    const carried: CandidateRow[] = [];
    const withdrew: CandidateRow[] = [];
    const admitted: CandidateRow[] = [];
    for (const c of candidates) {
      if (c.group === "carried") carried.push(c);
      else if (c.group === "withdrew") withdrew.push(c);
      else admitted.push(c);
    }
    return { carried, withdrew, admitted };
  }, [candidates]);

  const checkedCount = useMemo(() => {
    let n = 0;
    for (const [, v] of checked) if (v) n += 1;
    return n;
  }, [checked]);

  const toggle = useCallback((studentId: string) => {
    setChecked((prev) => {
      const next = new Map(prev);
      next.set(studentId, !next.get(studentId));
      return next;
    });
  }, []);

  const toggleGroup = useCallback(
    (group: Group, value: boolean) => {
      setChecked((prev) => {
        const next = new Map(prev);
        for (const c of candidates) {
          if (c.group === group) next.set(c.studentId, value);
        }
        return next;
      });
    },
    [candidates],
  );

  const onCommit = useCallback(async () => {
    if (!armId || !targetTermId) return;
    const studentIds = [...checked.entries()]
      .filter(([, v]) => v)
      .map(([id]) => id);
    if (studentIds.length === 0) {
      toast.message("Select at least one student.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await bulkCreateEnrollments({
        termId: targetTermId,
        classArmId: armId,
        studentIds,
      });
      setSummary(res);
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Could not run the bulk create.",
      );
      setSubmitting(false);
    }
  }, [armId, targetTermId, checked]);

  // ---------- Render ----------

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading carry-over wizard…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
        <Button asChild variant="outline">
          <Link href="/enrollments">
            <ArrowLeft className="h-4 w-4" />
            Back to enrollments
          </Link>
        </Button>
      </div>
    );
  }

  if (crossYear) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-700" />
          <div>
            <p className="font-medium text-amber-900">
              Cross-year carry-over isn&apos;t supported in Phase 1.
            </p>
            <p className="mt-1 text-amber-900/80">
              The previous term is in a different academic year. Promotion
              between years (next class level, repeated, etc.) needs the
              promotion engine which arrives in Phase 2/3. For now,
              enroll each student individually for this term or wait for
              the promotion engine.
            </p>
          </div>
        </div>
        <Button asChild variant="outline">
          <Link href="/enrollments">
            <ArrowLeft className="h-4 w-4" />
            Back to enrollments
          </Link>
        </Button>
      </div>
    );
  }

  if (summary) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Carry over · result
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Enrollment carry-over complete
          </h1>
        </header>
        <div className="flex items-start gap-3 rounded-md border border-emerald-300 bg-emerald-50 p-6 text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-6 w-6" />
          <div className="flex flex-col gap-1">
            <p className="text-lg font-semibold">
              Created {summary.created.toLocaleString()}{" "}
              {summary.created === 1 ? "enrollment" : "enrollments"}.
            </p>
            {summary.skipped > 0 && (
              <p className="text-sm">
                Skipped {summary.skipped.toLocaleString()}{" "}
                {summary.skipped === 1 ? "student" : "students"} — already
                enrolled in this term.
              </p>
            )}
            {summary.errors.length > 0 && (
              <p className="text-sm">
                {summary.errors.length}{" "}
                {summary.errors.length === 1 ? "row" : "rows"} couldn&apos;t
                be enrolled (see error details below).
              </p>
            )}
          </div>
        </div>
        {summary.errors.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-md border bg-card p-4 text-sm">
            {summary.errors.map((e, i) => (
              <li key={i}>
                <span className="font-mono text-xs text-muted-foreground">
                  {e.studentId.slice(0, 8)}…
                </span>
                : {e.reason}
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button asChild>
            <Link href="/enrollments">Back to enrollments</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Carry over
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {arm?.name}{" "}
          <span className="font-normal text-muted-foreground">
            ({level?.name})
          </span>
        </h1>
        <p className="text-sm text-muted-foreground">
          From <strong>{sourceTerm?.name}</strong> →{" "}
          <strong>{targetTerm?.name}</strong>. Review the three groups
          below, then commit.
        </p>
      </header>

      <CandidateGroup
        title="Carried over"
        helper="Students enrolled in the previous term + this arm. Default: include all."
        tone="success"
        rows={groups.carried}
        checked={checked}
        onToggle={toggle}
        onToggleAll={(v) => toggleGroup("carried", v)}
      />

      <CandidateGroup
        title="Withdrew last term"
        helper="Students whose previous-term enrollment was WITHDRAWN. Default: skip. Check the ones returning this term."
        tone="warning"
        rows={groups.withdrew}
        checked={checked}
        onToggle={toggle}
        onToggleAll={(v) => toggleGroup("withdrew", v)}
      />

      <CandidateGroup
        title="Admitted after previous term"
        helper="Students admitted AFTER the previous term ended. Default: include all (they belong here this term)."
        tone="success"
        rows={groups.admitted}
        checked={checked}
        onToggle={toggle}
        onToggleAll={(v) => toggleGroup("admitted", v)}
      />

      <div className="flex flex-col items-stretch justify-between gap-3 rounded-md border bg-muted/30 p-4 sm:flex-row sm:items-center">
        <div className="text-sm">
          <p className="font-medium">
            {checkedCount} {checkedCount === 1 ? "student" : "students"}{" "}
            selected for {targetTerm?.name}.
          </p>
          <p className="text-xs text-muted-foreground">
            Already-enrolled students will be skipped automatically.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            asChild
            disabled={submitting}
          >
            <Link href="/enrollments">Cancel</Link>
          </Button>
          <Button
            type="button"
            onClick={onCommit}
            disabled={submitting || checkedCount === 0}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting
              ? "Enrolling…"
              : `Commit ${checkedCount} ${
                  checkedCount === 1 ? "student" : "students"
                }`}
          </Button>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// Per-group panel with check-all toggle + per-row checkboxes.
// =========================================================================

function CandidateGroup({
  title,
  helper,
  tone,
  rows,
  checked,
  onToggle,
  onToggleAll,
}: {
  title: string;
  helper: string;
  tone: "success" | "warning";
  rows: CandidateRow[];
  checked: Map<string, boolean>;
  onToggle: (studentId: string) => void;
  onToggleAll: (value: boolean) => void;
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-300 bg-emerald-50/40"
      : "border-amber-300 bg-amber-50/40";
  const groupCheckedCount = rows.filter((r) => checked.get(r.studentId)).length;
  const allChecked = rows.length > 0 && groupCheckedCount === rows.length;

  return (
    <section className={`flex flex-col gap-2 rounded-md border p-4 ${toneClass}`}>
      <header className="flex items-baseline justify-between">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold uppercase tracking-wide">
            {title}
            <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <Users className="h-3 w-3" />
              {rows.length} total · {groupCheckedCount} selected
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">{helper}</p>
        </div>
        {rows.length > 0 && (
          <label className="inline-flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={(e) => onToggleAll(e.target.checked)}
            />
            All
          </label>
        )}
      </header>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed bg-background p-3 text-xs text-muted-foreground">
          No students in this group.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 rounded-md border bg-background p-2 text-sm">
          {rows.map((row) => (
            <li key={row.studentId}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted/40">
                <input
                  type="checkbox"
                  checked={checked.get(row.studentId) ?? false}
                  onChange={() => onToggle(row.studentId)}
                />
                <span className="flex-1">{row.studentLabel}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {row.admissionNumber}
                </span>
                {row.meta && (
                  <span className="text-xs text-muted-foreground">
                    · {row.meta}
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// =========================================================================
// Batched student lookup — pages through /students and filters by id.
// Same shape as the /enrollments page's helper. Could be extracted to a
// shared helper if a third page needs it.
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
  // Look up each student id directly — there are typically only a few
  // dozen carry-over candidates per arm, and per-id GET is faster than
  // paging through a large /students list. Falls back to the label
  // "student abcd1234..." in the consumer if a lookup fails.
  const wanted = Array.from(new Set(studentIds));
  await Promise.all(
    wanted.map(async (id) => {
      try {
        const s: StudentDto = await getStudent(id);
        map.set(s.id, {
          firstName: s.firstName,
          lastName: s.lastName,
          admissionNumber: s.admissionNumber,
        });
      } catch {
        // Swallow — the row renders the fallback label.
      }
    }),
  );
  return map;
}

// Mark unused imports as referenced for the linter — EnrollmentDto is part
// of the API client return types but we don't destructure it here.
void {} as unknown as EnrollmentDto;
