"use client";

import { ChevronRight, Loader2, BookOpen, UsersRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { TeacherScopeDto } from "@school-kit/types";

import { ApiError } from "@/lib/api-client";
import { getMyScope } from "@/lib/teacher/teacher-scope-api";

// /teacher/classes — slice 11 cp3. The list of arms the teacher is in scope
// for (subject-assignment arms ∪ homeroom arms), each linking to the per-arm
// roster. Same GET /teacher-scope/me read as the dashboard; this is the
// list-first entry point into the rosters.

export default function TeacherClassesPage() {
  const [scope, setScope] = useState<TeacherScopeDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setScope(await getMyScope());
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not load your classes.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="academic-workspace mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="academic-hero flex flex-col gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">My classes</h1>
        <p className="text-sm text-muted-foreground">
          Open a class to see its roster and the subjects you teach there.
        </p>
      </header>

      {!loading && !error && scope && <div className="academic-stats grid gap-3 sm:grid-cols-2"><div className="academic-stat academic-stat-mint"><UsersRound className="h-5 w-5" /><span>Assigned classes</span><strong>{scope.classArms.length}</strong></div><div className="academic-stat academic-stat-blue"><BookOpen className="h-5 w-5" /><span>Subject assignments</span><strong>{scope.classArms.reduce((sum, arm) => sum + (scope.subjectsByArm[arm.id]?.length ?? 0), 0)}</strong></div></div>}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : !scope || scope.classArms.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No classes yet.</p>
          <p className="mt-1">
            Your assigned classes will appear here once an administrator sets
            them up.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {scope.classArms.map((arm) => {
            const subjects = scope.subjectsByArm[arm.id] ?? [];
            return (
              <li key={arm.id}>
                <Link
                  href={`/teacher/classes/${arm.id}`}
                  className="academic-class-tile flex h-full items-center justify-between gap-3 p-5 text-sm transition-colors hover:border-primary/40 hover:bg-accent/40"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{arm.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {subjects.length === 0
                        ? "Form teacher"
                        : subjects.map((s) => s.name).join(", ")}
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
