"use client";

import { ArrowLeft, Loader2, Printer } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import type { CbtCandidateRowDto, CbtInvigilatorSheetDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { CBT_DELIVERY_BASE_URL, getInvigilatorSheet, listCbtCandidates } from "@/lib/cbt/cbt-api";
import { describeSittingTime } from "@/lib/cbt/cbt-format";

// /teacher/cbt/[id]/invigilator — the sheet the invigilator carries into the
// lab (docs/modules/cbt.md D3): where to open the exam, the access code to
// download it, the unlock code to start it, and the register. Opening this
// page reveals the codes, and the server audits every opening. Prints with the
// app chrome hidden (globals.css @media print).

export default function InvigilatorSheetPage() {
  const { id } = useParams<{ id: string }>();
  const [sheet, setSheet] = useState<CbtInvigilatorSheetDto | null>(null);
  const [candidates, setCandidates] = useState<CbtCandidateRowDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getInvigilatorSheet(id), listCbtCandidates(id)])
      .then(([s, c]) => {
        setSheet(s);
        setCandidates(c);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the invigilator sheet."));
  }, [id]);

  if (error) return <p className="mx-auto max-w-3xl rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>;
  if (!sheet || !candidates) {
    return (
      <p className="mx-auto flex max-w-3xl items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }

  const examUrl = `${CBT_DELIVERY_BASE_URL.replace(/\/$/, "")}/${sheet.schoolSlug}`;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/teacher/cbt/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <Button onClick={() => window.print()}>
          <Printer className="mr-1 h-4 w-4" /> Print
        </Button>
      </div>

      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">{sheet.schoolName} — invigilator sheet</p>
        <h1 className="font-serif text-2xl font-medium">{sheet.title}</h1>
        <p className="text-sm">
          {sheet.classLevelName} {sheet.subjectName} · {sheet.armNames.join(", ")}
        </p>
        <p className="text-sm">{describeSittingTime(sheet)}</p>
      </header>

      <p className="rounded-md bg-amber-500/10 p-3 text-sm">
        <strong>Keep this sheet private.</strong> The unlock code opens the exam questions. Do not write it on the board or leave
        this sheet where students can see it.
      </p>

      <section className="grid gap-3 sm:grid-cols-2" aria-label="Codes">
        <div className="rounded-lg bg-muted/30 p-4">
          <p className="text-xs text-muted-foreground">Access code — to download the exam onto each computer</p>
          <p className="font-mono text-3xl tracking-widest" aria-label="Access code">
            {sheet.accessCode}
          </p>
        </div>
        <div className="rounded-lg bg-muted/30 p-4">
          <p className="text-xs text-muted-foreground">Unlock code — type it on each computer at the start</p>
          <p className="font-mono text-3xl tracking-widest" aria-label="Unlock code">
            {sheet.unlockCode}
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-2 text-sm" aria-labelledby="steps-heading">
        <h2 id="steps-heading" className="font-medium">
          On the day
        </h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            <strong>Before the exam</strong>, while the internet is on: on each computer open{" "}
            <span className="font-mono">{examUrl}</span>, type the access code and download the exam. It is locked; nobody can
            read it yet.
          </li>
          <li>
            <strong>At the start</strong>, type the unlock code on each computer. The exam works without internet from here on.
          </li>
          <li>
            Each student types their admission number and checks their name. Their own clock starts when they begin, and they
            have {sheet.durationMinutes} minutes. No one may begin after the latest start time.
          </li>
          <li>
            If a computer switches off, turn it back on and open the same address: the answers are saved on it. Type the unlock
            code again to carry on.
          </li>
          <li>Answers are sent automatically whenever the internet is on. Leave each computer on until it says it has sent.</li>
        </ol>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="register-heading">
        <h2 id="register-heading" className="font-medium">
          Register ({sheet.candidateCount})
        </h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="p-1.5 font-medium">Admission no.</th>
              <th className="p-1.5 font-medium">Name</th>
              <th className="p-1.5 font-medium">Class</th>
              <th className="p-1.5 font-medium">Version</th>
              <th className="p-1.5 font-medium">Computer / signature</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.studentId} className="border-b">
                <td className="p-1.5 font-mono text-xs">{c.admissionNumber}</td>
                <td className="p-1.5">
                  {c.lastName}, {c.firstName}
                </td>
                <td className="p-1.5">{c.armName}</td>
                <td className="p-1.5">{c.version}</td>
                <td className="p-1.5" />
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
