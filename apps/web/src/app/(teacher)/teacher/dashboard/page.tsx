"use client";

import { ClipboardCheck, Loader2 } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/has-permission";
import { useCallback, useEffect, useState } from "react";

import type { TeacherScopeDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
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
  const { user, permissions } = useAuth();
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
      {/* Roll Call lives HERE, on the teacher dashboard, rather than on the
          admin dashboard's header. Owner/admin can use /teacher/attendance —
          the page is explicitly built for managers — but reaching it from an
          admin header quick-action swapped the whole shell's chrome mid-task,
          which read as a glitch rather than a navigation. Review, 2026-09-10.

          This dashboard previously had NO entry point to the register at all:
          a teacher had to find Attendance in the sidebar. */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">
            Welcome{user?.firstName ? `, ${user.firstName}` : ""}.
          </h1>
          <p className="text-sm text-muted-foreground">
            The classes and subjects you teach.
          </p>
        </div>
        {hasPermission(permissions, "attendance.mark") && (
          <Button asChild size="sm">
            <Link href="/teacher/attendance">
              <ClipboardCheck className="mr-2 h-4 w-4" aria-hidden />
              Roll Call
            </Link>
          </Button>
        )}
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
                      <Badge key={s.id} variant="muted">
                        {s.name}
                      </Badge>
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
