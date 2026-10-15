"use client";

// Phase 9 / CP3.1 — the child's health record, as the school keeps it
// (docs/modules/phase-9.md §10 CP3-D3). Read-only: a correction is "contact
// the school". Includes the note the school shares with teachers, so a family
// sees exactly what teachers were told.
//
// Self-contained and quiet, like the notices card: it fetches on its own and
// renders nothing when the read fails, so it can never take the page down.

import { useEffect, useState } from "react";

import type { HealthDocumentUrlDto, PortalHealthProfileDto } from "@school-kit/types";

type TextKey = Exclude<keyof PortalHealthProfileDto, "vaccinations" | "updatedAt">;

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Phase 9 / CP3.2 — a vaccination's document is private: the portal asks for
// a five-minute link. The tab opens first so a popup blocker allows it.
async function openDocument(studentId: string, vaccinationId: string): Promise<void> {
  const tab = window.open("", "_blank");
  const res = await fetch(
    `/api/portal/students/${encodeURIComponent(studentId)}/vaccinations/${encodeURIComponent(vaccinationId)}/document`,
  );
  if (!res.ok) {
    tab?.close();
    return;
  }
  const { url } = (await res.json()) as HealthDocumentUrlDto;
  if (tab) tab.location.href = url;
  else window.location.href = url;
}

const ROWS: { key: TextKey; label: string }[] = [
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
  const empty = recorded.length === 0 && profile.vaccinations.length === 0;

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight">Health record</h2>
      {empty ? (
        <p className="text-sm text-muted-foreground">The school has not recorded anything yet.</p>
      ) : recorded.length === 0 ? null : (
        <dl className="flex flex-col gap-3">
          {recorded.map((r) => (
            <div key={r.key}>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{r.label}</dt>
              <dd className="whitespace-pre-wrap break-words text-sm">{String(profile[r.key])}</dd>
            </div>
          ))}
        </dl>
      )}
      {profile.vaccinations.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Vaccinations</h3>
          <ul className="flex flex-col gap-2">
            {profile.vaccinations.map((v) => (
              <li key={v.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 break-words">
                  {v.name} <span className="text-muted-foreground">· {formatDay(v.givenOn)}</span>
                </span>
                {v.documentType && (
                  <button
                    type="button"
                    onClick={() => void openDocument(studentId, v.id)}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    View {v.documentType === "pdf" ? "PDF" : "photo"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        Something wrong or missing? Please contact the school.
      </p>
    </section>
  );
}
