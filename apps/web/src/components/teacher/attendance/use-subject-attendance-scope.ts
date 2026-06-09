"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import { getSchoolMe } from "@/lib/onboarding/schools-api";
import { listSubjects } from "@/lib/subjects/subjects-api";
import { getMyScope } from "@/lib/teacher/teacher-scope-api";

// Scope for the subject-period attendance surface. Unlike daily attendance, the
// picker is subject-first → arm (only the arms where the teacher teaches that
// subject). Also surfaces subjectAttendanceEnabled so the page can gate itself.
//
//   • teacher → subjects they teach (from subjectsByArm), arms-per-subject,
//     current term, and the flag (all from one /teacher-scope/me read).
//   • owner/admin → every subject + every arm (no cross-filter — owner bypasses
//     the subject-scope gate server-side and the roster is arm-based), real term
//     picker, flag from /schools/me.

export interface SubjectOption {
  id: string;
  name: string;
}
export interface ArmOption {
  id: string;
  name: string;
}
export interface TermOption {
  id: string;
  name: string;
  isCurrent: boolean;
}

export interface SubjectAttendanceScope {
  isManager: boolean;
  subjectAttendanceEnabled: boolean;
  subjects: SubjectOption[];
  // The arms a given subject may be marked in. Managers see all arms regardless.
  armsForSubject: (subjectId: string) => ArmOption[];
  terms: TermOption[];
  currentTermId: string | null;
}

export type SubjectScopeState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; scope: SubjectAttendanceScope };

export function useSubjectAttendanceScope(): { state: SubjectScopeState; reload: () => void } {
  const { roles } = useAuth();
  const isManager = useMemo(() => roles.some((r) => r.key === "owner" || r.key === "admin"), [roles]);

  const [state, setState] = useState<SubjectScopeState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      if (isManager) {
        const [school, subjectList, armList, years] = await Promise.all([
          getSchoolMe(),
          listSubjects(),
          listClassArms(),
          listAcademicYears(),
        ]);
        const currentYear = years.find((y) => y.isCurrent) ?? years[0] ?? null;
        const terms = currentYear ? await listTerms(currentYear.id) : [];
        const arms: ArmOption[] = armList.map((a) => ({ id: a.id, name: a.name })).sort((x, y) => x.name.localeCompare(y.name));
        const termOptions: TermOption[] = terms.map((t) => ({ id: t.id, name: t.name, isCurrent: t.isCurrent }));
        const currentTerm = termOptions.find((t) => t.isCurrent) ?? termOptions[0] ?? null;
        setState({
          kind: "ready",
          scope: {
            isManager: true,
            subjectAttendanceEnabled: school.subjectAttendanceEnabled,
            subjects: subjectList.map((s) => ({ id: s.id, name: s.name })).sort((x, y) => x.name.localeCompare(y.name)),
            armsForSubject: () => arms, // managers: any subject in any arm
            terms: termOptions,
            currentTermId: currentTerm?.id ?? null,
          },
        });
      } else {
        const scope = await getMyScope();
        // Collect the distinct subjects this teacher teaches, and remember which
        // arms each is taught in (invert subjectsByArm).
        const subjectsById = new Map<string, SubjectOption>();
        const armsBySubject = new Map<string, ArmOption[]>();
        for (const arm of scope.classArms) {
          for (const subject of scope.subjectsByArm[arm.id] ?? []) {
            if (!subjectsById.has(subject.id)) subjectsById.set(subject.id, { id: subject.id, name: subject.name });
            const arms = armsBySubject.get(subject.id) ?? [];
            arms.push({ id: arm.id, name: arm.name });
            armsBySubject.set(subject.id, arms);
          }
        }
        const subjects = [...subjectsById.values()].sort((x, y) => x.name.localeCompare(y.name));
        const terms: TermOption[] = scope.currentTerm
          ? [{ id: scope.currentTerm.id, name: scope.currentTerm.name, isCurrent: true }]
          : [];
        setState({
          kind: "ready",
          scope: {
            isManager: false,
            subjectAttendanceEnabled: scope.subjectAttendanceEnabled,
            subjects,
            armsForSubject: (subjectId) =>
              (armsBySubject.get(subjectId) ?? []).slice().sort((x, y) => x.name.localeCompare(y.name)),
            terms,
            currentTermId: scope.currentTerm?.id ?? null,
          },
        });
      }
    } catch (e) {
      setState({ kind: "error", message: e instanceof ApiError ? e.message : "Could not load your subjects." });
    }
  }, [isManager]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
