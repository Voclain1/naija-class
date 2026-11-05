"use client";

import { EyeOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { SubjectDto, SubjectHideDto } from "@school-kit/types";

import { HideSubjectDialog } from "@/components/subjects/hide-subject-dialog";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { listSubjectHides, unhideSubject } from "@/lib/subject-hides/subject-hides-api";
import { listSubjects } from "@/lib/subjects/subjects-api";

// Hidden subjects for one class arm, on its report-card board (2026-11-02,
// docs/modules/subjects-by-class.md). The form teacher (or an admin) hides a
// subject for this arm here; wider hides are set in Settings → Academic →
// Subjects by class and show here read-only, so a missing subject is explained.

interface Props {
  armId: string;
  armName: string;
  classLevelId: string | null;
  termId: string;
  termName: string;
}

export function ArmHiddenSubjects({ armId, armName, classLevelId, termId, termName }: Props) {
  const [hides, setHides] = useState<SubjectHideDto[] | null>(null);
  const [subjects, setSubjects] = useState<SubjectDto[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await listSubjectHides({ current: true, classArmId: armId });
      // The list carries every level and school hide; keep the ones on this arm's class.
      setHides(rows.filter((h) => h.scope !== "LEVEL" || h.classLevelId === classLevelId));
    } catch {
      setHides([]);
    }
  }, [armId, classLevelId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDialog() {
    if (subjects.length === 0) {
      try {
        setSubjects(await listSubjects());
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Could not load subjects.");
        return;
      }
    }
    setOpen(true);
  }

  async function unhide(h: SubjectHideDto) {
    setBusy(h.id);
    try {
      await unhideSubject(h.id);
      toast.success(`${h.subjectName} is showing again.`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not unhide the subject.");
    } finally {
      setBusy(null);
    }
  }

  if (hides === null) return null;

  return (
    <section aria-label="Hidden subjects" className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          Hidden subjects{hides.length > 0 ? ` (${hides.length})` : ""}
        </p>
        <Button type="button" size="sm" variant="outline" onClick={() => void openDialog()}>
          <EyeOff className="h-4 w-4" />
          Hide a subject
        </Button>
      </div>
      {hides.length === 0 ? (
        <p className="text-muted-foreground">
          None. Hide a subject to keep it off these report cards without deleting its scores.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {hides.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">{h.subjectName}</span>{" "}
                <span className="text-muted-foreground">
                  · {h.scope === "SCHOOL" ? "whole school" : h.scope === "LEVEL" ? "every arm of this class" : "this arm"} ·{" "}
                  {h.until === "TERM" ? "this term" : h.until === "YEAR" ? "this session" : "until unhidden"}
                </span>
              </span>
              {h.canUnhide && (
                <Button type="button" size="sm" variant="ghost" disabled={busy === h.id} onClick={() => void unhide(h)}>
                  Unhide
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        The subject leaves the cards at once. Totals and positions change when an admin presses Rebuild draft report cards (while the cards are in draft).
      </p>

      <HideSubjectDialog
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => void load()}
        subjects={subjects}
        levels={[]}
        arms={[{ id: armId, name: armName, classLevelId: classLevelId ?? "" }]}
        terms={[{ id: termId, name: termName, isCurrent: true }]}
        defaultTermId={termId}
        defaultArmId={armId}
        scopes={["ARM"]}
      />
    </section>
  );
}
