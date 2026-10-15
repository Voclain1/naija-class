"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { HealthStudentListResponse } from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { ApiError } from "@/lib/api-client";
import { listHealthStudents } from "@/lib/health/health-api";

// Phase 9 / CP3.1 — the Health page (docs/modules/phase-9.md §10). The Health
// officer's home, and a way in for owner and admin. The list carries names
// and flags only; the record itself opens on the child's own page.
export default function HealthPage() {
  const [q, setQ] = useState("");
  const [armId, setArmId] = useState("");
  const [data, setData] = useState<HealthStudentListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await listHealthStudents({ ...(q.trim() ? { q: q.trim() } : {}), ...(armId ? { armId } : {}) }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load students.");
    }
  }, [q, armId]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="flex w-full max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Health</h1>
        <p className="text-sm text-muted-foreground">
          Students&apos; health records. Find a child to see or change their record.
        </p>
      </header>

      <div className="flex flex-wrap gap-3">
        <label className="flex w-full max-w-xs flex-col gap-1 text-sm">
          <span className="font-medium">Search</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name or admission number"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          />
        </label>
        <label className="flex w-full max-w-xs flex-col gap-1 text-sm">
          <span className="font-medium">Class</span>
          <select
            value={armId}
            onChange={(e) => setArmId(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All classes</option>
            {data?.arms.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}
      {!data && !error ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
        </div>
      ) : data && data.data.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">No students found.</div>
      ) : data ? (
        <ul className="flex flex-col divide-y rounded-lg border bg-card">
          {data.data.map((s) => (
            <li key={s.studentId}>
              <Link
                href={`/health/students/${s.studentId}`}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/40"
              >
                <span className="min-w-0">
                  <span className="block break-words text-sm font-medium text-foreground">{s.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {s.admissionNumber}
                    {s.className ? ` · ${s.className}` : ""}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {!s.hasProfile ? "Nothing recorded" : s.hasTeacherNote ? "Recorded · note for teachers" : "Recorded"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {data && data.data.length === 100 && (
        <p className="text-xs text-muted-foreground">Showing the first 100. Search or pick a class to narrow it.</p>
      )}
    </div>
  );
}
