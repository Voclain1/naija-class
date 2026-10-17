"use client";

// Phase 9 / CP6b.2 — the child's hostel this term (docs/modules/phase-9.md
// §15 CP6b-D8): hostel, room, bed and the house masters' names. No phone
// numbers (the school's are on every page) and no visitor log (owner, §15.8).
// The fee is on the invoice like any other line. Quiet like the other cards:
// it renders nothing when the child is not a boarder, or when the read fails.

import { useEffect, useState } from "react";

import type { PortalStudentHostelDto } from "@school-kit/types";

import { HostelExeats } from "./hostel-exeats";

export function HostelCard({ studentId }: { studentId: string }) {
  const [hostel, setHostel] = useState<PortalStudentHostelDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/portal/students/${encodeURIComponent(studentId)}/hostel`)
      .then(async (res) => {
        if (!res.ok) return null;
        // Not a boarder this term comes back as an empty body.
        const text = await res.text();
        return text ? (JSON.parse(text) as PortalStudentHostelDto | null) : null;
      })
      .then((body) => {
        if (!cancelled) setHostel(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  if (!hostel) return null;
  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight">Hostel</h2>
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hostel ({hostel.termName})</dt>
          <dd className="break-words">{hostel.hostelName}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Room and bed</dt>
          <dd className="break-words">
            {hostel.roomName}, bed {hostel.bedNumber}
          </dd>
        </div>
        {hostel.houseMasters.length > 0 && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {hostel.houseMasters.length === 1 ? "House master" : "House masters"}
            </dt>
            <dd className="break-words">{hostel.houseMasters.join(", ")}</dd>
          </div>
        )}
      </dl>
      {/* Phase 9 / CP6b.3: leave out, for a boarder only. */}
      <HostelExeats studentId={studentId} />
    </section>
  );
}
