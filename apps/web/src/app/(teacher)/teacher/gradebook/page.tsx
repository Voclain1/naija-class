"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { TeacherScopeDto } from "@school-kit/types";

import { TeacherPrerequisiteNotice } from "@/components/teacher/teacher-prerequisite-notice";
import { ApiError } from "@/lib/api-client";
import { getMyScope } from "@/lib/teacher/teacher-scope-api";

// /teacher/gradebook — the picker. Pick an assigned (arm → subject); the grid
// for that column opens at /teacher/gradebook/[armId]/[subjectId]. The gradebook
// is current-term-only in slice 3, so the term comes from scope.currentTerm
// (no term picker). Reads the same GET /teacher-scope/me the rest of the portal
// uses, now carrying currentTerm.
export default function GradebookPickerPage() {
  const [scope, setScope] = useState<TeacherScopeDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setScope(await getMyScope());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load your gradebook.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Arms that actually have subjects to grade (homeroom-only arms have none).
  const gradeableArms = scope
    ? scope.classArms.filter((arm) => (scope.subjectsByArm[arm.id] ?? []).length > 0)
    : [];
  const enrolled = (armId: string) => scope?.enrolledCountByArm[armId] ?? 0;
  const noStudentsAnywhere =
    !!scope?.currentTerm && gradeableArms.length > 0 && gradeableArms.every((arm) => enrolled(arm.id) === 0);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Gradebook</h1>
        <p className="text-sm text-muted-foreground">
          Pick a class and subject to enter scores for the current term.
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
      ) : !scope ? null : (
        <>
          {scope.currentTerm ? (
            <p className="text-sm text-muted-foreground">
              Entering marks for{" "}
              <span className="font-medium text-foreground">{scope.currentTerm.name}</span>.
            </p>
          ) : (
            <div className="rounded-md border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-800">
              No active term yet. Ask an administrator to set the current term before entering
              scores.
            </div>
          )}

          {noStudentsAnywhere ? (
            <TeacherPrerequisiteNotice
              testId="teacher-prerequisite-no-students"
              title="There are no students to grade yet."
              detail={`None of your classes has students enrolled for ${scope.currentTerm?.name ?? "this term"}. Ask your school administrator to enrol them; your class lists fill in here once they do.`}
            />
          ) : null}

          {gradeableArms.length === 0 ? (
            <TeacherPrerequisiteNotice
              testId="teacher-prerequisite-no-subjects"
              title="You have not been assigned a subject yet."
              detail="Your school administrator assigns each teacher their subjects and classes. Ask them to assign yours; they appear here as soon as they do."
            />
          ) : (
            <ul className="flex flex-col gap-4">
              {gradeableArms.map((arm) => (
                <li key={arm.id} className="rounded-md border">
                  <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-2 text-sm font-medium">
                    <span>{arm.name}</span>
                    {scope.currentTerm ? (
                      <span className="text-xs font-normal text-muted-foreground">
                        {enrolled(arm.id) === 0
                          ? "No students enrolled yet"
                          : `${enrolled(arm.id)} ${enrolled(arm.id) === 1 ? "student" : "students"}`}
                      </span>
                    ) : null}
                  </div>
                  <ul className="flex flex-col divide-y">
                    {(scope.subjectsByArm[arm.id] ?? []).map((subject) => (
                      <li key={subject.id}>
                        <Link
                          href={`/teacher/gradebook/${arm.id}/${subject.id}`}
                          className="flex items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-accent/40"
                        >
                          <span>{subject.name}</span>
                          <span className="text-xs text-muted-foreground">Open gradebook →</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
