"use client";

import { Check, ListPlus, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { SubjectDto } from "@school-kit/types";

import { SubjectDialog } from "@/components/settings/academic/subject-dialog";
import { SubjectsTable } from "@/components/settings/academic/subjects-table";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { deleteSubject, listSubjects, updateSubject } from "@/lib/subjects/subjects-api";

// /settings/academic/subjects — school-wide catalogue. Subjects are linked
// to one or more class levels via the matrix (next tab over). The Delete
// button calls DELETE, which hard-deletes server-side and cascades the
// (level, subject) join rows; "Deactivate" via the edit dialog's Active
// checkbox is the recommended soft path (matches class-levels semantics).
export default function SubjectsPage() {
  const [subjects, setSubjects] = useState<SubjectDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SubjectDto | undefined>(undefined);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [savingSelection, setSavingSelection] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await listSubjects({ includeInactive: true });
      setSubjects(loaded);
      setSelectedIds(loaded.filter((subject) => subject.isActive).map((subject) => subject.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load subjects.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSaved = useCallback((saved: SubjectDto) => {
    setSelectedIds((current) => saved.isActive
      ? (current.includes(saved.id) ? current : [...current, saved.id])
      : current.filter((id) => id !== saved.id));
    setSubjects((prev) => {
      const existing = prev.findIndex((s) => s.id === saved.id);
      if (existing === -1) {
        return [...prev, saved].sort((a, b) => a.name.localeCompare(b.name));
      }
      const next = [...prev];
      next[existing] = saved;
      return next.sort((a, b) => a.name.localeCompare(b.name));
    });
  }, []);

  const selectionChanged = useMemo(
    () => subjects.some((subject) => subject.isActive !== selectedIds.includes(subject.id)),
    [selectedIds, subjects],
  );

  async function saveSubjectSelection() {
    if (selectedIds.length === 0) return;
    const changed = subjects.filter((subject) => subject.isActive !== selectedIds.includes(subject.id));
    setSavingSelection(true);
    try {
      const saved = await Promise.all(
        changed.map((subject) => updateSubject(subject.id, { isActive: selectedIds.includes(subject.id) })),
      );
      const byId = new Map(saved.map((subject) => [subject.id, subject]));
      setSubjects((current) => current.map((subject) => byId.get(subject.id) ?? subject));
      toast.success("The subject list has been updated.");
    } catch (e) {
      await load();
      toast.error(e instanceof ApiError ? e.message : "Some subjects could not be updated. Your current list has been reloaded.");
    } finally {
      setSavingSelection(false);
    }
  }

  const onDelete = useCallback(async (target: SubjectDto) => {
    if (
      !window.confirm(
        `Delete "${target.name}"? This cannot be undone and will remove this subject from every class level it's linked to. If you want to keep history, deactivate instead.`,
      )
    ) {
      return;
    }
    try {
      await deleteSubject(target.id);
      setSubjects((prev) => prev.filter((s) => s.id !== target.id));
      toast.success(`"${target.name}" deleted.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete subject.");
    }
  }, []);

  return (
    <div className="flex w-full flex-col gap-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Subjects</h1>
          <p className="text-sm text-muted-foreground">
            Every subject your school teaches. Which classes take each one is
            on the Subjects by class tab.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(undefined);
            setDialogOpen(true);
          }}
        >
          <ListPlus className="mr-1 h-4 w-4" />
          Add subject
        </Button>
      </header>

      {!loading && !error && subjects.length > 0 && (
        <section className="rounded-xl border bg-card p-4 sm:p-5">
          <div className="flex flex-col gap-1">
            <h2 className="font-semibold">Which subjects does your school teach?</h2>
            <p className="text-sm text-muted-foreground">
              Keep the list relevant. Unselected subjects are hidden, not deleted, and can be restored later.
            </p>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {subjects.map((subject) => {
              const active = selectedIds.includes(subject.id);
              return (
                <button
                  key={subject.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedIds((current) => active ? current.filter((id) => id !== subject.id) : [...current, subject.id])}
                  className={`flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${active ? "border-primary/50 bg-primary/[0.06]" : "bg-background hover:bg-muted/40"}`}
                >
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${active ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                    {active && <Check className="h-4 w-4" aria-hidden />}
                  </span>
                  <span><span className="block text-sm font-medium">{subject.name}</span><span className="block text-xs text-muted-foreground">{subject.category}</span></span>
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-sm text-muted-foreground">{selectedIds.length} subjects selected</p>
            <Button onClick={saveSubjectSelection} disabled={!selectionChanged || selectedIds.length === 0 || savingSelection}>
              {savingSelection && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save subject selection
            </Button>
          </div>
        </section>
      )}

      <div className="flex items-center gap-2 text-sm">
        <input
          id="show-inactive-subj"
          type="checkbox"
          checked={includeInactive}
          onChange={(e) => setIncludeInactive(e.target.checked)}
          className="h-4 w-4"
        />
        <label htmlFor="show-inactive-subj" className="text-muted-foreground">
          Show deactivated subjects
        </label>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <SubjectsTable
          subjects={includeInactive ? subjects : subjects.filter((subject) => subject.isActive)}
          onEdit={(s) => {
            setEditing(s);
            setDialogOpen(true);
          }}
          onDelete={onDelete}
        />
      )}

      <SubjectDialog
        open={dialogOpen}
        existing={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={onSaved}
      />
    </div>
  );
}
