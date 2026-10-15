"use client";

// Phase 9 / CP3.1 — the child's health record, as the school keeps it
// (docs/modules/phase-9.md §10 CP3-D3). Read-only: a correction is "contact
// the school". Includes the note the school shares with teachers, so a family
// sees exactly what teachers were told.
//
// Self-contained and quiet, like the notices card: it fetches on its own and
// renders nothing when the read fails, so it can never take the page down.

import { useEffect, useState } from "react";

import type { PortalHealthProfileDto } from "@school-kit/types";

const ROWS: { key: keyof PortalHealthProfileDto; label: string }[] = [
  { key: "allergies", label: "Allergies" },
  { key: "conditions", label: "Conditions" },
  { key: "medication", label: "Medication" },
  { key: "gpClinic", label: "GP or clinic" },
  { key: "emergencyNotes", label: "Emergency notes" },
  { key: "bloodGroup", label: "Blood group" },
  { key: "teacherNote", label: "Shared with teachers" },
];

export function HealthRecord({ studentId }: { studentId: string }) {
  const [profile, setProfile] = useState<PortalHealthProfileDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/portal/students/${encodeURIComponent(studentId)}/health`)
      .then(async (res) => (res.ok ? ((await res.json()) as PortalHealthProfileDto) : null))
      .then((body) => {
        if (!cancelled) setProfile(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  if (!profile) return null;
  const recorded = ROWS.filter((r) => profile[r.key]);

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight">Health record</h2>
      {recorded.length === 0 ? (
        <p className="text-sm text-muted-foreground">The school has not recorded anything yet.</p>
      ) : (
        <dl className="flex flex-col gap-3">
          {recorded.map((r) => (
            <div key={r.key}>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{r.label}</dt>
              <dd className="whitespace-pre-wrap break-words text-sm">{String(profile[r.key])}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-sm text-muted-foreground">
        Something wrong or missing? Please contact the school.
      </p>
    </section>
  );
}
