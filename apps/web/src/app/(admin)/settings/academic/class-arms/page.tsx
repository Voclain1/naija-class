"use client";

import { ListPlus, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { ClassArmDto, ClassLevelDto } from "@school-kit/types";

import { ClassArmDialog } from "@/components/settings/academic/class-arm-dialog";
import { ClassArmsTable } from "@/components/settings/academic/class-arms-table";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  deleteClassArm,
  listClassArms,
} from "@/lib/class-arms/class-arms-api";
import { listClassLevels } from "@/lib/class-levels/class-levels-api";

// /settings/academic/class-arms — admin manages arms grouped by their
// parent class level. Loads levels + arms in parallel; renders a section
// per level (including empty ones) so an admin can drop an arm onto any
// level without scrolling away.
//
// Like the subjects page, "Delete" hard-deletes server-side; the safer
// path for normal use is the Active checkbox in the edit dialog (PATCH
// isActive=false). The recommended-soft / hard-delete-available split
// matches the slice-2 class-levels page.
export default function ClassArmsPage() {
  const [levels, setLevels] = useState<ClassLevelDto[]>([]);
  const [arms, setArms] = useState<ClassArmDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClassArmDto | undefined>(undefined);
  const [defaultLevelId, setDefaultLevelId] = useState<string | undefined>(
    undefined,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [lvls, a] = await Promise.all([
        // Include inactive levels too — they may still own arms historically;
        // we want them visible while editing.
        listClassLevels({ includeInactive: true }),
        listClassArms({ includeInactive }),
      ]);
      setLevels(
        [...lvls].sort(
          (a, b) =>
            a.orderIndex - b.orderIndex || a.name.localeCompare(b.name),
        ),
      );
      setArms(a);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load class arms.");
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSaved = useCallback((saved: ClassArmDto) => {
    setArms((prev) => {
      const idx = prev.findIndex((a) => a.id === saved.id);
      if (idx === -1) return [...prev, saved];
      const next = [...prev];
      next[idx] = saved;
      return next;
    });
  }, []);

  const onDelete = useCallback(async (target: ClassArmDto) => {
    if (
      !window.confirm(
        `Delete "${target.name}"? This cannot be undone. If you want to keep history, deactivate instead.`,
      )
    ) {
      return;
    }
    try {
      await deleteClassArm(target.id);
      setArms((prev) => prev.filter((a) => a.id !== target.id));
      toast.success(`"${target.name}" deleted.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete class arm.");
    }
  }, []);

  return (
    <div className="flex w-full flex-col gap-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Class arms</h1>
          <p className="text-sm text-muted-foreground">
            Each class level can have multiple arms (e.g. JSS 1A, JSS 1B).
            Assign a class teacher and an optional capacity per arm.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(undefined);
            setDefaultLevelId(levels[0]?.id);
            setDialogOpen(true);
          }}
          disabled={levels.length === 0}
        >
          <ListPlus className="mr-1 h-4 w-4" />
          Add class arm
        </Button>
      </header>

      <div className="flex items-center gap-2 text-sm">
        <input
          id="show-inactive-arms"
          type="checkbox"
          checked={includeInactive}
          onChange={(e) => setIncludeInactive(e.target.checked)}
          className="h-4 w-4"
        />
        <label htmlFor="show-inactive-arms" className="text-muted-foreground">
          Show deactivated arms
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
        <ClassArmsTable
          levels={levels}
          arms={arms}
          onAdd={(level) => {
            setEditing(undefined);
            setDefaultLevelId(level.id);
            setDialogOpen(true);
          }}
          onEdit={(arm) => {
            setEditing(arm);
            setDefaultLevelId(arm.classLevelId);
            setDialogOpen(true);
          }}
          onDelete={onDelete}
        />
      )}

      <ClassArmDialog
        open={dialogOpen}
        levels={levels}
        defaultLevelId={defaultLevelId}
        existing={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={onSaved}
      />
    </div>
  );
}
