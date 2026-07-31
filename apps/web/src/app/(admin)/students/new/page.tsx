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
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Add student</h1>
        <p className="text-sm text-muted-foreground">
          Required fields: admission number, name, date of birth, and gender.
          You can fill the rest later. Adding several at once?{" "}
          <Link href="/students/new/bulk" className="underline underline-offset-2">
            Use the grid
          </Link>
          .
        </p>
      </header>
      <StudentForm />
    </div>
  );
}
