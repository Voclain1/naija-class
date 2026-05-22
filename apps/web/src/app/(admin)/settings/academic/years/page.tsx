"use client";

import { CalendarPlus, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { AcademicYearDto } from "@school-kit/types";

import { AcademicYearDialog } from "@/components/settings/academic/academic-year-dialog";
import { AcademicYearsTable } from "@/components/settings/academic/academic-years-table";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  deleteAcademicYear,
  listAcademicYears,
  setCurrentAcademicYear,
} from "@/lib/academic-years/academic-years-api";

// /settings/academic/years — wrapped by the (admin) layout so RequireAuth
// has already run. List + create + edit + set-current + delete. The
// underlying table links each row to /settings/academic/years/[id]/terms
// for the term-management sub-page.
export default function AcademicYearsPage() {
  const [years, setYears] = useState<AcademicYearDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AcademicYearDto | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setYears(await listAcademicYears());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load academic years.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSaved = useCallback((saved: AcademicYearDto) => {
    setYears((prev) => {
      const existing = prev.findIndex((y) => y.id === saved.id);
      if (existing === -1) return [saved, ...prev];
      const next = [...prev];
      next[existing] = saved;
      return next;
    });
  }, []);

  const onSetCurrent = useCallback(async (target: AcademicYearDto) => {
    try {
      const updated = await setCurrentAcademicYear(target.id);
      // Local optimistic mirror of the server's flip-siblings logic.
      setYears((prev) =>
        prev.map((y) =>
          y.id === updated.id
            ? updated
            : y.isCurrent
              ? { ...y, isCurrent: false }
              : y,
        ),
      );
      toast.success(`"${updated.label}" is now the current academic year.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not set current year.");
    }
  }, []);

  const onDelete = useCallback(async (target: AcademicYearDto) => {
    // Confirm — deletion cascades to any terms under this year. Phase 1
    // slice 9 will add Enrollment cascade considerations to this prompt.
    if (
      !window.confirm(
        `Delete "${target.label}"? Any terms under it will be removed.\nThis cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      await deleteAcademicYear(target.id);
      setYears((prev) => prev.filter((y) => y.id !== target.id));
      toast.success("Academic year deleted.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete academic year.");
    }
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Academic years</h1>
          <p className="text-sm text-muted-foreground">
            Define each academic year and its three terms. Slice 1 of Phase 1.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(undefined);
            setDialogOpen(true);
          }}
        >
          <CalendarPlus className="mr-1 h-4 w-4" />
          Add academic year
        </Button>
      </header>

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
        <AcademicYearsTable
          years={years}
          onEdit={(y) => {
            setEditing(y);
            setDialogOpen(true);
          }}
          onSetCurrent={onSetCurrent}
          onDelete={onDelete}
        />
      )}

      <AcademicYearDialog
        open={dialogOpen}
        existing={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={onSaved}
      />
    </div>
  );
}
