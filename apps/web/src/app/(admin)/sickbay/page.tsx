"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { sickbayDayOf, type HealthStudentRowDto, type SickbayVisitDto } from "@school-kit/types";

import { SickbayVisitForm, SickbayVisitItem } from "@/components/health/sickbay";
import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { listHealthStudents } from "@/lib/health/health-api";
import { listSickbayVisits } from "@/lib/health/sickbay-api";

// Phase 9 / CP3.3 — the Sickbay page (docs/modules/phase-9.md §10 CP3-D5). One
// day's visits, newest first, and "Record a visit": find the child, then fill
// in the visit. Owner, admin and the Health officer (sickbay.manage).
export default function SickbayPage() {
  const today = sickbayDayOf(new Date());
  const [day, setDay] = useState(today);
  const [visits, setVisits] = useState<SickbayVisitDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<HealthStudentRowDto[]>([]);
  const [child, setChild] = useState<HealthStudentRowDto | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setVisits(null);
    try {
      setVisits((await listSickbayVisits({ date: day })).data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the sickbay log.");
    }
  }, [day]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!recording || child || q.trim().length < 2) {
      setMatches([]);
      return;
    }
    const t = setTimeout(() => {
      listHealthStudents({ q: q.trim() })
        .then((r) => setMatches(r.data.slice(0, 8)))
        .catch(() => setMatches([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, recording, child]);

  function closeForm() {
    setRecording(false);
    setChild(null);
    setQ("");
  }

  const replace = (v: SickbayVisitDto) => setVisits((list) => list?.map((x) => (x.id === v.id ? v : x)) ?? null);

  return (
    <div className="flex w-full max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Sickbay</h1>
        <p className="text-sm text-muted-foreground">
          The sickbay log. Teachers never see it. Parents see the time of a visit, and the details only when you share them.
        </p>
      </header>

      {recording ? (
        child ? (
          <SickbayVisitForm
            studentId={child.studentId}
            studentName={child.name}
            onCancel={closeForm}
            onSaved={(v) => {
              closeForm();
              if (sickbayDayOf(v.visitedAt) === day) setVisits((list) => [v, ...(list ?? [])]);
              else setDay(sickbayDayOf(v.visitedAt));
            }}
          />
        ) : (
          <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
            <label className="flex w-full max-w-sm flex-col gap-1 text-sm">
              <span className="font-medium">Find the child</span>
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Name or admission number"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
            {matches.length > 0 && (
              <ul className="flex flex-col divide-y rounded-md border">
                {matches.map((s) => (
                  <li key={s.studentId}>
                    <button
                      type="button"
                      onClick={() => setChild(s)}
                      className="flex w-full flex-wrap justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <span className="font-medium">{s.name}</span>
                      <span className="text-muted-foreground">
                        {s.admissionNumber}
                        {s.className ? ` · ${s.className}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <Button variant="outline" onClick={closeForm}>
                Cancel
              </Button>
            </div>
          </div>
        )
      ) : (
        <div>
          <Button onClick={() => setRecording(true)}>Record a visit</Button>
        </div>
      )}

      <label className="flex w-44 flex-col gap-1 text-sm">
        <span className="font-medium">Day</span>
        <input
          type="date"
          value={day}
          max={today}
          onChange={(e) => e.target.value && setDay(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        />
      </label>

      {error && <InlineAlert>{error}</InlineAlert>}
      {!visits && !error ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
        </div>
      ) : visits && visits.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">No visits on this day.</div>
      ) : visits ? (
        <ul className="flex flex-col gap-2">
          {visits.map((v) => (
            <SickbayVisitItem key={v.id} visit={v} showStudent onChanged={replace} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
