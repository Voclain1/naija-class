"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { StudentForm } from "@/components/students/student-form";

export default function NewStudentPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Link
        href="/students"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to roster
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Add student</h1>
        <p className="text-sm text-muted-foreground">
          Required fields: admission number, name, date of birth, and gender.
          You can fill the rest later.
        </p>
      </header>
      <StudentForm />
    </div>
  );
}
