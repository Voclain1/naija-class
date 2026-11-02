"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  SUBJECT_HIDE_SCOPE_LABELS,
  SUBJECT_HIDE_UNTIL,
  SUBJECT_HIDE_UNTIL_LABELS,
  type ClassArmDto,
  type ClassLevelDto,
  type SubjectDto,
  type SubjectHideDto,
  type SubjectHideScope,
  type SubjectHideUntil,
  type TermDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { createSubjectHide } from "@/lib/subject-hides/subject-hides-api";

// Hide a subject from results (2026-11-02, docs/modules/subjects-by-class.md).
// The person chooses how wide (an arm, a whole class, the whole school) and
// how long (this term, this session, until unhidden). A form teacher gets
// only their own arm(s): `scopes` is ["ARM"] and `arms` is just theirs.

const SELECT = "h-9 w-full rounded-md border bg-background px-2 text-sm";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (hide: SubjectHideDto) => void;
  subjects: SubjectDto[];
  levels: Pick<ClassLevelDto, "id" | "name">[];
  arms: Pick<ClassArmDto, "id" | "name" | "classLevelId">[];
  terms: Pick<TermDto, "id" | "name" | "isCurrent">[];
  defaultTermId: string | null;
  scopes: readonly SubjectHideScope[];
  defaultSubjectId?: string;
  defaultArmId?: string;
}

export function HideSubjectDialog(props: Props) {
  const { open, onClose, onSaved, subjects, levels, arms, terms, defaultTermId, scopes } = props;
  const [subjectId, setSubjectId] = useState("");
  const [scope, setScope] = useState<SubjectHideScope>(scopes[0] ?? "ARM");
  const [armId, setArmId] = useState("");
  const [levelId, setLevelId] = useState("");
  const [until, setUntil] = useState<SubjectHideUntil>("TERM");
  const [termId, setTermId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubjectId(props.defaultSubjectId ?? "");
    setScope(scopes[0] ?? "ARM");
    setArmId(props.defaultArmId ?? (arms.length === 1 ? arms[0]!.id : ""));
    setLevelId("");
    setUntil("TERM");
    setTermId(defaultTermId ?? terms[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const levelName = useMemo(() => new Map(levels.map((l) => [l.id, l.name])), [levels]);
  const sortedArms = useMemo(
    () =>
      [...arms].sort((a, b) =>
        `${levelName.get(a.classLevelId) ?? ""} ${a.name}`.localeCompare(`${levelName.get(b.classLevelId) ?? ""} ${b.name}`),
      ),
    [arms, levelName],
  );
  const sortedSubjects = useMemo(() => [...subjects].sort((a, b) => a.name.localeCompare(b.name)), [subjects]);

  const ready =
    !!subjectId && !!termId && (scope !== "ARM" || !!armId) && (scope !== "LEVEL" || !!levelId);

  async function save() {
    if (!ready) return;
    setSaving(true);
    try {
      const hide = await createSubjectHide({
        subjectId,
        termId,
        scope,
        until,
        ...(scope === "ARM" ? { classArmId: armId } : {}),
        ...(scope === "LEVEL" ? { classLevelId: levelId } : {}),
      });
      toast.success(`${hide.subjectName} hidden.`);
      onSaved(hide);
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not hide the subject.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Hide a subject</DialogTitle>
          <DialogDescription>
            Its scores are kept, but it shows on no report card or result and counts in no total or position. You
            can unhide it at any time.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="hide-subject">Subject</Label>
            <select id="hide-subject" className={SELECT} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Choose a subject</option>
              {sortedSubjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {scopes.length > 1 && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-sm font-medium">Where</legend>
              {scopes.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="hide-scope" checked={scope === s} onChange={() => setScope(s)} />
                  {s === "ARM" ? "One class arm" : s === "LEVEL" ? "Every arm of a class" : SUBJECT_HIDE_SCOPE_LABELS.SCHOOL}
                </label>
              ))}
            </fieldset>
          )}

          {scope === "ARM" && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="hide-arm">Class arm</Label>
              <select id="hide-arm" className={SELECT} value={armId} onChange={(e) => setArmId(e.target.value)}>
                <option value="">Choose a class arm</option>
                {sortedArms.map((a) => (
                  <option key={a.id} value={a.id}>
                    {levelName.get(a.classLevelId) ? `${levelName.get(a.classLevelId)} ${a.name}` : a.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {scope === "LEVEL" && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="hide-level">Class</Label>
              <select id="hide-level" className={SELECT} value={levelId} onChange={(e) => setLevelId(e.target.value)}>
                <option value="">Choose a class</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium">How long</legend>
            {SUBJECT_HIDE_UNTIL.map((u) => (
              <label key={u} className="flex items-center gap-2 text-sm">
                <input type="radio" name="hide-until" checked={until === u} onChange={() => setUntil(u)} />
                {SUBJECT_HIDE_UNTIL_LABELS[u]}
              </label>
            ))}
          </fieldset>

          {terms.length > 1 && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="hide-term">{until === "INDEFINITE" ? "Starting from" : "Term"}</Label>
              <select id="hide-term" className={SELECT} value={termId} onChange={(e) => setTermId(e.target.value)}>
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.isCurrent ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {terms.length === 0 && (
            <p className="text-sm text-destructive">Set up this session&apos;s terms first (Settings → Academic → Years).</p>
          )}

          <p className="text-xs text-muted-foreground">
            The subject leaves results straight away. Totals, averages and positions on report cards change the next
            time the cards are built.
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={!ready || saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Hide subject
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
