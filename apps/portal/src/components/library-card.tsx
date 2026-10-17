"use client";

// Phase 9 / CP6.2 — the library books the child has out and when each is due
// (docs/modules/phase-9.md §14 CP6-D6). A late book is tinted and says
// "Overdue" in words. Fines are on the fees page as invoice lines, not here.
// Quiet like the other cards: nothing renders with no books out, or when the
// read fails.

import { useEffect, useState } from "react";

import type { FamilyLibraryDto } from "@school-kit/types";

function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00.000Z`),
  );
}

export function LibraryCard({ studentId }: { studentId: string }) {
  const [library, setLibrary] = useState<FamilyLibraryDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/portal/students/${encodeURIComponent(studentId)}/library`)
      .then((res) => (res.ok ? (res.json() as Promise<FamilyLibraryDto>) : null))
      .then((body) => {
        if (!cancelled) setLibrary(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  if (!library || library.loans.length === 0) return null;
  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight">Library books</h2>
      <ul className="flex flex-col gap-2 text-sm">
        {library.loans.map((l) => (
          <li key={l.id} className={`rounded-md px-2 py-1 ${l.overdue ? "bg-amber-500/10" : ""}`}>
            <p className="break-words font-medium">{l.title}</p>
            <p className={l.overdue ? "text-amber-900 dark:text-amber-200" : "text-muted-foreground"}>
              {l.overdue
                ? `Overdue by ${l.daysLate} ${l.daysLate === 1 ? "day" : "days"} (due ${formatDay(l.dueOn)})`
                : `Due ${formatDay(l.dueOn)}`}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
