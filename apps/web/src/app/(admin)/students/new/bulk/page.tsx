"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { HelpTip } from "@/components/shared/help-tip";
import {
  AdmissionNumbersBar,
  AdmissionNumbersQuestion,
  useAdmissionNumbers,
} from "@/components/students/admission-numbers";
import { BulkStudentForm } from "@/components/students/bulk-student-form";

export default function BulkAddStudentsPage() {
  // Asked once on arrival by a new school, then shown above the grid
  // (docs/modules/admission-numbers.md).
  const { settings, setSettings } = useAdmissionNumbers();
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <Link
        href="/students"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to roster
      </Link>
      {/* One line on the page; the tips and the interrupted-upload note
          live behind the "?" (owner's ask, 2026-10-30). Rows go to the server
          200 at a time, all or nothing per batch (POST /students/bulk), and
          admission numbers are unique per school, so re-entering after an
          interruption is refused per row rather than duplicating a child. */}
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">
            Add multiple students
          </h1>
          <HelpTip title="Adding several students">
            <p>
              One row per student: admission number, name, date of birth and
              gender. Contact details come later, and guardians are added on
              each student&apos;s page.
            </p>
            <p>
              <span className="font-medium text-foreground">Paste from Excel or Google Sheets</span>{" "}
              into any cell and it spreads across the grid. Dates like
              dd/mm/yyyy and &ldquo;M&rdquo;/&ldquo;F&rdquo; are converted for you.
            </p>
            <p>
              <span className="font-medium text-foreground">Enter</span> moves down,{" "}
              <span className="font-medium text-foreground">Tab</span> moves across. New
              rows appear as you go; blank ones are ignored.
            </p>
            <p>
              <span className="font-medium text-foreground">Interrupted?</span> Students
              added before it are saved. Entering them again is safe: an admission
              number that already exists is refused on its own row.
            </p>
          </HelpTip>
        </div>
        <p className="text-sm text-muted-foreground">
          One row per student. Pick the class below, or place them later.
        </p>
      </header>

      {settings && <AdmissionNumbersQuestion settings={settings} onDecided={setSettings} />}
      {settings && <AdmissionNumbersBar settings={settings} onChanged={setSettings} />}
      <BulkStudentForm admissionNumbering={settings} />
    </div>
  );
}
