"use client";

import { FileText, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ClassArmDto, TermDto } from "@school-kit/types";

import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import { getMyScope } from "@/lib/teacher/teacher-scope-api";

interface ArmOption {
  id: string;
  name: string;
}

interface Loaded {
  terms: TermDto[]; // selectable terms (managers); single current term for form teachers
  arms: ArmOption[]; // arms the viewer may open
  isManager: boolean;
}

// /report-cards — the picker. Owner/admin pick any term + any arm; a form
// teacher is scoped to the current term and ONLY the arms they are the form
// teacher of (the same Flag-B gate the gradebook uses). Selecting an arm opens
// its workflow board at /report-cards/[armId]?termId=<term>.
export default function ReportCardsPickerPage() {
  const { roles } = useAuth();
  const isManager = useMemo(
    () => roles.some((r) => r.key === "owner" || r.key === "admin"),
    [roles],
  );

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [termId, setTermId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isManager) {
        const years = await listAcademicYears();
        const currentYear = years.find((y) => y.isCurrent) ?? years[0] ?? null;
        const terms = currentYear ? await listTerms(currentYear.id) : [];
        const arms = await listClassArms();
        const armOptions = arms
          .map((a: ClassArmDto) => ({ id: a.id, name: a.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const currentTerm = terms.find((t) => t.isCurrent) ?? terms[0] ?? null;
        setLoaded({ terms, arms: armOptions, isManager: true });
        setTermId(currentTerm?.id ?? null);
      } else {
        const scope = await getMyScope();
        const arms = scope.classArms
          .filter((a) => scope.formTeacherArmIds.includes(a.id))
          .map((a) => ({ id: a.id, name: a.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
        // Form teachers are current-term-only (same as the gradebook). Present
        // the current term as the single, non-switchable term.
        const terms: TermDto[] = scope.currentTerm
          ? [
              {
                id: scope.currentTerm.id,
                name: scope.currentTerm.name,
                academicYearId: "",
                sequence: scope.currentTerm.sequence,
                startDate: "",
                endDate: "",
                isCurrent: true,
                createdAt: "",
                updatedAt: "",
              },
            ]
          : [];
        setLoaded({ terms, arms, isManager: false });
        setTermId(scope.currentTerm?.id ?? null);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load report cards.");
    } finally {
      setLoading(false);
    }
  }, [isManager]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Report cards</h1>
        <p className="text-sm text-muted-foreground">
          Pick a term and class to build, review, and generate report-card PDFs.
        </p>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : !loaded ? null : loaded.terms.length === 0 ? (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-800">
          No active term yet. Ask an administrator to set the current term before building report
          cards.
        </div>
      ) : (
        <>
          {/* Term selector — a real picker for managers, fixed for form teachers. */}
          {loaded.isManager ? (
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Term</span>
              <select
                value={termId ?? ""}
                onChange={(e) => setTermId(e.target.value)}
                className="w-full max-w-xs rounded-md border bg-background px-3 py-2 text-sm"
              >
                {loaded.terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.isCurrent ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-sm text-muted-foreground">
              Term:{" "}
              <span className="font-medium text-foreground">
                {loaded.terms[0]?.name}
              </span>
            </p>
          )}

          {loaded.arms.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                {loaded.isManager ? "No classes set up yet." : "No classes assigned to you."}
              </p>
              <p className="mt-1">
                {loaded.isManager
                  ? "Create class arms under Academics before building report cards."
                  : "Report cards are available to the form teacher of a class. You are not currently a form teacher of any class."}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col divide-y rounded-md border">
              {loaded.arms.map((arm) => (
                <li key={arm.id}>
                  <Link
                    href={`/report-cards/${arm.id}${termId ? `?termId=${termId}` : ""}`}
                    className="flex items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-accent/40"
                    aria-disabled={!termId}
                  >
                    <span className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {arm.name}
                    </span>
                    <span className="text-xs text-muted-foreground">Open board →</span>
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
