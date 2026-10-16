"use client";

import { useEffect, useState } from "react";

import { formatMinuteOfDay, type StudentTransportDto } from "@school-kit/types";

import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { getStudentTransport } from "@/lib/transport/transport-api";

// Phase 9 / CP5.2 — the child's route and stop this term, on the student
// page's Bio tab. Shown only to those who hold transport.read.
export function StudentTransportField({ studentId }: { studentId: string }) {
  const { permissions } = useAuth();
  const allowed = hasPermission(permissions, "transport.read");
  const [state, setState] = useState<{ loaded: boolean; value: StudentTransportDto | null }>({ loaded: false, value: null });

  useEffect(() => {
    if (!allowed) return;
    getStudentTransport(studentId)
      .then((value) => setState({ loaded: true, value }))
      .catch(() => setState({ loaded: true, value: null }));
  }, [allowed, studentId]);

  if (!allowed) return null;
  const t = state.value;
  return (
    <div className="flex flex-col gap-0.5 sm:col-span-2">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Transport this term</dt>
      <dd>
        {!state.loaded
          ? "…"
          : t
            ? `${t.routeName} · ${t.stopName}${t.pickupMinute !== null ? ` · pickup ${formatMinuteOfDay(t.pickupMinute)}` : ""}`
            : "Not on a school bus route"}
      </dd>
    </div>
  );
}
