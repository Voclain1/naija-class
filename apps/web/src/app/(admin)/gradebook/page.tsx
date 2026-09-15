"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { TeacherAssignmentDto, TermDto } from "@school-kit/types";

import { PrerequisiteNotice } from "@/components/setup/prerequisite-notice";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { ApiError } from "@/lib/api-client";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import { listClassLevels } from "@/lib/class-levels/class-levels-api";
import { listYearTeacherAssignments } from "@/lib/gradebook/admin-gradebook-api";
import {
  defaultGradebookTerm,
  gradebookArms,
  gradebookSubjects,
  type GradebookArmOption,
} from "@/lib/gradebook/admin-gradebook";
import { listSubjects } from "@/lib/subjects/subjects-api";

interface Loaded {
  terms: TermDto[];
  arms: GradebookArmOption[];
  subjects: Awaited<ReturnType<typeof listSubjects>>;
  assignments: TeacherAssignmentDto[];
}

// /gradebook — the owner/admin gradebook picker.
//
// Owners and admins have always been allowed to enter scores for any class and
// subject (Phase 2 / Slice 2, Flag #1). Until this page, the only gradebook was
// the teacher's, whose picker lists the viewer's own teaching assignments — so an
// owner had the permission and no screen, and was told to invite themselves as a
// teacher. This picker lists the school's classes and every active subject
// instead (lib/gradebook/admin-gradebook.ts). The grid behind it is the same
// component the teacher uses, against the same endpoints.
//
// The chosen term and class ride in the query string so the grid's back link
// returns to the same selection.
export default function AdminGradebookPickerPage() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const years = await listAcademicYears();
      const year = years.find((y) => y.isCurrent) ?? years[0] ?? null;
      const [terms, arms, levels, subjects, assignments] = await Promise.all([
        year ? listTerms(year.id) : Promise.resolve([] as TermDto[]),
        listClassArms(),
        listClassLevels(),
        listSubjects(),
        year ? listYearTeacherAssignments(year.id) : Promise.resolve([] as TeacherAssignmentDto[]),
      ]);
      setLoaded({ terms, arms: gradebookArms(arms, levels), subjects, assignments });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the gradebook.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const term = useMemo(() => {
    if (!loaded) return null;
    return loaded.terms.find((t) => t.id === search.get("termId")) ?? defaultGradebookTerm(loaded.terms);
  }, [loaded, search]);

  const armId = loaded?.arms.some((a) => a.id === search.get("armId")) ? search.get("armId") : null;

  const subjects = useMemo(
    () => (loaded && term && armId ? gradebookSubjects(loaded.subjects, loaded.assignments, armId, term) : []),
    [loaded, term, armId],
  );

  function select(next: { termId?: string; armId?: string }) {
    const params = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Gradebook</h1>
        <p className="text-sm text-muted-foreground">
          Enter scores for any class and subject. Teachers enter scores for their own subjects from
          their gradebook; you can do it for any of them here.
        </p>
      </header>

      <PrerequisiteNotice
        stepKey="enrollments"
        because="These classes are empty, so there is nobody to enter scores for yet."
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : !loaded ? null : !term ? (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-800">
          No terms yet. Add the academic year and its terms under{" "}
          <Link href="/settings/academic" className="font-medium underline">
            Academics
          </Link>{" "}
          before entering scores.
        </div>
      ) : loaded.arms.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No classes set up yet.</p>
          <p className="mt-1">Create classes under Academics before entering scores.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Term</span>
              <select
                value={term.id}
                onChange={(e) => select({ termId: e.target.value })}
                className="w-56 max-w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {loaded.terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.isCurrent ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Class</span>
              <select
                value={armId ?? ""}
                onChange={(e) => select({ armId: e.target.value })}
                className="w-56 max-w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">Choose a class</option>
                {loaded.arms.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!armId ? (
            <p className="text-sm text-muted-foreground">Choose a class to see its subjects.</p>
          ) : subjects.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">No subjects yet.</p>
              <p className="mt-1">Add subjects under Academics before entering scores.</p>
            </div>
          ) : (
            <ul className="flex flex-col divide-y rounded-md border" aria-label="Subjects">
              {subjects.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/gradebook/${armId}/${s.id}?termId=${term.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors hover:bg-accent/40"
                  >
                    <span>{s.name}</span>
                    <span className="flex items-center gap-3 text-xs text-muted-foreground">
                      {s.hasTeacher ? <span>Teacher assigned</span> : <span>No teacher assigned</span>}
                      <span aria-hidden>Open gradebook →</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
