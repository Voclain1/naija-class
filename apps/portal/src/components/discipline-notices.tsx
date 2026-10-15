"use client";

// Phase 9 / CP2.3 — "Notices from the school" (docs/modules/phase-9.md §9
// CP2-D4). Approved suspensions and exclusions only: the action, its dates
// and the day it was decided. The API's response type has no field for a
// reason, a note, an incident or who proposed it, so this card cannot show
// one.
//
// Self-contained and quiet: it fetches on its own and renders NOTHING when
// there are no notices or the fetch fails, so it can never take the child's
// page down.

import { useEffect, useState } from "react";

import {
  describeDisciplineNotice,
  formatDisciplineDate,
  type PortalDisciplineNoticeDto,
  type PortalDisciplineNoticeListResponse,
} from "@school-kit/types";

export function DisciplineNotices({ studentId }: { studentId: string }) {
  const [notices, setNotices] = useState<PortalDisciplineNoticeDto[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/portal/students/${encodeURIComponent(studentId)}/discipline-notices`)
      .then(async (res) => (res.ok ? ((await res.json()) as PortalDisciplineNoticeListResponse) : { data: [] }))
      .then((body) => {
        if (!cancelled) setNotices(body.data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  if (notices.length === 0) return null;

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-amber-500/5 p-4 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight">Notices from the school</h2>
      <ul className="flex flex-col gap-3">
        {notices.map((n) => (
          <li key={n.id} className="flex flex-col gap-0.5">
            <p className={["text-sm font-medium", n.withdrawnOn ? "line-through text-muted-foreground" : ""].join(" ")}>
              {describeDisciplineNotice(n)}
            </p>
            <p className="text-xs text-muted-foreground">
              Decided on {formatDisciplineDate(n.decidedOn)}
              {n.withdrawnOn ? ` · Withdrawn on ${formatDisciplineDate(n.withdrawnOn)}` : ""}
            </p>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">Please contact the school.</p>
    </section>
  );
}
