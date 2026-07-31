"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { BulkStudentForm } from "@/components/students/bulk-student-form";

export default function BulkAddStudentsPage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <Link
        href="/students"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to roster
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">
          Add multiple students
        </h1>
        <p className="text-sm text-muted-foreground">
          Fill in a row per student. Required: admission number, name, date of
          birth, and gender. Class arm assignment and guardians are added
          afterward — from{" "}
          <Link href="/enrollments/bulk" className="underline underline-offset-2">
            bulk enrollment
          </Link>{" "}
          and each student&apos;s own page.
        </p>
      </header>
      <BulkStudentForm />
    </div>
  );
}
