"use client";

import { useEffect, useState } from "react";

import type { StudentHostelDto } from "@school-kit/types";

import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { getStudentHostel } from "@/lib/hostels/hostels-api";

// Phase 9 / CP6b.1 — the child's hostel bed this term, on the student page's
// Bio tab. Shown only to those who hold hostel.read.
export function StudentHostelField({ studentId }: { studentId: string }) {
  const { permissions } = useAuth();
  const allowed = hasPermission(permissions, "hostel.read");
  const [state, setState] = useState<{ loaded: boolean; value: StudentHostelDto | null }>({ loaded: false, value: null });

  useEffect(() => {
    if (!allowed) return;
    getStudentHostel(studentId)
      .then((value) => setState({ loaded: true, value }))
      .catch(() => setState({ loaded: true, value: null }));
  }, [allowed, studentId]);

  if (!allowed) return null;
  const h = state.value;
  return (
    <div className="flex flex-col gap-0.5 sm:col-span-2">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Hostel this term</dt>
      <dd>{!state.loaded ? "…" : h ? `${h.hostelName} · ${h.roomName}, bed ${h.bedNumber}` : "Not a boarder this term"}</dd>
    </div>
  );
}
