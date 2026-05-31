"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { TeacherScopeDto } from "@school-kit/types";

import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { getMyScope } from "@/lib/teacher/teacher-scope-api";

// /teacher/dashboard — slice 11 cp3. The teacher's landing page: a welcome +
// the grouped view of "what I teach" (arms, each with the subjects I teach in
// it). Reads GET /teacher-scope/me, which is scope-filtered server-side — this
// page renders exactly what the API returns and enforces nothing itself.
//
// CLIENT component (not server): the whole app authenticates with a Bearer
// token in localStorage, so a server component couldn't read the session. The
// other (teacher) page (/teacher/profile) is client for the same reason.

export default function TeacherDashboardPage() {
  const { user } = useAuth();
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome{user?.firstName ? `, ${user.firstName}` : ""}.
        </h1>
        <p className="text-sm text-muted-foreground">
          The classes and subjects you teach.
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
      ) : !scope || scope.classArms.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No classes assigned yet.</p>
          <p className="mt-1">
            Once an administrator assigns you to teach a subject in a class —
            or makes you a class teacher — your classes will appear here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {scope.classArms.map((arm) => {
            const subjects = scope.subjectsByArm[arm.id] ?? [];
            return (
              <Link
                key={arm.id}
                href={`/teacher/classes/${arm.id}`}
                className="flex flex-col gap-2 rounded-md border bg-card p-4 transition-colors hover:bg-accent/40"
              >
                <span className="font-medium">{arm.name}</span>
                {subjects.length === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    Form teacher
                  </span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {subjects.map((s) => (
                      <span
                        key={s.id}
                        className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium"
                      >
                        {s.name}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
