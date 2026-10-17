"use client";

// Phase 9 / CP5.3 — the child's school bus this term (docs/modules/phase-9.md
// §13 CP5-D10): route, stop, pickup time, the driver and the bus. The fee is
// on the invoice like any other line, not here. Quiet like the other cards: it
// renders nothing when the child has no place, or when the read fails.

import { useEffect, useState } from "react";

import { formatMinuteOfDay, type PortalStudentTransportDto } from "@school-kit/types";

export function TransportCard({ studentId }: { studentId: string }) {
  const [transport, setTransport] = useState<PortalStudentTransportDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/portal/students/${encodeURIComponent(studentId)}/transport`)
      .then(async (res) => {
        if (!res.ok) return null;
        // No place this term comes back as an empty body.
        const text = await res.text();
        return text ? (JSON.parse(text) as PortalStudentTransportDto | null) : null;
      })
      .then((body) => {
        if (!cancelled) setTransport(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  if (!transport) return null;
  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight">School bus</h2>
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Route ({transport.termName})</dt>
          <dd className="break-words">{transport.routeName}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Stop</dt>
          <dd className="break-words">
            {transport.stopName}
            {transport.pickupMinute !== null && ` · pickup ${formatMinuteOfDay(transport.pickupMinute)}`}
          </dd>
        </div>
        {transport.driverName && (
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Driver</dt>
            <dd className="break-words">
              {transport.driverName}
              {transport.driverPhone && (
                <>
                  {" · "}
                  <a href={`tel:${transport.driverPhone}`} className="text-primary hover:underline">
                    {transport.driverPhone}
                  </a>
                </>
              )}
            </dd>
          </div>
        )}
        {transport.vehiclePlate && (
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Bus</dt>
            <dd>{transport.vehiclePlate}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
