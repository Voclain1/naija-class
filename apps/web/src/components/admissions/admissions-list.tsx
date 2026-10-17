"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  ADMISSION_STATUS_LABEL,
  admissionStatusValues,
  formatSickbayDay,
  type AdmissionListDto,
  type AdmissionStatus,
} from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import { listAdmissions } from "@/lib/admissions/admissions-api";
import { ApiError } from "@/lib/api-client";

// Phase 9 / CP7.1 — the school's applicants (docs/modules/phase-9.md §16.8),
// listed apart from students until the school admits them. One tab per
// status, with its count; "New" first, oldest first, so nothing waits long.

const GENDER = { MALE: "Boy", FEMALE: "Girl", OTHER: "Other" } as const;

export function AdmissionsList({ basePath }: { basePath: string }) {
  const [status, setStatus] = useState<AdmissionStatus>("SUBMITTED");
  const [data, setData] = useState<AdmissionListDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    listAdmissions(status)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load the applications."));
  }, [status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Applications by status">
        {admissionStatusValues.map((s) => (
          <Button key={s} size="sm" variant={status === s ? "default" : "outline"} aria-pressed={status === s} onClick={() => setStatus(s)}>
            {ADMISSION_STATUS_LABEL[s]}
            {data ? ` (${data.counts[s]})` : ""}
          </Button>
        ))}
      </div>
      {error && <InlineAlert>{error}</InlineAlert>}
      {!data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No applications here.</p>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {data.items.map((a) => (
            <li key={a.id}>
              <Link href={`${basePath}/${a.id}`} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm hover:bg-muted/40">
                <div className="min-w-0">
                  <p className="break-words font-medium">{a.childName}</p>
                  <p className="text-muted-foreground">
                    {a.classLevel} · {GENDER[a.gender]} · born {formatSickbayDay(`${a.dateOfBirth}T12:00:00Z`)}
                  </p>
                  <p className="break-words text-muted-foreground">
                    {a.guardianName} · {a.guardianPhone}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>{a.reference}</p>
                  <p>{formatSickbayDay(a.submittedAt)}</p>
                  <p>{a.documents === 1 ? "1 document" : `${a.documents} documents`}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
