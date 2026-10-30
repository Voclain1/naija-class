"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import {
  AdmissionNumbersBar,
  AdmissionNumbersQuestion,
  useAdmissionNumbers,
} from "@/components/students/admission-numbers";
import { StudentForm } from "@/components/students/student-form";

export default function NewStudentPage() {
  // How the school gives admission numbers (docs/modules/admission-numbers.md):
  // asked once on arrival by a new school, then shown above the form.
  const { settings, setSettings } = useAdmissionNumbers();
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
          Only name, date of birth and gender are needed. The rest can come later.
        </p>
      </header>
      {settings && <AdmissionNumbersQuestion settings={settings} onDecided={setSettings} />}
      {settings && <AdmissionNumbersBar settings={settings} onChanged={setSettings} />}
      <StudentForm admissionNumbering={settings} />
    </div>
  );
}
