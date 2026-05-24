"use client";

import { ListPlus, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { SubjectDto } from "@school-kit/types";

import { SubjectDialog } from "@/components/settings/academic/subject-dialog";
import { SubjectsTable } from "@/components/settings/academic/subjects-table";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { deleteSubject, listSubjects } from "@/lib/subjects/subjects-api";

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSubjects(await listSubjects({ includeInactive }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load subjects.");
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSaved = useCallback((saved: SubjectDto) => {
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
          <h1 className="text-2xl font-semibold tracking-tight">Subjects</h1>
          <p className="text-sm text-muted-foreground">
            Define every subject your school teaches. Then link them to the
            appropriate class levels in the Matrix tab.
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
          subjects={subjects}
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
