"use client";

// Phase 9 / CP4.1 — the child's homework on the parent website
// (docs/modules/phase-9.md §11). The parent website had no homework view
// before this; the parent app has had one since the-school-day.md Part B.
//
// What is due, whether work the teacher is collecting was handed in, and the
// mark and feedback once the teacher released them. No answer text: the API's
// family shape has no field for it, nor for how the answer was typed.
//
// Self-contained and quiet, like the other cards: it fetches on its own and
// renders nothing when the read fails, so it can never take the page down.

import { useEffect, useState } from "react";

import {
  describeSubmissionFile,
  describeWorkStatus,
  type AssignmentFileUrlDto,
  type FamilyAssignmentDto,
  type FamilyAssignmentListResponse,
  type HomeworkFeedItemDto,
  type HomeworkFeedResponse,
} from "@school-kit/types";

function formatDue(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

// CP4.2 — a file the child handed in is private: the portal asks for a
// five-minute link. The tab opens first so a popup blocker allows it.
async function openFile(studentId: string, fileId: string): Promise<void> {
  const tab = window.open("", "_blank");
  const res = await fetch(
    `/api/portal/students/${encodeURIComponent(studentId)}/assignment-files/${encodeURIComponent(fileId)}`,
  );
  if (!res.ok) {
    tab?.close();
    return;
  }
  const { url } = (await res.json()) as AssignmentFileUrlDto;
  if (tab) tab.location.href = url;
  else window.location.href = url;
}

function WorkLine({ w, studentId }: { w: FamilyAssignmentDto; studentId: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-primary/5 p-2 text-sm">
      <p className="font-medium">
        {describeWorkStatus(w.status)}
        {w.late && w.status !== "NOT_SUBMITTED" ? " · late" : ""}
        {w.mark !== null ? ` · ${w.mark}/${w.totalMarks}` : ""}
      </p>
      {w.feedback && <p className="whitespace-pre-wrap break-words text-muted-foreground">{w.feedback}</p>}
      {w.status === "RETURNED" && w.returnNote && (
        <p className="break-words text-muted-foreground">Teacher: {w.returnNote}</p>
      )}
      {w.files.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {w.files.map((f, i) => (
            <button
              key={f.id}
              type="button"
              onClick={() => void openFile(studentId, f.id)}
              className="text-sm font-medium text-primary hover:underline"
            >
              View {describeSubmissionFile(w.files, i)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function HomeworkCard({ studentId }: { studentId: string }) {
  const [homework, setHomework] = useState<HomeworkFeedItemDto[] | null>(null);
  const [work, setWork] = useState<FamilyAssignmentDto[]>([]);

  useEffect(() => {
    let cancelled = false;
    const id = encodeURIComponent(studentId);
    fetch(`/api/portal/students/${id}/homework`)
      .then(async (res) => (res.ok ? ((await res.json()) as HomeworkFeedResponse) : null))
      .then((body) => {
        if (!cancelled && body) setHomework(body.data);
      })
      .catch(() => undefined);
    fetch(`/api/portal/students/${id}/assignments`)
      .then(async (res) => (res.ok ? ((await res.json()) as FamilyAssignmentListResponse) : null))
      .then((body) => {
        if (!cancelled && body) setWork(body.data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  if (!homework) return null;
  const workById = new Map(work.map((w) => [w.assignmentId, w]));
  const shown = new Set(homework.map((h) => h.id));
  const earlier = work.filter((w) => !shown.has(w.assignmentId));

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight">Homework</h2>
      {homework.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing is due.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {homework.map((h) => {
            const w = workById.get(h.id);
            const handedIn = w !== undefined && w.status !== "NOT_SUBMITTED" && w.status !== "RETURNED";
            return (
              <li key={h.id} className="flex flex-col gap-1">
                <p className="break-words text-sm font-medium">{h.title}</p>
                <p className="text-xs text-muted-foreground">
                  {h.subjectName} · due {formatDue(h.dueDate)}
                  {h.overdue && !handedIn ? <span className="font-medium text-amber-800 dark:text-amber-200"> · overdue</span> : null}
                </p>
                {h.instructions && <p className="whitespace-pre-wrap break-words text-sm">{h.instructions}</p>}
                {w && <WorkLine w={w} studentId={studentId} />}
              </li>
            );
          })}
        </ul>
      )}
      {earlier.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Earlier work</h3>
          <ul className="flex flex-col gap-3">
            {earlier.map((w) => (
              <li key={w.assignmentId} className="flex flex-col gap-1">
                <p className="break-words text-sm font-medium">{w.title}</p>
                <p className="text-xs text-muted-foreground">
                  {w.subjectName} · due {formatDue(w.dueDate)}
                </p>
                <WorkLine w={w} studentId={studentId} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Your child hands in work from their own SchoolKit app.</p>
    </section>
  );
}
