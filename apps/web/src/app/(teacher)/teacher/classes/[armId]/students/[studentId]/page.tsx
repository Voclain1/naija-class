"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import type { TeacherRosterStudentDto } from "@school-kit/types";

import { StudentHealthNote } from "@/components/health/teacher-health-notes";
import { BehaviourTab } from "@/components/students/behaviour-tab";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { getMyArmRoster } from "@/lib/teacher/teacher-scope-api";

// /teacher/classes/[armId]/students/[studentId] — a child's conduct records,
// for a teacher of their class (pre-build audit, 2026-10-13).
//
// The API has let teachers write and read these since #351 ("the judgement of
// the person who was in the room", the-school-day.md), but the only screen was
// the admin's student record, which teachers cannot open. This page reaches it
// from the teacher's own class list. The name comes from that roster (PII-
// narrow by construction); a child not on it reads as not found, as the
// roster's own 404 does.
export default function TeacherStudentBehaviourPage() {
  const { armId, studentId } = useParams<{ armId: string; studentId: string }>();
  const [student, setStudent] = useState<TeacherRosterStudentDto | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getMyArmRoster(armId)
      .then((roster) => {
        if (!live) return;
        const found = roster.data.find((s) => s.id === studentId) ?? null;
        setStudent(found);
        setState(found ? "ready" : "missing");
      })
      .catch((e: unknown) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 404) {
          setState("missing");
          return;
        }
        setError(e instanceof ApiError ? e.message : "Could not load this student.");
        setState("error");
      });
    return () => {
      live = false;
    };
  }, [armId, studentId]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/teacher/classes/${armId}`}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to the class
          </Link>
        </Button>
      </div>

      {state === "loading" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : state === "missing" ? (
        <p className="text-sm text-muted-foreground">This student is not in one of your classes.</p>
      ) : state === "error" ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : student ? (
        <>
          <header className="flex flex-col gap-1">
            <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">
              {student.firstName} {student.lastName}
            </h1>
            <p className="text-sm text-muted-foreground">
              Behaviour records. Staff only: parents and students never see these.
            </p>
          </header>
          {/* Phase 9 / CP3.1: the health officer's note for teachers, if any. */}
          <StudentHealthNote studentId={student.id} />
          <BehaviourTab studentId={student.id} />
        </>
      ) : null}
    </div>
  );
}
