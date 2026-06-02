"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { TeacherScopeDto } from "@school-kit/types";

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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Gradebook</h1>
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

          {gradeableArms.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">No subjects to grade yet.</p>
              <p className="mt-1">
                Your subject assignments will appear here once an administrator sets them up.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-4">
              {gradeableArms.map((arm) => (
                <li key={arm.id} className="rounded-md border">
                  <div className="border-b bg-muted/30 px-4 py-2 text-sm font-medium">{arm.name}</div>
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
