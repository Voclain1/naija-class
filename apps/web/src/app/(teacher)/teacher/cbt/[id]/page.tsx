"use client";

import { ArrowLeft, Loader2, Printer } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { CbtCandidateRowDto, CbtSittingDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  closeCbtSitting,
  deleteCbtSitting,
  getCbtSitting,
  listCbtCandidates,
  publishCbtSitting,
  unpublishCbtSitting,
} from "@/lib/cbt/cbt-api";
import { cbtStatusLabel, describeSittingTime } from "@/lib/cbt/cbt-format";

// /teacher/cbt/[id] — one online exam (docs/modules/cbt.md). Publishing freezes
// the student list and builds the encrypted exam pack (D2, D3); the codes are
// then on the invigilator sheet.

type Busy = "publish" | "unpublish" | "close" | "delete" | null;

export default function CbtSittingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [sitting, setSitting] = useState<CbtSittingDto | null>(null);
  const [candidates, setCandidates] = useState<CbtCandidateRowDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  const load = useCallback(() => {
    Promise.all([getCbtSitting(id), listCbtCandidates(id)])
      .then(([s, c]) => {
        setSitting(s);
        setCandidates(c);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load this online exam."));
  }, [id]);
  useEffect(load, [load]);

  async function act(kind: Exclude<Busy, null>, confirmText: string, run: () => Promise<unknown>, done: string) {
    if (!window.confirm(confirmText)) return;
    setBusy(kind);
    try {
      await run();
      toast.success(done);
      if (kind === "delete") return router.push("/teacher/cbt");
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p className="mx-auto max-w-4xl rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>;
  if (!sitting) {
    return (
      <p className="mx-auto flex max-w-4xl items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }

  const started = new Date(sitting.startsAt).getTime() <= Date.now();
  const spin = (k: Busy) => (busy === k ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Link href="/teacher/cbt" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Online exams
      </Link>

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">{sitting.title}</h1>
          <Badge variant={sitting.status === "PUBLISHED" ? "success" : sitting.status === "CLOSED" ? "muted" : "outline"}>
            {cbtStatusLabel(sitting.status)}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {sitting.classLevelName} {sitting.subjectName} · {sitting.termName} · {sitting.armNames.join(", ")}
        </p>
        <p className="text-sm">{describeSittingTime(sitting)}</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="What students sit">
        <div className="rounded-lg bg-muted/30 p-4">
          <p className="text-xs text-muted-foreground">Online</p>
          <p className="font-medium">
            {sitting.objectiveQuestionCount} question{sitting.objectiveQuestionCount === 1 ? "" : "s"} · {sitting.objectiveTotal} marks
          </p>
          <p className="text-xs text-muted-foreground">Multiple choice, marked automatically</p>
        </div>
        <div className="rounded-lg bg-muted/30 p-4">
          <p className="text-xs text-muted-foreground">On paper</p>
          <p className="font-medium">
            {sitting.onPaperQuestionCount === 0
              ? "Nothing"
              : `${sitting.onPaperQuestionCount} question${sitting.onPaperQuestionCount === 1 ? "" : "s"} · ${sitting.onPaperTotal} marks`}
          </p>
          <p className="text-xs text-muted-foreground">Marked by the teacher</p>
        </div>
        <div className="rounded-lg bg-muted/30 p-4">
          <p className="text-xs text-muted-foreground">Students</p>
          <p className="font-medium">{sitting.candidateCount}</p>
          <p className="text-xs text-muted-foreground">
            {sitting.status === "DRAFT" ? "Enrolled now; fixed when you publish" : `Versions A–${"ABCD"[sitting.versionCount - 1]}`}
          </p>
        </div>
      </section>

      <section className="flex flex-wrap gap-2" aria-label="Actions">
        {sitting.status === "DRAFT" ? (
          <>
            <Button
              disabled={busy !== null || sitting.candidateCount === 0}
              onClick={() =>
                void act(
                  "publish",
                  `Publish "${sitting.title}"? The student list is fixed and the exam pack is built for the lab computers.`,
                  () => publishCbtSitting(id),
                  "Published. Print the invigilator sheet for the codes.",
                )
              }
            >
              {spin("publish")}Publish
            </Button>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => void act("delete", `Delete "${sitting.title}"?`, () => deleteCbtSitting(id), "Deleted.")}
            >
              {spin("delete")}Delete
            </Button>
          </>
        ) : null}
        {sitting.status !== "DRAFT" ? (
          <Button asChild variant="outline">
            <Link href={`/teacher/cbt/${id}/invigilator`}>
              <Printer className="mr-1 h-4 w-4" />
              Invigilator sheet
            </Link>
          </Button>
        ) : null}
        {sitting.status === "PUBLISHED" && !started ? (
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              void act(
                "unpublish",
                "Take this exam back to draft? Lab computers that already downloaded it will need to download it again.",
                () => unpublishCbtSitting(id),
                "Back to draft.",
              )
            }
          >
            {spin("unpublish")}Back to draft
          </Button>
        ) : null}
        {sitting.status === "PUBLISHED" ? (
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              void act("close", "Close this exam? No more answers will be accepted.", () => closeCbtSitting(id), "Closed.")
            }
          >
            {spin("close")}Close exam
          </Button>
        ) : null}
      </section>
      {sitting.status === "DRAFT" && sitting.candidateCount === 0 ? (
        <p className="rounded-md bg-amber-500/10 p-3 text-sm">
          No students are enrolled in the chosen classes this term, so there is nobody to sit it yet.
        </p>
      ) : null}

      <section className="flex flex-col gap-3" aria-labelledby="candidates-heading">
        <h2 id="candidates-heading" className="font-serif text-lg font-medium">
          Students
        </h2>
        {candidates === null ? null : candidates.length === 0 ? (
          <p className="rounded-md bg-muted/30 p-4 text-sm text-muted-foreground">No students.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2 font-medium">Admission no.</th>
                  <th className="p-2 font-medium">Name</th>
                  <th className="p-2 font-medium">Class</th>
                  <th className="p-2 font-medium">Version</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {candidates.map((c) => (
                  <tr key={c.studentId}>
                    <td className="p-2 font-mono text-xs">{c.admissionNumber}</td>
                    <td className="p-2">
                      {c.lastName}, {c.firstName}
                    </td>
                    <td className="p-2">{c.armName}</td>
                    <td className="p-2">{c.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
