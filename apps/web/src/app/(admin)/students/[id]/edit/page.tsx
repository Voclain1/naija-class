"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { StudentDto } from "@school-kit/types";

import { StudentForm } from "@/components/students/student-form";
import { ApiError } from "@/lib/api-client";
import { getStudent } from "@/lib/students/students-api";

export default function EditStudentPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [student, setStudent] = useState<StudentDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStudent(await getStudent(id));
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.status === 404 ? "Student not found." : e.message);
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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Link
        href={`/students/${id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to student
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Edit student</h1>
        <p className="text-sm text-muted-foreground">
          Updates apply immediately. Status transitions (withdraw, graduate,
          reactivate) live on the detail page.
        </p>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : error || !student ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error ?? "Student not found."}
        </div>
      ) : (
        <StudentForm existing={student} />
      )}
    </div>
  );
}
