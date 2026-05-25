"use client";

import { ArrowLeft, Loader2, Pencil } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { StudentDetailDto, StudentDto } from "@school-kit/types";

import { StudentAvatar } from "@/components/students/student-avatar";
import { StudentDetailTabs } from "@/components/students/student-detail-tabs";
import { StudentStatusActions } from "@/components/students/student-status-actions";
import { StudentStatusBadge } from "@/components/students/student-status-badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { getStudent } from "@/lib/students/students-api";

export default function StudentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [student, setStudent] = useState<StudentDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStudent(await getStudent(id));
    } catch (e) {
      if (e instanceof ApiError) {
        setError(
          e.status === 404 ? "Student not found." : e.message,
        );
      } else {
        setError("Could not load student.");
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Status-transition handler merges the API response (a StudentDto) onto
  // the local StudentDetailDto, preserving the guardians[] array.
  const onStatusChanged = useCallback((next: StudentDto) => {
    setStudent((prev) =>
      prev ? { ...prev, ...next, guardians: prev.guardians } : prev,
    );
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  if (error || !student) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <Link
          href="/students"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to roster
        </Link>
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error ?? "Student not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Link
        href="/students"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to roster
      </Link>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-4">
          <StudentAvatar
            firstName={student.firstName}
            lastName={student.lastName}
            photoUrl={student.photoUrl}
            size="lg"
          />
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {student.firstName}
              {student.middleName ? ` ${student.middleName}` : ""}{" "}
              {student.lastName}
            </h1>
            <p className="font-mono text-sm text-muted-foreground">
              {student.admissionNumber}
            </p>
            <StudentStatusBadge status={student.status} className="w-fit" />
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:items-end">
          <Button asChild variant="outline">
            <Link href={`/students/${student.id}/edit`}>
              <Pencil className="mr-1 h-4 w-4" />
              Edit
            </Link>
          </Button>
          <StudentStatusActions
            student={student}
            onChanged={onStatusChanged}
          />
        </div>
      </header>

      <StudentDetailTabs student={student} />
    </div>
  );
}
