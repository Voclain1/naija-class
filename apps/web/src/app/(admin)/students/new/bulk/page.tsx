"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { BulkStudentForm } from "@/components/students/bulk-student-form";

export default function BulkAddStudentsPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
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
          One row per student — admission number, name, date of birth and
          gender. Contact and bio details come later, from the student&apos;s
          own portal. Class arm assignment happens in{" "}
          <Link href="/enrollments/bulk" className="underline underline-offset-2">
            bulk enrollment
          </Link>
          , and guardians on each student&apos;s page.
        </p>
      </header>

      <div className="rounded-md border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Faster ways to fill this in:</span>{" "}
        paste a block copied straight from Excel or Google Sheets into any cell
        and it spreads across the grid (dd/mm/yyyy dates and &ldquo;M&rdquo;/&ldquo;F&rdquo;
        genders are converted for you) · press{" "}
        <kbd className="rounded border bg-background px-1 py-0.5 font-sans">Enter</kbd>{" "}
        to drop down the column · press{" "}
        <kbd className="rounded border bg-background px-1 py-0.5 font-sans">Tab</kbd>{" "}
        to move across · new rows appear as you go, and blank ones are ignored.
      </div>

      {/*
        Recovery guidance for someone returning after an interrupted attempt.
        Static, because it is always true and needs no state: a submit that
        stops partway leaves the successful rows created, and this grid cannot
        remember them across a sign-out (drafts in browser storage were
        considered and rejected — see docs/deferred.md). What makes re-entering
        safe is the server, not our memory: admission numbers are unique per
        school, so a duplicate is refused per-row rather than creating a second
        child record.
      */}
      <div className="rounded-md border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Interrupted partway through?</span>{" "}
        Students added before the interruption are already saved. Re-entering
        them is safe — an admission number that already exists is rejected on
        its own row instead of creating a second record, so the roster is the
        one to trust.
      </div>

      <BulkStudentForm />
    </div>
  );
}
