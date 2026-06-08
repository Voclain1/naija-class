"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import { getMyScope } from "@/lib/teacher/teacher-scope-api";

// Shared arm/term scoping for both attendance pages. Mirrors the report-cards
// picker's manager-vs-form-teacher split (the same Flag-B gate the gradebook +
// report cards use), so the two surfaces agree on who sees which arms:
//
//   • owner/admin  → every arm + a real term picker (current year's terms)
//   • form teacher → ONLY the arms they form-teach + the current term (fixed)
//   • subject-only teacher → no arms (daily attendance is the form teacher's job)
//
// The server is the source of truth (the register/summary reads 403/404 an
// out-of-scope arm); this only decides what to OFFER in the pickers.

export interface ArmOption {
  id: string;
  name: string;
}

export interface TermOption {
  id: string;
  name: string;
  isCurrent: boolean;
}

export interface AttendanceScope {
  isManager: boolean;
  arms: ArmOption[];
  terms: TermOption[];
  currentTermId: string | null;
}

export type AttendanceScopeState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; scope: AttendanceScope };

export function useAttendanceScope(): { state: AttendanceScopeState; reload: () => void } {
  const { roles } = useAuth();
  const isManager = useMemo(
    () => roles.some((r) => r.key === "owner" || r.key === "admin"),
    [roles],
  );

  const [state, setState] = useState<AttendanceScopeState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      if (isManager) {
        const years = await listAcademicYears();
        const currentYear = years.find((y) => y.isCurrent) ?? years[0] ?? null;
        const terms = currentYear ? await listTerms(currentYear.id) : [];
        const arms = (await listClassArms())
          .map((a) => ({ id: a.id, name: a.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const termOptions: TermOption[] = terms.map((t) => ({ id: t.id, name: t.name, isCurrent: t.isCurrent }));
        const currentTerm = termOptions.find((t) => t.isCurrent) ?? termOptions[0] ?? null;
        setState({
          kind: "ready",
          scope: { isManager: true, arms, terms: termOptions, currentTermId: currentTerm?.id ?? null },
        });
      } else {
        const scope = await getMyScope();
        const arms = scope.classArms
          .filter((a) => scope.formTeacherArmIds.includes(a.id))
          .map((a) => ({ id: a.id, name: a.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
        // Form teachers are current-term-only (same as the gradebook): the
        // current term rides on /teacher-scope/me since `term.read` is admin-only.
        const terms: TermOption[] = scope.currentTerm
          ? [{ id: scope.currentTerm.id, name: scope.currentTerm.name, isCurrent: true }]
          : [];
        setState({
          kind: "ready",
          scope: { isManager: false, arms, terms, currentTermId: scope.currentTerm?.id ?? null },
        });
      }
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof ApiError ? e.message : "Could not load your classes.",
      });
    }
  }, [isManager]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
