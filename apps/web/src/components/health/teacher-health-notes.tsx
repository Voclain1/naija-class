"use client";

import { useEffect, useState } from "react";
import type { TeacherHealthNoteDto } from "@school-kit/types";

import { getClassHealthNotes, getStudentHealthNote } from "@/lib/health/health-api";

// Phase 9 / CP3.1 — the "For teachers" health note (docs/modules/phase-9.md
// §10 CP3-D2). The ONLY health information a teacher sees: what the health
// officer chose to share. Tinted, with the words "Health note" (no accent
// borders). Renders nothing when there is no note or the read fails.

export function StudentHealthNote({ studentId }: { studentId: string }) {
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    getStudentHealthNote(studentId)
      .then((r) => setNote(r.note))
      .catch(() => setNote(null));
  }, [studentId]);
  if (!note) return null;
  return (
    <section className="rounded-lg bg-amber-500/10 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">Health note</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{note}</p>
      <p className="mt-1 text-xs text-muted-foreground">Shared with teachers by the school&apos;s health officer.</p>
    </section>
  );
}

export function ClassHealthNotes({ armId }: { armId: string }) {
  const [notes, setNotes] = useState<TeacherHealthNoteDto[]>([]);
  useEffect(() => {
    getClassHealthNotes(armId)
      .then((r) => setNotes(r.data))
      .catch(() => setNotes([]));
  }, [armId]);
  if (notes.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 rounded-lg bg-amber-500/10 p-4">
      <h2 className="text-sm font-medium text-amber-700 dark:text-amber-400">
        Health notes ({notes.length})
      </h2>
      <ul className="flex flex-col gap-2">
        {notes.map((n) => (
          <li key={n.studentId} className="text-sm">
            <span className="font-medium text-foreground">{n.name}</span>
            <span className="block whitespace-pre-wrap break-words text-foreground">{n.note}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Shared with teachers by the school&apos;s health officer.</p>
    </section>
  );
}
