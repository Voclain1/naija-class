"use client";

import { useCallback, useEffect, useState } from "react";
import type { SickbayVisitDto } from "@school-kit/types";

import { SickbayVisitForm, SickbayVisitItem } from "@/components/health/sickbay";
import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { listSickbayVisits } from "@/lib/health/sickbay-api";

// Phase 9 / CP3.3 — one child's sickbay visits, under their health record.
// Shown only to someone holding sickbay.manage; the API checks it as well.
export function StudentSickbaySection({ studentId, studentName }: { studentId: string; studentName: string }) {
  const [visits, setVisits] = useState<SickbayVisitDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setVisits((await listSickbayVisits({ studentId })).data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the sickbay visits.");
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-base font-medium">Sickbay visits</h3>
      {error && <InlineAlert>{error}</InlineAlert>}
      {visits && visits.length === 0 && <p className="text-sm text-muted-foreground">No visits.</p>}
      {visits && visits.length > 0 && (
        <ul className="flex flex-col gap-2">
          {visits.map((v) => (
            <SickbayVisitItem
              key={v.id}
              visit={v}
              showStudent={false}
              onChanged={(next) => setVisits((list) => list?.map((x) => (x.id === next.id ? next : x)) ?? null)}
            />
          ))}
        </ul>
      )}
      {recording ? (
        <SickbayVisitForm
          studentId={studentId}
          studentName={studentName}
          onCancel={() => setRecording(false)}
          onSaved={(v) => {
            setRecording(false);
            setVisits((list) => [v, ...(list ?? [])].sort((a, b) => +new Date(b.visitedAt) - +new Date(a.visitedAt)));
          }}
        />
      ) : (
        <div>
          <Button variant="outline" onClick={() => setRecording(true)}>
            Record a sickbay visit
          </Button>
        </div>
      )}
    </section>
  );
}
