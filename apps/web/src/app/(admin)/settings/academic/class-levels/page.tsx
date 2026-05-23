"use client";

import { ListPlus, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { ClassLevelDto } from "@school-kit/types";

import { ClassLevelDialog } from "@/components/settings/academic/class-level-dialog";
import { ClassLevelsTable } from "@/components/settings/academic/class-levels-table";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  deleteClassLevel,
  listClassLevels,
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLevels(await listClassLevels({ includeInactive }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load class levels.");
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSaved = useCallback((saved: ClassLevelDto) => {
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

  return (
    <div className="flex w-full flex-col gap-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Class levels</h1>
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
          levels={levels}
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
