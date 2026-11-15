"use client";

import { Check, ListPlus, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { ClassLevelDto } from "@school-kit/types";

import { ClassLevelDialog } from "@/components/settings/academic/class-level-dialog";
import { ClassLevelsTable } from "@/components/settings/academic/class-levels-table";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  deleteClassLevel,
  listClassLevels,
  updateClassLevel,
} from "@/lib/class-levels/class-levels-api";

// /settings/academic/class-levels — list every level for this school,
// including the 14 KG/Primary/JSS/SSS rows seeded at signup. Admin can
// add custom levels (e.g. Crèche, A-Levels), edit names/codes/orderIndex,
// soft-deactivate, or hard-delete (slice 3 adds a "level has arms" guard
// that blocks hard-delete once classes attach).
export default function ClassLevelsPage() {
  const [levels, setLevels] = useState<ClassLevelDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClassLevelDto | undefined>(undefined);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [savingSelection, setSavingSelection] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await listClassLevels({ includeInactive: true });
      setLevels(loaded);
      setSelectedIds(loaded.filter((level) => level.isActive).map((level) => level.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load class levels.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSaved = useCallback((saved: ClassLevelDto) => {
    setSelectedIds((current) => saved.isActive
      ? (current.includes(saved.id) ? current : [...current, saved.id])
      : current.filter((id) => id !== saved.id));
    setLevels((prev) => {
      const existing = prev.findIndex((l) => l.id === saved.id);
      if (existing === -1) {
        const next = [...prev, saved];
        next.sort(
          (a, b) =>
            a.orderIndex - b.orderIndex || a.name.localeCompare(b.name),
        );
        return next;
      }
      const next = [...prev];
      next[existing] = saved;
      next.sort(
        (a, b) => a.orderIndex - b.orderIndex || a.name.localeCompare(b.name),
      );
      return next;
    });
  }, []);

  const onDelete = useCallback(async (target: ClassLevelDto) => {
    if (
      !window.confirm(
        `Delete "${target.name}"? This cannot be undone. If you want to keep history, deactivate instead.`,
      )
    ) {
      return;
    }
    try {
      await deleteClassLevel(target.id);
      setLevels((prev) => prev.filter((l) => l.id !== target.id));
      toast.success(`"${target.name}" deleted.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete class level.");
    }
  }, []);

  const selectionChanged = useMemo(
    () => levels.some((level) => level.isActive !== selectedIds.includes(level.id)),
    [levels, selectedIds],
  );

  async function saveClassSelection() {
    if (selectedIds.length === 0) return;
    const changed = levels.filter((level) => level.isActive !== selectedIds.includes(level.id));
    setSavingSelection(true);
    try {
      const saved = await Promise.all(
        changed.map((level) => updateClassLevel(level.id, { isActive: selectedIds.includes(level.id) })),
      );
      const byId = new Map(saved.map((level) => [level.id, level]));
      setLevels((current) => current.map((level) => byId.get(level.id) ?? level));
      toast.success("The class list has been updated.");
    } catch (e) {
      await load();
      toast.error(e instanceof ApiError ? e.message : "Some class levels could not be updated. Your current list has been reloaded.");
    } finally {
      setSavingSelection(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Class levels</h1>
          <p className="text-sm text-muted-foreground">
            The 14 standard Nigerian levels (KG 1 through SSS 3) are seeded
            automatically. Add custom levels or rename the defaults to match
            your school.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(undefined);
            setDialogOpen(true);
          }}
        >
          <ListPlus className="mr-1 h-4 w-4" />
          Add class level
        </Button>
      </header>

      {!loading && !error && (
        <section className="rounded-xl border bg-card p-4 sm:p-5">
          <div className="flex flex-col gap-1">
            <h2 className="font-semibold">Which classes does your school run?</h2>
            <p className="text-sm text-muted-foreground">
              Select only the levels you use. Unselected levels are hidden, not deleted, so records remain safe.
            </p>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {levels.map((level) => {
              const active = selectedIds.includes(level.id);
              return (
                <button
                  key={level.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedIds((current) => active ? current.filter((id) => id !== level.id) : [...current, level.id])}
                  className={`flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${active ? "border-primary/50 bg-primary/[0.06]" : "bg-background hover:bg-muted/40"}`}
                >
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${active ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                    {active && <Check className="h-4 w-4" aria-hidden />}
                  </span>
                  <span><span className="block text-sm font-medium">{level.name}</span><span className="block text-xs text-muted-foreground">{level.stage}</span></span>
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-sm text-muted-foreground">{selectedIds.length} class levels selected</p>
            <Button onClick={saveClassSelection} disabled={!selectionChanged || selectedIds.length === 0 || savingSelection}>
              {savingSelection && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save class selection
            </Button>
          </div>
        </section>
      )}

      <div className="flex items-center gap-2 text-sm">
        <input
          id="show-inactive"
          type="checkbox"
          checked={includeInactive}
          onChange={(e) => setIncludeInactive(e.target.checked)}
          className="h-4 w-4"
        />
        <label htmlFor="show-inactive" className="text-muted-foreground">
          Show deactivated levels
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
        <ClassLevelsTable
          levels={includeInactive ? levels : levels.filter((level) => level.isActive)}
          onEdit={(l) => {
            setEditing(l);
            setDialogOpen(true);
          }}
          onDelete={onDelete}
        />
      )}

      <ClassLevelDialog
        open={dialogOpen}
        existing={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={onSaved}
      />
    </div>
  );
}
