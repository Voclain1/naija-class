"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type {
  TeacherRosterStudentDto,
  TeacherScopeArmDto,
  TeacherScopeSubjectDto,
} from "@school-kit/types";

import { StudentAvatar } from "@/components/students/student-avatar";
import { StudentStatusBadge } from "@/components/students/student-status-badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { getMyArmRoster, getMyScope } from "@/lib/teacher/teacher-scope-api";

// /teacher/classes/[armId] — slice 11 cp3. One arm: the subjects this teacher
// teaches in it + the student roster (current-term enrolled).
//
// SCOPE 404 (the acceptance-#9 security property): GET
// /teacher-scope/me/arms/:armId/students returns 404 when the arm is not in
// the teacher's scope (or belongs to another tenant) — the server makes it
// appear NOT TO EXIST, not "forbidden". This client page mirrors that: a 404
// renders a "not one of your classes" state with a link back, rather than the
// roster. (The prompt suggested server-side notFound(); the app is fully
// client-auth via a localStorage bearer token, so a server component can't
// read the session — this is the faithful client equivalent.)
//
// Roster is PII-NARROW by construction: the endpoint returns only name,
// admission number, gender, photo, status (cp2's TeacherRosterStudentDto).

export default function TeacherArmRosterPage() {
  const params = useParams<{ armId: string }>();
  const armId = params.armId;

  const [arm, setArm] = useState<TeacherScopeArmDto | null>(null);
  const [subjects, setSubjects] = useState<TeacherScopeSubjectDto[]>([]);
  const [students, setStudents] = useState<TeacherRosterStudentDto[]>([]);
  const [outOfScope, setOutOfScope] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setOutOfScope(false);
    try {
      // Roster 404s if the arm isn't in scope; scope gives us the arm's
      // display name + the subjects this teacher teaches there.
      const [scope, roster] = await Promise.all([
        getMyScope(),
        getMyArmRoster(armId),
      ]);
      setArm(scope.classArms.find((a) => a.id === armId) ?? null);
      setSubjects(scope.subjectsByArm[armId] ?? []);
      setStudents(roster.data);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setOutOfScope(true);
      } else {
        setError(
          e instanceof ApiError ? e.message : "Could not load this class.",
        );
      }
    } finally {
      setLoading(false);
    }
  }, [armId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  if (outOfScope) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          That class isn&apos;t one of yours. You can only view the rosters for
          classes you teach.
        </div>
        <Button asChild variant="outline">
          <Link href="/teacher/classes">
            <ArrowLeft className="h-4 w-4" />
            Back to my classes
          </Link>
        </Button>
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
          <Link href="/teacher/classes">
            <ArrowLeft className="h-4 w-4" />
            Back to my classes
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <Link
          href="/teacher/classes"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-2 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to my classes
        </Link>
      </div>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {arm?.name ?? "Class"}
        </h1>
        {subjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You are the form teacher for this class.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">You teach:</span>
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
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Roster ({students.length})
        </h2>
        {students.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
            No students are enrolled in this class for the current term yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Student</th>
                  <th className="px-3 py-2 font-medium">Admission #</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <StudentAvatar
                          firstName={s.firstName}
                          lastName={s.lastName}
                          photoUrl={s.photoUrl}
                          size="sm"
                        />
                        <span className="font-medium">
                          {s.lastName}, {s.firstName}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {s.admissionNumber}
                    </td>
                    <td className="px-3 py-2">
                      <StudentStatusBadge status={s.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
