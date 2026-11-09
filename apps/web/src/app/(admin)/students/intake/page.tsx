"use client";

import { ArrowLeft, Camera, FileSpreadsheet, ListChecks, Rows3, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AdmissionNumbersBar, AdmissionNumbersQuestion, useAdmissionNumbers } from "@/components/students/admission-numbers";
import { BulkStudentForm } from "@/components/students/bulk-student-form";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/use-auth";
import { hasPermission } from "@/lib/auth/has-permission";

export default function StudentIntakePage() {
  const { status, permissions, school, user } = useAuth();
  if (status === "loading") return <p role="status">Loading student intake…</p>;
  if (status !== "authed" || !hasPermission(permissions, "student.create")) return <div className="rounded-xl bg-muted p-6"><h1 className="text-xl font-semibold">Student intake is not available for this account</h1><p className="mt-2 text-sm">Ask your school administrator to add or enrol students.</p></div>;
  return <IntakeWorkspace key={`${school?.id}:${user?.id}`} mayImport={hasPermission(permissions, "student.import")} />;
}

function IntakeWorkspace({ mayImport }: { mayImport: boolean }) {
  const [gridOpen, setGridOpen] = useState(false);
  const { settings, setSettings } = useAdmissionNumbers();
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
    <Link href="/students" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Back to roster</Link>
    <header className="space-y-2"><div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"><ListChecks className="h-4 w-4" />Student intake</div>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Add students. Get their class right.</h1>
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">Start with the list you already have. Check the students and placement before saving. Parent links and invitations come afterwards.</p>
    </header>
    <ol className="grid gap-2 text-sm sm:grid-cols-3" aria-label="Student intake steps">{["Choose how to enter the students", "Choose the class and term", "Review, confirm and save"].map((step, i) => <li key={step} className="flex items-center gap-3 rounded-lg bg-muted/50 p-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-card font-semibold">{i + 1}</span>{step}</li>)}</ol>
    {!gridOpen ? <section aria-label="Choose an intake method" className="grid gap-4 sm:grid-cols-2">
      <article className="flex flex-col rounded-xl border bg-card p-5 shadow-sm"><Rows3 className="h-6 w-6 text-primary" /><h2 className="mt-3 text-lg font-semibold">Paste a class list</h2><p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">Type rows or paste from Excel. Review everyone together, then add them to one chosen class and term.</p><Button className="mt-5 w-fit" onClick={() => setGridOpen(true)}>Start guided class list</Button></article>
      <article className="flex flex-col rounded-xl border bg-card p-5 shadow-sm"><UserPlus className="h-6 w-6 text-primary" /><h2 className="mt-3 text-lg font-semibold">One new student</h2><p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">Use the short form for a new arrival. Add their class while creating the record.</p><Button asChild variant="outline" className="mt-5 w-fit"><Link href="/students/new">Open single-student form</Link></Button></article>
      {mayImport && <>
        <article className="flex flex-col rounded-xl border bg-card p-5 shadow-sm"><FileSpreadsheet className="h-6 w-6 text-primary" /><h2 className="mt-3 text-lg font-semibold">Spreadsheet file</h2><p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">Upload your CSV, map its columns and review the import. Include class names and choose the target term to enrol on import.</p><Button asChild variant="outline" className="mt-5 w-fit"><Link href="/students/import">Open CSV import</Link></Button></article>
        <article className="flex flex-col rounded-xl border bg-card p-5 shadow-sm"><Camera className="h-6 w-6 text-primary" /><h2 className="mt-3 text-lg font-semibold">Paper register <span className="text-xs font-medium text-muted-foreground">Beta</span></h2><p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">Where enabled, SchoolKit reads a register photo with AI. Check every extracted row before saving. The scan screen checks availability and consent first.</p><Button asChild variant="outline" className="mt-5 w-fit"><Link href="/students/scan">Check register scan availability</Link></Button></article>
      </>}
    </section> : <section aria-label="Guided class-list intake" className="ph-no-capture space-y-4" data-sentry-mask>
      <div><h2 className="text-lg font-semibold">Your class list</h2><p className="mt-1 text-sm text-muted-foreground">One row per student. Choose a class and term explicitly, or defer placement. Unsaved rows are kept only while this page is open.</p></div>
      {settings && <AdmissionNumbersQuestion settings={settings} onDecided={setSettings} />}
      {settings && <AdmissionNumbersBar settings={settings} onChanged={setSettings} />}
      <BulkStudentForm admissionNumbering={settings} guidedReview />
    </section>}
    <aside className="rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground"><strong className="text-foreground">Already on the roster?</strong> Open the student’s existing record and use its Enrollments tab. This intake creates new records; it does not merge or move existing students.</aside>
  </div>;
}
