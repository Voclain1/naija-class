"use client";

import { EyeOff, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  CLASS_STAGES,
  type ClassArmDto,
  type ClassLevelDto,
  type ClassStageDto,
  type SubjectDto,
  type SubjectHideDto,
  type TermDto,
} from "@school-kit/types";

import { HelpTip } from "@/components/shared/help-tip";
import { HideSubjectDialog } from "@/components/subjects/hide-subject-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { ApiError } from "@/lib/api-client";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import { listClassLevels } from "@/lib/class-levels/class-levels-api";
import { listSubjectHides, unhideSubject } from "@/lib/subject-hides/subject-hides-api";
import { createSubject, listSubjects, updateSubject } from "@/lib/subjects/subjects-api";
import { newSubjectCode } from "@/lib/subjects/subject-code";

// /settings/academic/class-subjects — Subjects by class (2026-11-02,
// docs/modules/subjects-by-class.md). Replaces the class-subject matrix.
//
// Every subject carries the stages it is taught in; a class takes the
// subjects of its stage. Nothing to map class by class, so deleting or adding
// classes needs nothing here. Only subjects with approved scores reach report
// cards, so a long list costs nothing. Hiding takes a subject off results for
// an arm, a class or the school, for a term, a session or until unhidden.

type Stage = ClassStageDto;

export default function SubjectsByClassPage() {
  const [levels, setLevels] = useState<ClassLevelDto[]>([]);
  const [arms, setArms] = useState<ClassArmDto[]>([]);
  const [subjects, setSubjects] = useState<SubjectDto[]>([]);
  const [hides, setHides] = useState<SubjectHideDto[]>([]);
  const [terms, setTerms] = useState<TermDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [addFor, setAddFor] = useState<Stage | null>(null);
  const [hideOpen, setHideOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const loadHides = useCallback(async (past: boolean) => {
    setHides(await listSubjectHides({ current: !past }));
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [lvls, armRows, subs, years] = await Promise.all([
        listClassLevels({ includeInactive: false }),
        listClassArms({ includeInactive: false }),
        listSubjects({ includeInactive: false }),
        listAcademicYears(),
      ]);
      const year = years.find((y) => y.isCurrent);
      setTerms(year ? await listTerms(year.id) : []);
      setLevels([...lvls].sort((a, b) => a.orderIndex - b.orderIndex || a.name.localeCompare(b.name)));
      setArms(armRows);
      setSubjects(subs);
      await loadHides(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load subjects by class.");
    } finally {
      setLoading(false);
    }
  }, [loadHides]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Only the stages the school has classes in: a school with no Nursery
  // classes sees no Nursery section.
  const stages = useMemo(() => {
    const used = new Set(levels.map((l) => l.stage));
    return CLASS_STAGES.filter((s) => used.has(s.value));
  }, [levels]);

  const currentTermId = terms.find((t) => t.isCurrent)?.id ?? null;

  async function removeFromStage(subject: SubjectDto, stage: Stage, stageLabel: string) {
    if (!window.confirm(`Take ${subject.name} off ${stageLabel} classes? Scores already recorded are kept.`)) return;
    setBusy(subject.id);
    try {
      const updated = await updateSubject(subject.id, { stages: subject.stages.filter((s) => s !== stage) });
      setSubjects((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      toast.success(`${subject.name} taken off ${stageLabel}.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not update the subject.");
    } finally {
      setBusy(null);
    }
  }

  async function unhide(hide: SubjectHideDto) {
    setBusy(hide.id);
    try {
      await unhideSubject(hide.id);
      toast.success(`${hide.subjectName} is showing again.`);
      await loadHides(showPast);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not unhide the subject.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 font-serif text-2xl font-medium tracking-tight text-foreground">
            Subjects by class
            <HelpTip title="How subjects by class work">
              <p>
                Each class takes the subjects of its stage (Nursery, KG, Primary, JSS or SSS). The standard subjects
                are already here, so there is nothing to map class by class, and deleting or adding classes changes
                nothing here.
              </p>
              <p>
                Only subjects with recorded and approved scores appear on report cards and results. A subject your
                school does not teach simply never shows.
              </p>
              <p>
                To keep a subject off results that do have scores, hide it: for one arm, a whole class or the
                school, for this term, this session or until you unhide it.
              </p>
            </HelpTip>
          </h1>
          <p className="text-sm text-muted-foreground">
            Only subjects with approved scores show on report cards. Add any your school teaches that are missing.
          </p>
        </div>
        <Button variant="outline" onClick={() => setHideOpen(true)} disabled={loading || subjects.length === 0}>
          <EyeOff className="mr-1 h-4 w-4" />
          Hide a subject
        </Button>
      </header>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <div className="flex flex-col gap-3 rounded-md bg-destructive/10 p-4 text-sm text-destructive">
          <span>{error}</span>
          <button type="button" className="self-start text-xs underline" onClick={() => void loadAll()}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <section aria-labelledby="hidden-title" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="hidden-title" className="text-base font-medium">
                Hidden subjects
              </h2>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={showPast}
                  onChange={(e) => {
                    setShowPast(e.target.checked);
                    void loadHides(e.target.checked).catch(() => toast.error("Could not load hidden subjects."));
                  }}
                />
                Show ended and unhidden
              </label>
            </div>
            {hides.length === 0 ? (
              <p className="text-sm text-muted-foreground">No subject is hidden.</p>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="hidden-subjects">
                {hides.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 p-3 text-sm">
                    <div className="flex min-w-0 flex-col">
                      <span className="font-medium">{h.subjectName}</span>
                      <span className="text-muted-foreground">
                        {hideWhere(h)} · {hideHowLong(h)}
                        {h.hiddenByName ? ` · by ${h.hiddenByName}` : ""}
                        {h.unhiddenAt ? " · unhidden" : ""}
                      </span>
                    </div>
                    {h.canUnhide && (
                      <Button size="sm" variant="outline" disabled={busy === h.id} onClick={() => void unhide(h)}>
                        Unhide
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {stages.length === 0 ? (
            <p className="rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">
              Add your classes first (Class Levels tab). Each class&apos;s subjects come from its stage.
            </p>
          ) : (
            stages.map((stage) => {
              const stageSubjects = subjects
                .filter((s) => s.stages.includes(stage.value))
                .sort((a, b) => a.name.localeCompare(b.name));
              const classNames = levels.filter((l) => l.stage === stage.value).map((l) => l.name);
              return (
                <section
                  key={stage.value}
                  aria-labelledby={`stage-${stage.value}`}
                  className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-sm"
                  data-testid={`stage-${stage.value}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 id={`stage-${stage.value}`} className="text-base font-medium">
                        {stage.label}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {classNames.join(", ")} · {stageSubjects.length} {stageSubjects.length === 1 ? "subject" : "subjects"}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setAddFor(stage.value)}>
                      <Plus className="mr-1 h-4 w-4" />
                      Add a subject
                    </Button>
                  </div>
                  {stageSubjects.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No subjects yet.</p>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {stageSubjects.map((s) => (
                        <li key={s.id} className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm">
                          {s.name}
                          <button
                            type="button"
                            className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
                            aria-label={`Take ${s.name} off ${stage.label}`}
                            disabled={busy === s.id}
                            onClick={() => void removeFromStage(s, stage.value, stage.label)}
                          >
                            <X className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })
          )}
        </>
      )}

      <AddSubjectDialog
        stage={addFor}
        subjects={subjects}
        onClose={() => setAddFor(null)}
        onSaved={(saved) =>
          setSubjects((prev) => (prev.some((s) => s.id === saved.id) ? prev.map((s) => (s.id === saved.id ? saved : s)) : [...prev, saved]))
        }
      />

      <HideSubjectDialog
        open={hideOpen}
        onClose={() => setHideOpen(false)}
        onSaved={() => void loadHides(showPast)}
        subjects={subjects}
        levels={levels}
        arms={arms}
        terms={terms}
        defaultTermId={currentTermId}
        scopes={["SCHOOL", "LEVEL", "ARM"]}
      />
    </div>
  );
}

function hideWhere(h: SubjectHideDto): string {
  if (h.scope === "SCHOOL") return "Whole school";
  if (h.scope === "LEVEL") return `Every ${h.classLevelName ?? "class"} arm`;
  return h.classArmName ?? "One class arm";
}

function hideHowLong(h: SubjectHideDto): string {
  if (h.until === "TERM") return `${h.termName}, ${h.academicYearLabel}`;
  if (h.until === "YEAR") return `${h.academicYearLabel} session`;
  return `Until unhidden, from ${h.termName} ${h.academicYearLabel}`;
}

// Add a subject to a stage: pick one the school already has (another stage
// teaches it) or type a new one.
function AddSubjectDialog({
  stage,
  subjects,
  onClose,
  onSaved,
}: {
  stage: Stage | null;
  subjects: SubjectDto[];
  onClose: () => void;
  onSaved: (s: SubjectDto) => void;
}) {
  const [existingId, setExistingId] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const label = CLASS_STAGES.find((s) => s.value === stage)?.label ?? "";

  useEffect(() => {
    setExistingId("");
    setName("");
  }, [stage]);

  const others = useMemo(
    () => (stage ? subjects.filter((s) => !s.stages.includes(stage)).sort((a, b) => a.name.localeCompare(b.name)) : []),
    [subjects, stage],
  );

  async function save() {
    if (!stage) return;
    setSaving(true);
    try {
      let saved: SubjectDto;
      if (existingId) {
        const s = subjects.find((x) => x.id === existingId)!;
        saved = await updateSubject(s.id, { stages: [...s.stages, stage] });
      } else {
        const trimmed = name.trim();
        const clash = subjects.find((s) => s.name.toLowerCase() === trimmed.toLowerCase());
        saved = clash
          ? await updateSubject(clash.id, { stages: [...new Set([...clash.stages, stage])] })
          : await createSubject({
              name: trimmed,
              code: newSubjectCode(trimmed, subjects.map((s) => s.code)),
              stages: [stage],
            });
      }
      onSaved(saved);
      toast.success(`${saved.name} added to ${label}.`);
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not add the subject.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={stage !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a subject to {label}</DialogTitle>
          <DialogDescription>Every {label} class will take it.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {others.length > 0 && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="add-existing">One of your subjects</Label>
              <select
                id="add-existing"
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={existingId}
                onChange={(e) => {
                  setExistingId(e.target.value);
                  if (e.target.value) setName("");
                }}
              >
                <option value="">Choose…</option>
                {others.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="add-new">{others.length > 0 ? "Or a new subject" : "Subject name"}</Label>
            <Input
              id="add-new"
              value={name}
              maxLength={60}
              placeholder="e.g. Diction"
              onChange={(e) => {
                setName(e.target.value);
                if (e.target.value) setExistingId("");
              }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving || (!existingId && name.trim().length === 0)}>
              Add subject
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
